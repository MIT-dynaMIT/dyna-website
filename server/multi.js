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
    this.bluffs = Object.fromEntries(this.ids.map((id) => [id, new Set()]));
    this.quitters = new Set();
    this.bots = new Set(seats.map((u, i) => u.bot ? 'p' + i : null).filter(Boolean));
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
    // bots ponder once per WINDOW (not per response), so a table of bots
    // answers together after a beat instead of one pass per poll
    const pend = this.game.pending;
    const botKey = pend ? this.game.log.length + ':' + pend.type : null;
    if (botKey !== this._botKey) {
      this._botKey = botKey;
      this._botAt = Date.now() + 700 + Math.floor(Math.random() * 800);
    }
  }

  /** simple honest-leaning policy for practice-table bots */
  _botDecide(seat) {
    const g = this.game;
    const pend = g.pending;
    const me = g.p(seat);
    const R = Math.random;
    if (pend.type === 'action') {
      const legal = g.legalActions(seat);
      const pick = (t) => legal.find((a) => a.type === t);
      const richest = (ts) => ts.reduce((b, t) => g.p(t).coins > g.p(b).coins ? t : b, ts[0]);
      const coup = pick('coup');
      if (coup && (pend.mustCoup || me.coins >= 7)) return { kind: 'action', type: 'coup', target: richest(coup.targets) };
      const kill = pick('assassinate');
      if (kill && me.cards.includes('assassin') && R() < 0.6) return { kind: 'action', type: 'assassinate', target: richest(kill.targets) };
      if (me.cards.includes('duke')) return { kind: 'action', type: 'tax' };
      const steal = pick('steal');
      if (steal && me.cards.includes('captain')) {
        const t = richest(steal.targets);
        if (g.p(t).coins >= 2) return { kind: 'action', type: 'steal', target: t };
      }
      if (me.cards.includes('ambassador') && R() < 0.3) return { kind: 'action', type: 'exchange' };
      if (R() < 0.25) return { kind: 'action', type: 'tax' };   // the occasional bluff
      return { kind: 'action', type: R() < 0.5 ? 'foreign_aid' : 'income' };
    }
    if (pend.type === 'challenge') {
      return { kind: 'respond', what: R() < 0.12 ? 'challenge' : 'pass' };
    }
    if (pend.type === 'block') {
      for (const r of pend.roles) if (me.cards.includes(r)) return { kind: 'respond', what: 'block', role: r };
      if (pend.roles.includes('contessa') && R() < 0.35) return { kind: 'respond', what: 'block', role: 'contessa' };
      if (pend.roles.includes('duke') && R() < 0.1) return { kind: 'respond', what: 'block', role: 'duke' };
      return { kind: 'respond', what: 'pass' };
    }
    if (pend.type === 'lose') {
      const order = ['ambassador', 'captain', 'assassin', 'contessa', 'duke'];
      let idx = 0;
      for (const r of order) { const i = me.cards.indexOf(r); if (i >= 0) { idx = i; break; } }
      return { kind: 'lose', idx };
    }
    if (pend.type === 'exchange') {
      const order = ['duke', 'contessa', 'assassin', 'captain', 'ambassador'];
      const ranked = pend.pool.map((r, i) => ({ r, i })).sort((a, b) => order.indexOf(a.r) - order.indexOf(b.r));
      return { kind: 'exchange', keep: ranked.slice(0, pend.keep).map((x) => x.i) };
    }
    return null;
  }

  _applyBotMove(seat, mv) {
    const g = this.game;
    if (mv.kind === 'action') g.submitAction(seat, { type: mv.type, target: mv.target });
    else if (mv.kind === 'respond') g.respond(seat, { what: mv.what, role: mv.role });
    else if (mv.kind === 'lose') g.resolveLose(seat, mv.idx);
    else if (mv.kind === 'exchange') g.resolveExchange(seat, mv.keep);
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
      const botReady = Date.now() >= (this._botAt || 0);
      // bot inside a reaction window
      if ((pend.type === 'challenge' || pend.type === 'block') && botReady) {
        // every silent bot answers in this one pass; stop if the window resolves
        let acted = false;
        for (const w of [...pend.who]) {
          if (this.game.pending !== pend) break;
          if (!pend.passed.includes(w) && this.bots.has(w) && !this.quitters.has(w)) {
            try { this._applyBotMove(w, this._botDecide(w)); }
            catch { this.game.respond(w, { what: 'pass' }); }
            acted = true;
          }
        }
        if (acted) { this._snap(); this._armTimer(); continue; }
      }
      // bot holding a solo decision
      if (actorId && this.bots.has(actorId) && !this.quitters.has(actorId) && botReady) {
        try { this._applyBotMove(actorId, this._botDecide(actorId)); }
        catch { /* fall through to defaults on its real deadline */ }
        this._snap(); this._armTimer(); continue;
      }
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

  /** claiming a card this seat cannot show is a bluff — remember which */
  _noteBluff(seat, role) {
    if (role && !this.game.p(seat).cards.includes(role)) this.bluffs[seat].add(role);
  }

  /** {won, bluffed} for one seat, for the achievement book */
  outcomeFor(username) {
    const seat = this.seatOf[username];
    if (!seat) return null;
    return {
      won: this.done && this.game.winner === seat,
      bluffed: this.bluffs[seat].size > 0,
    };
  }

  move(username, msg) {
    this.enforceTimer();
    const seat = this.seatOf[username];
    if (!seat) throw new Error('not at this table');
    if (this.done) throw new Error('game is over');
    const g = this.game;
    if (msg.kind === 'action') {
      this._noteBluff(seat, ClassicGame.CLAIM[msg.type]);
      g.submitAction(seat, { type: msg.type, target: msg.target });
    } else if (msg.kind === 'respond') {
      if (msg.what === 'block') this._noteBluff(seat, msg.role);
      g.respond(seat, { what: msg.what, role: msg.role });
    } else if (msg.kind === 'lose') g.resolveLose(seat, Number(msg.idx));
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

  create(user, size, practice = false) {
    this._gc();
    const n = Math.max(4, Math.min(6, Number(size) || 5));
    if (this._tableOf(user.username)) return { error: 'you are already at a table — leave it first' };
    const t = {
      id: crypto.randomBytes(6).toString('hex'),
      size: n, createdAt: Date.now(), practice,
      seats: [{ username: user.username, displayName: user.displayName }],
      session: null,
    };
    if (practice) {
      const NAMES = ['Bufo Verde', 'Sir Bufo', 'Baron Bufo', 'Bufo the Bold', 'Bufo Prime'];
      for (let i = 0; t.seats.length < n; i++) {
        t.seats.push({ username: '__bufo' + i + '_' + t.id, displayName: NAMES[i % NAMES.length], bot: true });
      }
      t.session = new ClassicSession(t.seats);
    }
    this.tables.set(t.id, t);
    return { table: this._pub(t) };
  }

  sit(user, tableId) {
    this._gc();
    if (this._tableOf(user.username)) return { error: 'you are already at a table — leave it first' };
    const t = this.tables.get(tableId);
    if (!t) return { error: 'that table is gone' };
    if (t.practice) return { error: 'that is a practice table' };
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
    if (!t.seats.length || t.seats.every((s) => s.bot)) this.tables.delete(t.id);
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
      id: t.id, size: t.size, practice: !!t.practice,
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
