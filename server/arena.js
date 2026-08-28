/**
 * arena — the queue behind every bot match: gauntlet runs against the house
 * levels and student-vs-student bot battles. Each job is a best-of-5: five
 * 100-game series, the match going to whoever takes more series. Jobs run in
 * worker threads (≈15s each) and land in match history when they finish.
 */
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { HOUSE } = require('./samplebots/bots');

const SERIES_COUNT = 5;
const SERIES_GAMES = Number(process.env.COUP_SERIES_GAMES || 100);
const SAMPLE_AT = [0, 49, 99];          // game 1, 50, 100 of each series
const WORKER_CHOICES = [1, 2, 3, 4, 6, 8];
const MAX_PENDING_PER_USER = 3;

/**
 * CPUs actually available to THIS process.
 *
 * os.cpus() counts the HOST's cores, which inside a container is a fantasy —
 * a 0.1-CPU instance on an 8-core box still reports 8. The truth is in the
 * cgroup quota, so read that first and only fall back to the core count when
 * there is no quota to read (bare metal, or macOS, which has no cgroups).
 */
function cpuBudget() {
  // cgroup v2: "<quota> <period>", or "max <period>" when uncapped
  try {
    const [q, p] = fs.readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim().split(/\s+/);
    if (q !== 'max') {
      const n = Number(q) / Number(p || 100000);
      if (n > 0) return n;
    }
  } catch { /* not cgroup v2 */ }
  // cgroup v1: quota and period in separate files, -1 quota means uncapped
  try {
    const q = Number(fs.readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_quota_us', 'utf8'));
    const p = Number(fs.readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_period_us', 'utf8'));
    if (q > 0 && p > 0) return q / p;
  } catch { /* not cgroup v1 */ }
  return os.availableParallelism ? os.availableParallelism() : os.cpus().length;
}

/** round down to a value the picker actually offers */
function snapToChoice(n) {
  let best = WORKER_CHOICES[0];
  for (const c of WORKER_CHOICES) if (c <= n) best = c;
  return best;
}

/**
 * How many bot matches run at once. These workers are shared by EVERY camper's
 * level runs and bot battles, so a class of 40 all pressing "play this level"
 * queues behind them.
 *
 * Derived from the real CPU budget, leaving one for the HTTP server and the
 * ladder: a 0.1-CPU free instance gets 1, a 14-core laptop gets 8. Organizers
 * still override it live, and COUP_MAX_WORKERS beats everything.
 */
function defaultWorkers() {
  const env = Number(process.env.COUP_MAX_WORKERS);
  if (WORKER_CHOICES.includes(env)) return env;
  const budget = cpuBudget();
  if (budget < 2) return 1;              // anything tiny: never compete with the server
  return snapToChoice(Math.floor(budget) - 1);
}
const DEFAULT_WORKERS = defaultWorkers();

class Arena {
  /** @param book optional AchievementBook — matches award trophies as they land */
  constructor(store, book = null) {
    this.store = store;
    this.book = book;
    this.queue = [];
    this.running = 0;
    this.jobs = new Map();     // id -> {id, mode, level, players, owners, ownerNames, status, ts, error}
    this.lastServed = new Map();   // username -> when a match of theirs last STARTED
  }

  /** a, b: {owner, ownerName, name, source}; mode 'gauntlet'|'botduel' */
  enqueue({ mode, level = null, a, b }) {
    const mine = [...this.jobs.values()].filter((j) => j.status !== 'done'
      && (j.owners[0] === a.owner || j.owners[1] === a.owner));
    if (mine.length >= MAX_PENDING_PER_USER) return { error: 'you already have matches running — let them finish first' };
    if (a.name === b.name) b = { ...b, name: b.name + ' Ⅱ' };
    const job = {
      id: crypto.randomBytes(6).toString('hex'),
      mode, level,
      players: [a.name, b.name],
      owners: [a.owner, b.owner],
      ownerNames: [a.ownerName, b.ownerName],
      status: 'queued', ts: Date.now(), error: null,
      _a: a, _b: b,
    };
    this.jobs.set(job.id, job);
    this.queue.push(job);
    this._drain();
    return { job: this._pub(job) };
  }

  /** organizer-set concurrency; falls back to the env default */
  get maxWorkers() {
    const v = Number(this.store.settings.maxWorkers);
    return WORKER_CHOICES.includes(v) ? v : DEFAULT_WORKERS;
  }

  /** Raising this starts queued matches immediately; lowering it never kills
   *  a match in flight — the extras simply retire as they finish. */
  setMaxWorkers(n) {
    const next = Number(n);
    if (!WORKER_CHOICES.includes(next)) return { error: 'not a worker count we offer' };
    this.store.settings.maxWorkers = next;
    this.store.saveSettings();
    this._drain();
    return { ok: true, maxWorkers: next, running: this.running, queued: this.queue.length };
  }

  /** hand each human owner their side of the finished match */
  _award(job, result) {
    if (!this.book) return;
    const [wa, wb] = result.score;
    const total = wa + wb;
    for (const side of [0, 1]) {
      const owner = job.owners[side];
      if (!owner || owner === 'house') continue;
      const mine = side === 0 ? wa : wb;
      const theirs = side === 0 ? wb : wa;
      try {
        this.book.fromMatch(owner, {
          mode: job.mode,
          level: job.level,
          // by the house bot's REAL name — arena renames a colliding
          // player bot, so job.players is not a safe way to identify a boss
          houseName: job.mode === 'gauntlet' && HOUSE[job.level] ? HOUSE[job.level].name : null,
          won: mine > theirs,
          swept: mine > theirs && theirs === 0 && total > 0,
          blanked: mine === 0 && theirs > 0,
          flags: (result.flags || {})[job.players[side]],
        });
      } catch (err) {
        console.error('[arena] achievements failed', err.message);
      }
    }
  }

  _pub(j) {
    return { id: j.id, mode: j.mode, level: j.level, players: j.players,
      owners: j.owners, ownerNames: j.ownerNames, status: j.status, ts: j.ts, error: j.error };
  }

  /**
   * FAIR SHARE, not first-come-first-served.
   *
   * A queue is only fair if waiting is what earns you a turn. Straight FIFO
   * means a camper who fires off three level runs occupies the front of the
   * line, and everyone behind waits for all three — the more you spam, the
   * more of the queue you own.
   *
   * So the next job is the one belonging to whoever has gone LONGEST without a
   * match starting. Somebody who just had one drops to the back of the pack
   * automatically, and their second and third runs fill the gaps between other
   * people's firsts. Ties fall back to enqueue order, so among equals it is
   * still FIFO.
   */
  _takeNext() {
    let bestIdx = 0;
    let bestAt = Infinity;
    for (let i = 0; i < this.queue.length; i++) {
      // a job's claim on the queue is its neediest human owner
      const owners = this.queue[i].owners.filter((o) => o && o !== 'house');
      const served = owners.length
        ? Math.min(...owners.map((o) => this.lastServed.get(o) || 0))
        : 0;
      if (served < bestAt) { bestAt = served; bestIdx = i; }   // ties keep the earlier job
    }
    const job = this.queue.splice(bestIdx, 1)[0];
    const now = Date.now();
    for (const o of job.owners) if (o && o !== 'house') this.lastServed.set(o, now);
    return job;
  }

  _drain() {
    while (this.running < this.maxWorkers && this.queue.length) {
      const job = this._takeNext();
      this.running++;
      job.status = 'running';
      const worker = new Worker(path.join(__dirname, 'arena-worker.js'), {
        workerData: {
          a: { name: job._a.name, source: job._a.source },
          b: { name: job._b.name, source: job._b.source },
          seedBase: crypto.randomBytes(4).readUInt32LE(0),
          seriesCount: SERIES_COUNT, seriesGames: SERIES_GAMES, sampleAt: SAMPLE_AT,
        },
      });
      const finish = (result) => {
        this.running--;
        if (result && result.ok) {
          const [wa, wb] = result.score;
          this.store.addMatch({
            mode: job.mode, level: job.level,
            players: job.players, owners: job.owners, ownerNames: job.ownerNames,
            score: result.score,
            winnerName: wa > wb ? job.players[0] : wb > wa ? job.players[1] : null,
            gamesPerSeries: SERIES_GAMES,
            series: result.series,
            // the sources let any of the 100 games be re-dealt deterministically
            sources: [job._a.source, job._b.source],
            errors: result.errors,
            // the actual crash messages, so the Levels result can tell a
            // camper WHAT broke instead of only that something did
            errorDetail: result.errorDetail || {},
          });
          this._award(job, result);
          this.jobs.delete(job.id);
        } else {
          job.status = 'failed';
          job.error = (result && result.error) || 'the match crashed';
          setTimeout(() => this.jobs.delete(job.id), 60_000);
        }
        this._drain();
      };
      worker.once('message', finish);
      worker.once('error', (err) => finish({ ok: false, error: err.message }));
    }
  }

  pendingFor(username) {
    return [...this.jobs.values()]
      .filter((j) => j.owners.includes(username))
      .map((j) => this._pub(j));
  }
}

module.exports = { Arena, SERIES_COUNT, SERIES_GAMES, WORKER_CHOICES };
