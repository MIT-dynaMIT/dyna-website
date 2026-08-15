/**
 * live — heads-up tables where BOTH seats are humans, plus the presence /
 * matchmaking layer around them: who's online, direct challenges, and the
 * organizer's "pair everyone up" button.
 *
 * Everything runs over plain polling HTTP, same as play.js: the game sits
 * still until whoever must decide posts a move. Each seat sees its own
 * fog-of-war view, so frames are recorded per seat.
 */
'use strict';

const crypto = require('node:crypto');
const { CoupGame } = require('./coup');

const ONLINE_MS = 12_000;      // seen a poll this recently = online
const SESSION_TTL = 3 * 3600 * 1000;
const INVITE_TTL = 60_000;

class LiveSession {
  /** @param seats [{username, displayName}] — exactly two humans */
  constructor(seats) {
    this.id = crypto.randomBytes(8).toString('hex');
    this.createdAt = Date.now();
    this.ids = ['p0', 'p1'];
    this.names = {};      // seat id -> display name
    this.userOf = {};     // seat id -> username
    this.seatOf = {};     // username -> seat id
    seats.forEach((u, i) => {
      const id = 'p' + i;
      this.names[id] = u.displayName;
      this.userOf[id] = u.username;
      this.seatOf[u.username] = id;
    });
    this.game = new CoupGame(this.ids);
    this.frames = { p0: [], p1: [] };
    this._logIdx = 0;
    this.forfeitedBy = null;
    this._snap();
  }

  _snap() {
    while (this._logIdx < this.game.log.length) {
      for (const id of this.ids) {
        this.frames[id].push({ log: this.game.log[this._logIdx], view: this.game.view(id) });
      }
      this._logIdx++;
    }
  }

  get done() { return !!this.game.winner || !!this.forfeitedBy; }

  winnerName() {
    if (this.forfeitedBy) return this.names[this.ids.find((id) => id !== this.forfeitedBy)];
    return this.game.winner ? this.names[this.game.winner] : null;
  }

  /** the one seat that must decide right now (heads-up: never two at once) */
  decider() {
    const pend = this.game.pending;
    if (!pend || this.done) return null;
    if (pend.type === 'challenge' || pend.type === 'block') return pend.who[0];
    return pend.player;
  }

  _actionInfo() {
    const g = this.game;
    const info = g.ctx ? {
      type: g.ctx.type,
      actor: this.names[g.ctx.actor],
      target: g.ctx.target ? this.names[g.ctx.target] : null,
      call: g.ctx.call || null,
      is_block: false, claimed_role: null,
    } : null;
    if (info && g.pending && g.pending.type === 'challenge' && g.pending.claim) {
      info.claimed_role = g.pending.claim.role;
      info.is_block = !!g.pending.blocking;
      if (g.pending.blocking) info.blocker = this.names[g.pending.claim.player];
    }
    return info;
  }

  /** the same Prompt shapes PlayPage already renders — null if not your turn */
  promptFor(seatId) {
    const g = this.game;
    const pend = g.pending;
    if (this.decider() !== seatId) return null;
    if (pend.type === 'action') {
      return {
        kind: 'action',
        actions: g.legalActions(seatId).map((a) => ({
          type: a.type, targets: (a.targets || []).map((t) => this.names[t]), call: !!a.call,
        })),
        mustCoup: !!pend.mustCoup,
      };
    }
    if (pend.type === 'challenge') {
      return { kind: 'respond', mode: 'challenge', action: this._actionInfo(), options: ['pass', 'challenge'] };
    }
    if (pend.type === 'block') {
      const isAssassination = g.ctx.type === 'assassinate' && seatId === g.ctx.target;
      return {
        kind: 'respond', mode: 'block', action: this._actionInfo(),
        options: ['pass', ...pend.roles.map((r) => 'block:' + r)],
        assassination: isAssassination,
      };
    }
    if (pend.type === 'lose') {
      return { kind: 'lose', why: pend.why, cards: g.player(seatId).cards.map((role, i) => ({ idx: i, role })) };
    }
    if (pend.type === 'exchange') {
      return { kind: 'exchange', pool: pend.pool, keep: pend.keep, reason: pend.reason };
    }
    return null;
  }

  move(username, msg) {
    const seat = this.seatOf[username];
    if (!seat) throw new Error('not at this table');
    if (this.done) throw new Error('game is over');
    if (this.decider() !== seat) throw new Error('not your decision');
    const g = this.game;
    const pend = g.pending;
    if (msg.kind === 'action') {
      if (pend.type !== 'action') throw new Error('no action pending');
      g._assassinP = 0; // humans decide their challenges live
      g.submitAction(seat, { type: msg.type, call: msg.call });
    } else if (msg.kind === 'respond') {
      // heads-up: you are the only possible responder, so a pass resolves it
      if (pend.type === 'challenge') {
        g.resolveChallenge(msg.what === 'challenge' ? seat : null);
      } else if (pend.type === 'block') {
        if (msg.what === 'block' && pend.roles.includes(msg.role)) g.resolveBlock(seat, msg.role);
        else g.resolveBlock(null, null);
      } else throw new Error('nothing to respond to');
    } else if (msg.kind === 'lose') {
      g.resolveLose(seat, Number(msg.idx));
    } else if (msg.kind === 'exchange') {
      g.resolveExchange(seat, (msg.keep || []).map(Number));
    } else {
      throw new Error('unknown move');
    }
    this._snap();
  }

  forfeit(username) {
    const seat = this.seatOf[username];
    if (!seat || this.done) return;
    this.forfeitedBy = seat;
  }

  snapshot(username, cursor = 0) {
    const seat = this.seatOf[username];
    const frames = this.frames[seat];
    const decider = this.decider();
    return {
      id: this.id,
      seatNames: this.ids.map((id) => this.names[id]),
      you: this.names[seat],
      youIndex: this.ids.indexOf(seat),
      view: this.game.view(seat),
      frames: frames.slice(cursor),
      cursor: frames.length,
      prompt: this.promptFor(seat),
      waitingFor: !this.done && decider && decider !== seat ? this.names[decider] : null,
      done: this.done,
      winnerName: this.winnerName(),
      forfeited: !!this.forfeitedBy,
    };
  }
}

class LiveManager {
  constructor(store) {
    this.store = store;
    this.sessions = new Map();     // id -> LiveSession
    this.assigned = new Map();     // username -> session id
    this.invites = new Map();      // to-username -> {from, ts}
    this.lastSeen = new Map();     // username -> ms
  }

  _gc() {
    const cutoff = Date.now() - SESSION_TTL;
    for (const [id, s] of this.sessions) {
      if (s.createdAt < cutoff) {
        this.sessions.delete(id);
        for (const u of Object.keys(s.seatOf)) {
          if (this.assigned.get(u) === id) this.assigned.delete(u);
        }
      }
    }
  }

  onlineUsers(except) {
    const now = Date.now();
    const out = [];
    for (const [username, ts] of this.lastSeen) {
      if (now - ts > ONLINE_MS || username === except) continue;
      const u = this.store.users[username];
      if (u) out.push({ username, displayName: u.displayName, role: u.role || 'student' });
    }
    return out.sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  _startMatch(users) {
    const s = new LiveSession(users);
    this.sessions.set(s.id, s);
    for (const u of users) {
      this.assigned.set(u.username, s.id);
      this.invites.delete(u.username);
    }
    return s;
  }

  challenge(fromUser, toUsername) {
    const to = this.store.users[String(toUsername || '').toLowerCase()];
    if (!to) return { error: 'no such player' };
    if (to.username === fromUser.username) return { error: 'you cannot duel yourself' };
    if ((Date.now() - (this.lastSeen.get(to.username) || 0)) > ONLINE_MS) return { error: 'they just went offline' };
    const cur = this.invites.get(to.username);
    if (cur && Date.now() - cur.ts < INVITE_TTL) return { error: 'they already have a challenge pending' };
    this.invites.set(to.username, { from: fromUser.username, ts: Date.now() });
    return { ok: true };
  }

  respondInvite(user, accept) {
    const inv = this.invites.get(user.username);
    this.invites.delete(user.username);
    if (!inv || Date.now() - inv.ts > INVITE_TTL) return { error: 'that challenge expired' };
    if (!accept) return { ok: true };
    const from = this.store.users[inv.from];
    if (!from) return { error: 'challenger vanished' };
    const s = this._startMatch([
      { username: from.username, displayName: from.displayName },
      { username: user.username, displayName: user.displayName },
    ]);
    return { ok: true, match: s.id };
  }

  /** organizer button: random-pair every online STUDENT into live matches */
  pairStudents() {
    this._gc();
    const pool = this.onlineUsers(null).filter((u) => {
      if (u.role !== 'student') return false;
      const cur = this.sessions.get(this.assigned.get(u.username));
      return !cur || cur.done;    // don't yank anyone out of a live game
    });
    // Fisher–Yates, then pair off neighbours
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const matches = [];
    for (let i = 0; i + 1 < pool.length; i += 2) {
      matches.push(this._startMatch([pool[i], pool[i + 1]]));
    }
    return {
      matches: matches.length,
      paired: matches.length * 2,
      benched: pool.length % 2 ? pool[pool.length - 1].displayName : null,
    };
  }

  /** every client polls this: presence heartbeat + invites + where you belong */
  poll(user) {
    this.lastSeen.set(user.username, Date.now());
    const inv = this.invites.get(user.username);
    const invite = inv && Date.now() - inv.ts < INVITE_TTL
      ? { from: inv.from, fromName: (this.store.users[inv.from] || {}).displayName || inv.from }
      : null;
    const matchId = this.assigned.get(user.username) || null;
    const match = matchId && this.sessions.has(matchId) ? matchId : null;
    return { online: this.onlineUsers(user.username), invite, match };
  }

  leave(user) {
    const id = this.assigned.get(user.username);
    const s = id && this.sessions.get(id);
    if (s && !s.done) s.forfeit(user.username);   // walking out mid-game concedes
    this.assigned.delete(user.username);
  }

  get(id) { return this.sessions.get(id) || null; }
}

module.exports = { LiveManager, LiveSession };
