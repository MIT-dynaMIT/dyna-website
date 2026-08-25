/**
 * arena — the queue behind every bot match: gauntlet runs against the house
 * levels and student-vs-student bot battles. Each job is a best-of-5: five
 * 100-game series, the match going to whoever takes more series. Jobs run in
 * worker threads (≈15s each) and land in match history when they finish.
 */
'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { HOUSE } = require('./samplebots/bots');

const SERIES_COUNT = 5;
const SERIES_GAMES = Number(process.env.COUP_SERIES_GAMES || 100);
const SAMPLE_AT = [0, 49, 99];          // game 1, 50, 100 of each series
const MAX_WORKERS = 2;
const MAX_PENDING_PER_USER = 3;

class Arena {
  /** @param book optional AchievementBook — matches award trophies as they land */
  constructor(store, book = null) {
    this.store = store;
    this.book = book;
    this.queue = [];
    this.running = 0;
    this.jobs = new Map();     // id -> {id, mode, level, players, owners, ownerNames, status, ts, error}
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

  _drain() {
    while (this.running < MAX_WORKERS && this.queue.length) {
      const job = this.queue.shift();
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

module.exports = { Arena, SERIES_COUNT, SERIES_GAMES };
