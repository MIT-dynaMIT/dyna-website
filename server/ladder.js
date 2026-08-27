/**
 * ladder — the scrimmage leaderboard. Students submit ANY saved bot; the
 * server continuously pairs submissions into BEST-OF-7 matches (each of the
 * 7 a 100-game series) in a worker thread, and ELO moves once per match on
 * the majority result (win 1 / loss 0 / drawn match ½, K=32).
 */
'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { HOUSE } = require('./samplebots/bots');
const { checkProgram } = require('./botapi');

const SERIES_COUNT = 7;
const SERIES_GAMES = Number(process.env.COUP_SERIES_GAMES || 100);
const K = 32;
// how many of the nearest-rated bots are eligible as the opponent, before
// "who has waited longest" decides between them. 1 would be pure closest-ELO
// (the starving behaviour); the whole board would be random pairing.
const NEAR_POOL = 5;
const INTERVAL_MS = Number(process.env.LADDER_INTERVAL_MS || 40_000);
/**
 * Tick speeds an organizer can pick live. Measured on a 700-game match: 0.52s
 * for two light bots, 0.90s Andrew-vs-Andrew, 72 KB of match record each.
 *
 * 1s is offered but is genuinely different in kind: at ~0.5-0.9s a match the
 * worker runs at 50-90% duty forever, and records churn at ~250 MB/hour. Fine
 * on a real machine during a session, rough on a small cloud instance. The
 * `busy` guard keeps it correct either way — a tick landing mid-match is
 * dropped, never queued, so the rate self-limits instead of piling up.
 */
const TICK_CHOICES = [40_000, 20_000, 10_000, 5_000, 1_000, 0];

/** 0 = MAX: no waiting at all — the next match starts the moment one ends. */
const MAX_SPEED = 0;
/** even at MAX a slow heartbeat runs, so a worker dying without reporting
 *  back cannot silently stall the whole scrimmage */
const WATCHDOG_MS = 2_000;

/** who defends until an organizer says otherwise */
const DEFAULT_DEFENDERS = ['Andrew', 'Nish'];
const SAMPLE_AT = [0, 49, 99];

class LadderServer {
  /** @param book optional AchievementBook — standings hand out trophies */
  constructor(store, book = null) {
    this.store = store;
    this.book = book;
    this.busy = false;
    this._timer = null;
    this._lastPair = '';
    // The scrimmage is organizer-controlled: it runs only while an organizer
    // has started it, and that choice survives restarts. Stores written
    // before the switch defaulted to on, so retire that once.
    if (this.store.ladder.control !== 2) {
      this.store.ladder.running = false;
      this.store.ladder.control = 2;
      this._save();
    }
    this._backfillLastAt();
    this.ensureHouse();
  }

  /** Entries written before fair-share pairing have no lastAt. Treat them as
   *  never-played (0) so the scheduler picks them up first — the frozen-out
   *  veterans are exactly the ones this fix exists for. */
  _backfillLastAt() {
    let changed = false;
    for (const s of this.sub) {
      if (typeof s.lastAt !== 'number') { s.lastAt = 0; changed = true; }
    }
    if (changed) this._save();
  }

  get running() { return !!this.store.ladder.running; }

  /** how often a pairing is attempted; organizer-set, survives restarts */
  get tickMs() {
    const v = Number(this.store.ladder.tickMs);
    return TICK_CHOICES.includes(v) ? v : INTERVAL_MS;
  }

  /** organizer dial. Re-arms the timer immediately when the scrimmage is live. */
  setTickMs(ms) {
    const next = Number(ms);
    if (!TICK_CHOICES.includes(next)) return { error: 'not a speed we offer' };
    if (next === this.tickMs) return { ok: true, tickMs: next };
    this.store.ladder.tickMs = next;
    this._save();
    if (this.running) { this.stop(); this.start(); }
    return { ok: true, tickMs: next };
  }

  get sub() { return this.store.ladder.submissions; }
  _save() { this.store._save('ladder.json', this.store.ladder); }

  /**
   * Which house bots defend the board. An organizer picks any number of them —
   * all four for a crowded ladder with a clear ceiling, one for a single
   * benchmark, none at all to let the campers fight only each other.
   *
   * An empty list is a real choice, so "never set" (undefined) is what falls
   * back to the default rather than "set to nothing".
   */
  get defenders() {
    const v = this.store.settings.houseDefenders;
    if (!Array.isArray(v)) return DEFAULT_DEFENDERS;
    return v.filter((n) => HOUSE.some((h) => h.name === n));
  }

  /** organizer choice. Dropping a defender takes it off the board and its
   *  rating with it; adding one seats it fresh at 1000. */
  setDefenders(names) {
    const valid = (Array.isArray(names) ? names : []).filter((n) => HOUSE.some((h) => h.name === n));
    this.store.settings.houseDefenders = valid;
    this.store.saveSettings();
    this.ensureHouse();
    return { ok: true, defenders: this.defenders };
  }

  /**
   * Where a defender's code comes from: the ORGANIZER'S SAVED SLOT of that
   * name, so the boss can be tuned live from the Bot Editor without a deploy.
   * The bundled .py is the fallback — a fresh install before seeding, or a slot
   * that has been renamed away.
   *
   * A slot only takes over if it actually compiles. Otherwise a half-finished
   * edit would become the bot defending the ladder, and every match against it
   * would fail; better to keep playing the last good build and let the editor's
   * own check tell them what is wrong.
   */
  _defenderSource(name, current) {
    const admin = Object.values(this.store.users).find((u) => u.isAdmin);
    const slots = admin ? (this.store.bots[admin.username] || []) : [];
    const slot = slots.find((s) => s && s.name === name && s.python && s.python.trim());
    const bundled = HOUSE.find((x) => x.name === name);
    if (slot) {
      if (checkProgram(slot.python).ok) return slot.python;
      // mid-edit and broken: hold whatever is already defending, which may be
      // an earlier good save. Falling back to the bundled file here would throw
      // away good tuning the moment of a typo.
      return current || (bundled ? bundled.source : null);
    }
    return bundled ? bundled.source : null;
  }

  /**
   * The house bots that defend the ladder. Keyed by NAME so a defender is
   * matched to its entry even after its code is rewritten — a new build
   * updates the existing entry in place and keeps its ELO history rather than
   * seeding a stranger at 1000. Called before every pairing, so editing a boss
   * in the Bot Editor reaches the ladder on the next match, not the next boot.
   */
  ensureHouse() {
    let changed = false;
    const wanted = this.defenders;
    for (const name of wanted) {
      const e0 = this.sub.find((x) => x.owner === 'house' && x.name === name);
      const source = this._defenderSource(name, e0 ? e0.source : null);
      if (!source) continue;
      const e = e0;
      if (!e) {
        this.sub.push(this._entry('house', 'The House', -1, name, source));
        changed = true;
      } else if (e.source !== source) {
        e.source = source;                         // same defender, new build
        changed = true;
        console.log(`[ladder] ${name} updated from the organizer's slot`);
      }
    }
    // a house entry for a bot that no longer defends comes off the board
    const keep = new Set(wanted);
    for (let i = this.sub.length - 1; i >= 0; i--) {
      if (this.sub[i].owner === 'house' && !keep.has(this.sub[i].name)) {
        this.sub.splice(i, 1);
        changed = true;
      }
    }
    if (changed) this._save();
  }

  _entry(owner, ownerName, slot, name, source) {
    return {
      id: crypto.randomBytes(6).toString('hex'),
      owner, ownerName, slot, name: this._uniqueName(name || ownerName), source,
      elo: 1000, matches: 0, wins: 0, last: [], errors: 0, createdAt: Date.now(),
      lastAt: 0,                    // never played — first in line
    };
  }
  _uniqueName(base) {
    let name = String(base || 'Bot').slice(0, 22);
    const taken = new Set(this.sub.map((s) => s.name));
    let i = 2;
    while (taken.has(name)) name = `${String(base).slice(0, 19)} ${i++}`;
    return name;
  }

  /** students hold one ladder spot; resubmitting the same code keeps ELO */
  submit(user, slotIdx, slotData) {
    const old = this.sub.find((x) => x.owner === user.username);
    if (old && old.source === slotData.python) return { submission: old, unchanged: true };
    if (old) this.sub.splice(this.sub.indexOf(old), 1);
    const e = this._entry(user.username, user.displayName, slotIdx, slotData.name, slotData.python);
    this.sub.push(e);
    this._save();
    return { submission: e };
  }
  /** organizer: fresh week — the old board archives itself, then everyone
   *  comes off and Andrew re-seats at 1000 */
  reset() {
    if (this.sub.length) {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      try {
        require('node:fs').writeFileSync(
          require('node:path').join(this.store.dir, `ladder-archive-${stamp}.json`),
          JSON.stringify({ archivedAt: Date.now(), totalMatches: this.store.ladder.totalMatches,
            board: this.board(), submissions: this.sub }));
      } catch { /* archiving must never block the reset */ }
    }
    this.store.ladder.submissions = [];
    this.store.ladder.totalMatches = 0;
    this._lastPair = '';
    this.ensureHouse();
    this._save();
  }

  withdraw(user, id) {
    const i = this.sub.findIndex((x) => x.id === id && (x.owner === user.username && x.owner !== 'house'));
    if (i < 0) return false;
    this.sub.splice(i, 1);
    this._save();
    return true;
  }

  board() {
    return [...this.sub].sort((a, b) => b.elo - a.elo).map((s, i) => ({
      rank: i + 1, id: s.id, name: s.name, owner: s.ownerName, isHouse: s.owner === 'house',
      elo: Math.round(s.elo), matches: s.matches,
      score: s.last.length ? s.last.reduce((a, x) => a + x, 0) / s.last.length : 0,
    }));
  }
  view(user) {
    // Paused means invisible: while the scrimmage is stopped, nobody but an
    // organizer learns anything about it — no board, no ratings, no counts.
    if (!this.running && !user.isAdmin) {
      return {
        top: [], totalBots: 0, totalMatches: 0, running: false, hidden: true,
        seriesCount: SERIES_COUNT, seriesGames: SERIES_GAMES, mine: [],
        tickMs: this.tickMs, tickChoices: TICK_CHOICES,
      defenders: this.defenders, houseBots: HOUSE.map((h) => h.name),
      };
    }
    const board = this.board();
    // Campers see the top 10 — the whole board would tell a camper in 40th
    // exactly who is above them, which is discouraging and not the point.
    // Organizers get every row: they need to spot crashed bots and stragglers.
    const full = !!user.isAdmin;
    // crash counts ride along on the organizer view only — a camper should
    // not be able to read how often someone else's bot is throwing
    const errOf = {};
    for (const s of this.sub) errOf[s.id] = s.errors;
    return {
      top: full ? board.map((r) => ({ ...r, errors: errOf[r.id] || 0 })) : board.slice(0, 10),
      full,
      totalBots: board.length,
      totalMatches: this.store.ladder.totalMatches,
      running: this.running,
      hidden: false,
      seriesCount: SERIES_COUNT, seriesGames: SERIES_GAMES,
      tickMs: this.tickMs, tickChoices: TICK_CHOICES,
      defenders: this.defenders, houseBots: HOUSE.map((h) => h.name),
      mine: this.sub.filter((s) => s.owner === user.username).map((s) => ({
        id: s.id, name: s.name, slot: s.slot, elo: Math.round(s.elo), matches: s.matches,
        errors: s.errors, rank: board.findIndex((b) => b.id === s.id) + 1,
      })),
    };
  }

  /** organizer switch. Starting resumes pairing; pausing stops it dead and
   *  hides the whole leaderboard from everyone but organizers. */
  setRunning(on) {
    const next = !!on;
    if (next === this.running) return next;
    this.store.ladder.running = next;
    this._save();
    if (next) this.start();
    else this.stop();
    return next;
  }

  /** resume pairing — no-op unless an organizer has started the scrimmage */
  start() {
    if (this._timer || !this.running) return;
    const tick = () => { this._playOne(); };
    // At MAX the chain in _playOne drives everything and this is only a
    // watchdog; otherwise it is the metronome.
    this._timer = setInterval(tick, this.tickMs === MAX_SPEED ? WATCHDOG_MS : this.tickMs);
    // first match soon after starting — but never after the tick itself, or a
    // fast speed would sit idle waiting on a five-second warm-up
    setTimeout(tick, this.tickMs === MAX_SPEED ? 0 : Math.min(5_000, this.tickMs));
  }

  stop() {
    if (!this._timer) return;
    clearInterval(this._timer);
    this._timer = null;
  }

  _pick() {
    if (this.sub.length < 2 || !this.store.ladder.running) return null;
    // WAITED LONGEST first, not fewest-matches-played. Sorting on match count
    // starves the two ends of the board: a bot only enters a match by being
    // the least-played (which a busy veteran never is) or by being the closest
    // rating to that bot (which is nearly always a resubmission sitting at
    // 1000, since submit() mints a fresh entry with matches: 0). Measured on a
    // 16-bot field with one camper resubmitting every 40 matches, the top bot
    // went from 53 games per thousand to 8 and its rating went stale.
    const a = [...this.sub].sort((x, y) =>
      (x.lastAt || 0) - (y.lastAt || 0) || x.matches - y.matches || Math.random() - 0.5)[0];
    // opponent: near in rating so the match still means something, but among
    // those, whoever has waited longest. Never the exact same pairing twice in
    // a row when any alternative exists (no recursion — pick from a list).
    const near = this.sub.filter((s) => s !== a)
      .sort((x, y) => Math.abs(x.elo - a.elo) - Math.abs(y.elo - a.elo) || Math.random() - 0.5)
      .slice(0, NEAR_POOL)
      .sort((x, y) => (x.lastAt || 0) - (y.lastAt || 0) || Math.random() - 0.5);
    const cand = near.find((s) => [a.id, s.id].sort().join(':') !== this._lastPair) || near[0];
    this._lastPair = [a.id, cand.id].sort().join(':');
    // stamp NOW, not on completion: a match that crashes still counts as a
    // turn taken, or the same broken pair is retried on every single tick.
    // Strictly increasing rather than raw Date.now(): at MAX speed two picks
    // can land in the same millisecond, and equal stamps collapse the queue
    // back onto the match-count tiebreak — which is the bug being fixed.
    this._clock = Math.max(Date.now(), (this._clock || 0) + 1);
    a.lastAt = this._clock; cand.lastAt = this._clock;
    return [a, cand];
  }

  /** a scrimmage match just moved the board: match trophies, then standings */
  _award(a, b, result) {
    if (!this.book) return;
    const [wa, wb] = result.score;
    const board = this.board();
    for (const [entry, mine, theirs] of [[a, wa, wb], [b, wb, wa]]) {
      if (entry.owner === 'house') continue;
      try {
        this.book.fromMatch(entry.owner, {
          mode: 'ladder', level: null, houseName: null,
          won: mine > theirs,
          swept: mine > theirs && theirs === 0,
          blanked: mine === 0 && theirs > 0,
          flags: (result.flags || {})[entry.name],
        });
        const row = board.find((x) => x.id === entry.id);
        this.book.fromLadder(entry.owner, entry, row ? row.rank : null);
      } catch (err) {
        console.error('[ladder] achievements failed', err.message);
      }
    }
  }

  _playOne() {
    if (this.busy) return;
    this.ensureHouse();          // pick up any edit to a boss's slot
    const pair = this._pick();
    if (!pair) return;
    const [a, b] = pair;
    this.busy = true;
    const worker = new Worker(path.join(__dirname, 'arena-worker.js'), {
      workerData: {
        a: { name: a.name, source: a.source },
        b: { name: b.name, source: b.source },
        seedBase: crypto.randomBytes(4).readUInt32LE(0),
        seriesCount: SERIES_COUNT, seriesGames: SERIES_GAMES, sampleAt: SAMPLE_AT,
      },
    });
    const finish = (result) => {
      this.busy = false;
      // MAX speed: straight into the next one. setImmediate rather than a
      // direct call so the chain unwinds instead of nesting, and so the HTTP
      // server gets a turn of the event loop between matches.
      if (this.tickMs === MAX_SPEED && this.running) setImmediate(() => this._playOne());
      if (!result || !result.ok) return;   // a broken bot just skips its turn
      const [wa, wb] = result.score;
      const outcome = wa > wb ? 1 : wa < wb ? 0 : 0.5;
      const expected = 1 / (1 + Math.pow(10, (b.elo - a.elo) / 400));
      const delta = K * (outcome - expected);
      a.elo += delta; b.elo -= delta;
      a.matches++; b.matches++;
      if (wa > wb) a.wins++; else if (wb > wa) b.wins++;
      a.last.push(outcome); b.last.push(1 - outcome);
      if (a.last.length > 20) a.last.shift();
      if (b.last.length > 20) b.last.shift();
      a.errors += result.errors[a.name] || 0;
      b.errors += result.errors[b.name] || 0;
      this.store.ladder.totalMatches++;
      this.store.addMatch({
        mode: 'ladder', level: null,
        players: [a.name, b.name], owners: [a.owner, b.owner], ownerNames: [a.ownerName, b.ownerName],
        score: result.score,
        winnerName: wa > wb ? a.name : wb > wa ? b.name : null,
        gamesPerSeries: SERIES_GAMES,
        series: result.series,
        sources: [a.source, b.source],
        eloDelta: { [a.name]: Math.round(delta), [b.name]: Math.round(-delta) },
        errors: result.errors,
      });
      this._award(a, b, result);
      this._save();
    };
    worker.once('message', finish);
    worker.once('error', () => finish(null));
  }
}

module.exports = {
  LadderServer, SERIES_COUNT: SERIES_COUNT, LADDER_SERIES_GAMES: SERIES_GAMES, TICK_CHOICES,
};
