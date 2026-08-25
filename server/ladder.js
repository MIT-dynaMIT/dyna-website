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

const SERIES_COUNT = 7;
const SERIES_GAMES = Number(process.env.COUP_SERIES_GAMES || 100);
const K = 32;
const INTERVAL_MS = Number(process.env.LADDER_INTERVAL_MS || 40_000);
const SAMPLE_AT = [0, 49, 99];

class LadderServer {
  constructor(store) {
    this.store = store;
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
    this.ensureHouse();
  }

  get running() { return !!this.store.ladder.running; }

  get sub() { return this.store.ladder.submissions; }
  _save() { this.store._save('ladder.json', this.store.ladder); }

  /** Andrew defends the ladder for the house */
  ensureHouse() {
    const andrew = HOUSE.find((h) => h.name === 'Andrew') || HOUSE[HOUSE.length - 1];
    let e = this.sub.find((x) => x.owner === 'house');
    if (!e) {
      this.sub.push(this._entry('house', 'The House', -1, andrew.name, andrew.source));
      this._save();
    } else if (e.source !== andrew.source) {
      e.source = andrew.source; e.name = andrew.name;
      this._save();
    }
  }

  _entry(owner, ownerName, slot, name, source) {
    return {
      id: crypto.randomBytes(6).toString('hex'),
      owner, ownerName, slot, name: this._uniqueName(name || ownerName), source,
      elo: 1000, matches: 0, wins: 0, last: [], errors: 0, createdAt: Date.now(),
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
      };
    }
    const board = this.board();
    return {
      top: board.slice(0, 10),
      totalBots: board.length,
      totalMatches: this.store.ladder.totalMatches,
      running: this.running,
      hidden: false,
      seriesCount: SERIES_COUNT, seriesGames: SERIES_GAMES,
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
    this._timer = setInterval(tick, INTERVAL_MS);
    setTimeout(tick, 5_000);   // first match soon after starting
  }

  stop() {
    if (!this._timer) return;
    clearInterval(this._timer);
    this._timer = null;
  }

  _pick() {
    if (this.sub.length < 2 || !this.store.ladder.running) return null;
    // least-played first (ties broken randomly)
    const a = [...this.sub].sort((x, y) => x.matches - y.matches || Math.random() - 0.5)[0];
    // opponent: closest ELO wins, but never the exact same pairing twice in a
    // row when any alternative exists (no recursion — pick from a ranked list)
    const ranked = this.sub.filter((s) => s !== a)
      .sort((x, y) => Math.abs(x.elo - a.elo) - Math.abs(y.elo - a.elo) || Math.random() - 0.5);
    let cand = ranked.find((s) => [a.id, s.id].sort().join(':') !== this._lastPair) || ranked[0];
    this._lastPair = [a.id, cand.id].sort().join(':');
    return [a, cand];
  }

  _playOne() {
    if (this.busy) return;
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
      this._save();
    };
    worker.once('message', finish);
    worker.once('error', () => finish(null));
  }
}

module.exports = { LadderServer, SERIES_COUNT: SERIES_COUNT, LADDER_SERIES_GAMES: SERIES_GAMES };
