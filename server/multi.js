/**
 * multi — the tables lobby around classic Coup. Players sit at 4-6 seat
 * tables (5 suggested); a table only exists because someone sat at it, and
 * the game deals itself the moment the last seat fills. After a game the
 * table goes back to waiting with its players still seated.
 */
'use strict';

const crypto = require('node:crypto');
const { ClassicGame, MOVE_MS, REACT_MS } = require('./classic');

const TABLE_TTL = 3 * 3600 * 1000;

class ClassicSession {
  /** @param seats [{username, displayName}] */
  constructor(seats) {
    this.ids = seats.map((_, i) => 'p' + i);
    this.names = {}; this.userOf = {}; this.seatOf = {};
    seats.forEach((u, i) => {
      const id = 'p' + i;
      this.names[id] = u.displayName;
      this.userOf[id] = u.username;
      this.seatOf[u.username] = id;
    });
    this.game = new ClassicGame(this.ids);
    this.frames = Object.fromEntries(this.ids.map((id) => [id, []]));
    this._logIdx = 0;
    this.quitters = new Set();
    this._snap();
    this._decisionKey = null;
    this.deadline = 0;
    this._armTimer();
  }

  get done() { return !!this.game.winner; }
  winnerName() { return this.game.winner ? this.names[this.game.winner] : null; }

  _snap() {
    while (this._logIdx < this.game.log.length) {
      for (const id of this.ids) {
        this.frames[id].push({ log: this.game.log[this._logIdx], view: this.game.view(id) });
      }
      this._logIdx++;
    }
  }

  _currentKey() {
    const pend = this.game.pending;
    if (!pend) return null;
    const waiting = pend.who ? pend.who.filter((w) => !pend.passed.includes(w)).join(',') : pend.player;
    return `${this.game.log.length}:${pend.type}:${waiting}`;
  }
  _armTimer() {
    const key = this._currentKey();
    if (key !== this._decisionKey) {
      this._decisionKey = key;
      const pend = this.game.pending;
      const isReaction = pend && (pend.type === 'challenge' || pend.type === 'block');
      this.deadline = Date.now() + (isReaction ? REACT_MS : MOVE_MS);
    }
  }

  /** expired clocks play safe defaults; quitters always auto-play instantly */
  enforceTimer() {
    let guard = 0;
    while (!this.done && ++guard < 60) {
      const g = this.game;
      const pend = g.pending;
      if (!pend) break;
      const actorId = pend.who ? null : pend.player;
      const isQuitter = actorId && this.quitters.has(actorId);
      const expired = this.deadline && Date.now() > this.deadline;
      if (pend.type === 'challenge' || pend.type === 'block') {
        // quitters inside a window pass immediately
        let acted = false;
        for (const w of [...pend.who]) {
          if (!pend.passed.includes(w) && this.quitters.has(w)) {
            g.respond(w, { what: 'pass' });
            acted = true;
            if (g.pending !== pend) break;
          }
        }
        if (acted) { this._snap(); this._armTimer(); continue; }
        if (!expired) break;
        // window timed out → everyone still silent passes
        for (const w of [...pend.who]) {
          if (!pend.passed.includes(w)) {
            g.respond(w, { what: 'pass' });
            if (g.pending !== pend) break;
          }
        }
        this._snap(); this._armTimer(); continue;
      }
      if (!expired && !isQuitter) break;
      if (pend.type === 'action') {
        const legal = g.legalActions(pend.player);
        const coup = legal.find((a) => a.type === 'coup');
        if (pend.mustCoup && coup) {
          const t = coup.targets[Math.floor(Math.random() * coup.targets.length)];
          g.submitAction(pend.player, { type: 'coup', target: t });
        } else {
          g.submitAction(pend.player, { type: 'income' });
        }
      } else if (pend.type === 'lose') {
        g.resolveLose(pend.player, 0);
      } else if (pend.type === 'exchange') {
        g.resolveExchange(pend.player, Array.from({ length: pend.keep }, (_, i) => i));
      }
      this._snap(); this._armTimer();
    }
    this._armTimer();
  }

  move(username, msg) {
    this.enforceTimer();
    const seat = this.seatOf[username];
    if (!seat) throw new Error('not at this table');
    if (this.done) throw new Error('game is over');
    const g = this.game;
    if (msg.kind === 'action') g.submitAction(seat, { type: msg.type, target: msg.target });
    else if (msg.kind === 'respond') g.respond(seat, { what: msg.what, role: msg.role });
    else if (msg.kind === 'lose') g.resolveLose(seat, Number(msg.idx));
    else if (msg.kind === 'exchange') g.resolveExchange(seat, (msg.keep || []).map(Number));
    else throw new Error('unknown move');
    this._snap();
    this._armTimer();
  }

  /** leaving mid-game: their turns/windows auto-play from now on */
  quit(username) {
    const seat = this.seatOf[username];
    if (seat) { this.quitters.add(seat); this.enforceTimer(); }
  }

  promptFor(seat) {
    const g = this.game;
    const pend = g.pending;
    if (!pend || this.done) return null;
    if (pend.type === 'action' && pend.player === seat) {
      return {
        kind: 'action', mustCoup: !!pend.mustCoup,
        actions: g.legalActions(seat).map((a) => ({
          type: a.type, needsTarget: !!a.needsTarget,
          targets: (a.targets || []).map((t) => ({ id: t, name: this.names[t] })),
        })),
      };
    }
    if ((pend.type === 'challenge' || pend.type === 'block')
        && pend.who.includes(seat) && !pend.passed.includes(seat)) {
      const info = g.ctx ? {
        type: g.ctx.type, actor: this.names[g.ctx.actor],
        target: g.ctx.target ? this.names[g.ctx.target] : null,
      } : null;
      if (pend.type === 'challenge') {
        return {
          kind: 'respond', mode: 'challenge', action: info,
          claim: { player: this.names[pend.claim.player], role: pend.claim.role, blocking: !!pend.blocking },
          options: ['pass', 'challenge'],
        };
      }
      return { kind: 'respond', mode: 'block', action: info, options: ['pass', ...pend.roles.map((r) => 'block:' + r)] };
    }
    if (pend.type === 'lose' && pend.player === seat) {
      return { kind: 'lose', why: pend.why, cards: g.p(seat).cards.map((role, i) => ({ idx: i, role })) };
    }
    if (pend.type === 'exchange' && pend.player === seat) {
      return { kind: 'exchange', pool: pend.pool, keep: pend.keep };
    }
    return null;
  }

  snapshot(username, cursor = 0) {
    this.enforceTimer();
    const seat = this.seatOf[username];
    const frames = this.frames[seat] || [];
    const pend = this.game.pending;
    const waitingIds = !pend ? []
      : pend.who ? pend.who.filter((w) => !pend.passed.includes(w))
      : [pend.player];
    return {
      seatNames: this.ids.map((id) => this.names[id]),
      you: this.names[seat],
      youIndex: this.ids.indexOf(seat),
      view: this.game.view(seat),
      frames: frames.slice(cursor),
      cursor: frames.length,
      prompt: this.promptFor(seat),
      waitingFor: this.done ? [] : waitingIds.map((id) => this.names[id]),
      timerMs: !this.done && pend ? Math.max(0, this.deadline - Date.now()) : null,
      done: this.done,
      winnerName: this.winnerName(),
    };
  }
}

class MultiManager {
  constructor(store) {
    this.store = store;
    this.tables = new Map();   // id -> table
  }

  _gc() {
    const cutoff = Date.now() - TABLE_TTL;
    for (const [id, t] of this.tables) if (t.createdAt < cutoff) this.tables.delete(id);
  }

  _tableOf(username) {
    for (const t of this.tables.values()) {
      if (t.seats.some((s) => s.username === username)) return t;
    }
    return null;
  }

  create(user, size) {
    this._gc();
    const n = Math.max(4, Math.min(6, Number(size) || 5));
    if (this._tableOf(user.username)) return { error: 'you are already at a table — leave it first' };
    const t = {
      id: crypto.randomBytes(6).toString('hex'),
      size: n, createdAt: Date.now(),
      seats: [{ username: user.username, displayName: user.displayName }],
      session: null,
    };
    this.tables.set(t.id, t);
    return { table: this._pub(t) };
  }

  sit(user, tableId) {
    this._gc();
    if (this._tableOf(user.username)) return { error: 'you are already at a table — leave it first' };
    const t = this.tables.get(tableId);
    if (!t) return { error: 'that table is gone' };
    if (t.session && !t.session.done) return { error: 'that game already started' };
    if (t.seats.length >= t.size) return { error: 'that table is full' };
    t.seats.push({ username: user.username, displayName: user.displayName });
    if (t.seats.length === t.size) {
      t.session = new ClassicSession(t.seats);
    }
    return { table: this._pub(t) };
  }

  leave(user) {
    const t = this._tableOf(user.username);
    if (!t) return { ok: true };
    if (t.session && !t.session.done) {
      t.session.quit(user.username);   // mid-game: seat plays itself out
    }
    t.seats = t.seats.filter((s) => s.username !== user.username);
    if (!t.seats.length) this.tables.delete(t.id);
    else if (t.session && t.session.done) t.session = null;   // back to waiting
    return { ok: true };
  }

  /** lobby + where-am-I, one poll */
  lobby(user) {
    this._gc();
    const mine = this._tableOf(user.username);
    // finished game with players still seated → reset to waiting
    for (const t of this.tables.values()) {
      if (t.session && t.session.done) {
        const doneAt = t.session._doneAt || (t.session._doneAt = Date.now());
        if (Date.now() - doneAt > 15_000) t.session = t.seats.length === t.size ? new ClassicSession(t.seats) : null;
      }
    }
    return {
      tables: [...this.tables.values()].map((t) => this._pub(t)),
      mine: mine ? { id: mine.id, playing: !!(mine.session && !mine.session.done), over: !!(mine.session && mine.session.done) } : null,
    };
  }

  _pub(t) {
    return {
      id: t.id, size: t.size,
      seated: t.seats.map((s) => s.displayName),
      open: t.size - t.seats.length,
      playing: !!(t.session && !t.session.done),
    };
  }

  session(user) {
    const t = this._tableOf(user.username);
    return t && t.session ? t.session : null;
  }
}

module.exports = { MultiManager, ClassicSession };
