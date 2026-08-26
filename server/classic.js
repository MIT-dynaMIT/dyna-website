/**
 * classic — CLASSIC multiplayer Coup (3-6 players, 15 cards, standard rules).
 * Completely separate from the heads-up "Ultimate" engine in coup.js: five
 * roles, two influence each, open challenge/block windows, last one standing.
 *
 * Same lazy-timer model as live.js: nothing ticks on its own — every poll
 * and move first enforces expired clocks (10s turns, 5s reaction windows).
 */
'use strict';

const crypto = require('node:crypto');

const ROLES = ['duke', 'assassin', 'captain', 'ambassador', 'contessa'];
const COPIES = 3;
const MOVE_MS = Number(process.env.COUP_MOVE_MS || 12_000);
const REACT_MS = Number(process.env.COUP_MULTI_REACT_MS || 7_000);

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

class ClassicGame {
  /** @param ids seat ids, 3-6 of them */
  constructor(ids) {
    this.ids = [...ids];
    this.deck = shuffled(ROLES.flatMap((r) => Array(COPIES).fill(r)));
    this.players = {};
    for (const id of ids) {
      this.players[id] = { id, coins: 2, cards: [this.deck.pop(), this.deck.pop()], revealed: [] };
    }
    this.log = [];
    this.winner = null;
    this.turn = null;
    this.pending = null;   // {type:'action'|'challenge'|'block'|'lose'|'exchange', ...}
    this.ctx = null;       // the action being resolved
    this._beginTurn(this.ids[0]);
  }

  p(id) { return this.players[id]; }
  alive(id) { return this.p(id).cards.length > 0; }
  aliveIds() { return this.ids.filter((id) => this.alive(id)); }
  _log(e) { this.log.push(e); }

  _beginTurn(id) {
    if (this._maybeFinish()) return;
    if (!this.alive(id)) return this._beginTurn(this._next(id));
    this.turn = id;
    this.ctx = null;
    this.pending = { type: 'action', player: id, mustCoup: this.p(id).coins >= 10 };
  }
  _next(id) {
    const i = this.ids.indexOf(id);
    for (let k = 1; k <= this.ids.length; k++) {
      const cand = this.ids[(i + k) % this.ids.length];
      if (this.alive(cand)) return cand;
    }
    return id;
  }
  _endTurn() {
    if (this._maybeFinish()) return;
    this._beginTurn(this._next(this.turn));
  }
  _maybeFinish() {
    const alive = this.aliveIds();
    if (alive.length === 1) {
      this.winner = alive[0];
      this.pending = null;
      this._log({ t: 'win', player: alive[0] });
      return true;
    }
    return false;
  }

  legalActions(id) {
    const me = this.p(id);
    const targets = this.aliveIds().filter((x) => x !== id);
    if (me.coins >= 10) return [{ type: 'coup', targets, needsTarget: true }];
    const acts = [
      { type: 'income' }, { type: 'foreign_aid' },
      { type: 'tax' }, { type: 'exchange' },
      { type: 'steal', targets, needsTarget: true },
    ];
    if (me.coins >= 3) acts.push({ type: 'assassinate', targets, needsTarget: true });
    if (me.coins >= 7) acts.push({ type: 'coup', targets, needsTarget: true });
    return acts;
  }

  static CLAIM = { tax: 'duke', assassinate: 'assassin', steal: 'captain', exchange: 'ambassador' };

  submitAction(id, { type, target }) {
    const pend = this.pending;
    if (!pend || pend.type !== 'action' || pend.player !== id) throw new Error('not your turn');
    const me = this.p(id);
    const legal = this.legalActions(id).find((a) => a.type === type);
    if (!legal) throw new Error('that move is not allowed right now');
    if (legal.needsTarget) {
      if (!target || !this.alive(target) || target === id) throw new Error('pick a target');
    }
    this.ctx = { type, actor: id, target: legal.needsTarget ? target : null, claimRole: ClassicGame.CLAIM[type] || null, blockRoles: null };
    this._log({ t: 'action', player: id, action: type, target: this.ctx.target });
    if (type === 'coup') { me.coins -= 7; return this._queueLose(target, 'couped', 'end'); }
    if (type === 'assassinate') me.coins -= 3;   // paid up front, never refunded
    if (type === 'income') { me.coins += 1; return this._endTurn(); }
    if (this.ctx.claimRole) {
      return this._openChallenge(this.ctx.claimRole, id, false);
    }
    // foreign aid: no claim, straight to the block window
    return this._openBlock();
  }

  /** who may challenge/block right now; challenge windows exclude the claimant */
  _openChallenge(role, claimant, blocking) {
    const who = this.aliveIds().filter((x) => x !== claimant);
    if (!who.length) return blocking ? this._blockStands() : this._applyAction();
    this.pending = { type: 'challenge', who, passed: [], claim: { player: claimant, role }, blocking };
  }
  _openBlock() {
    const { type, actor, target } = this.ctx;
    let who = null, roles = null;
    if (type === 'foreign_aid') { who = this.aliveIds().filter((x) => x !== actor); roles = ['duke']; }
    else if (type === 'assassinate') { who = target && this.alive(target) ? [target] : []; roles = ['contessa']; }
    else if (type === 'steal') { who = target && this.alive(target) ? [target] : []; roles = ['captain', 'ambassador']; }
    if (!who || !who.length || !roles) return this._applyAction();
    this.pending = { type: 'block', who, passed: [], roles };
  }

  /** one player's answer inside a reaction window */
  respond(id, msg) {
    const pend = this.pending;
    if (!pend || (pend.type !== 'challenge' && pend.type !== 'block')) throw new Error('nothing to respond to');
    if (!pend.who.includes(id)) throw new Error('not your call');
    if (pend.passed.includes(id)) throw new Error('you already passed');
    if (pend.type === 'challenge') {
      if (msg.what === 'challenge') return this._resolveChallenge(id);
      pend.passed.push(id);
      if (pend.passed.length >= pend.who.length) {
        return pend.blocking ? this._blockStands() : this._afterClaimStands();
      }
      return;
    }
    // block window
    if (msg.what === 'block' && pend.roles.includes(msg.role)) {
      this.ctx.blockRoles = pend.roles;
      this._log({ t: 'block', player: id, role: msg.role, action: this.ctx.type });
      this.ctx.blocker = id;
      return this._openChallenge(msg.role, id, true);
    }
    pend.passed.push(id);
    if (pend.passed.length >= pend.who.length) return this._applyAction();
  }

  _resolveChallenge(challengerId) {
    const { claim, blocking } = this.pending;
    const claimant = this.p(claim.player);
    const truthful = claimant.cards.includes(claim.role);
    this._log({ t: 'challenge', by: challengerId, against: claim.player, role: claim.role, truthful });
    if (truthful) {
      // shuffle the shown card back, draw a fresh one, challenger pays a card
      claimant.cards.splice(claimant.cards.indexOf(claim.role), 1);
      this.deck.push(claim.role);
      this.deck = shuffled(this.deck);
      claimant.cards.push(this.deck.pop());
      this._log({ t: 'proved', player: claim.player, role: claim.role });
      return this._queueLose(challengerId, 'lost the challenge', blocking ? 'blocked' : 'stands');
    }
    // bluff: claimant pays a card; a bluffed block lets the action through
    return this._queueLose(claim.player, 'caught bluffing', blocking ? 'action' : 'end');
  }

  _afterClaimStands() { return this._openBlock(); }
  _blockStands() {
    this._log({ t: 'blocked', action: this.ctx.type, by: this.ctx.blocker });
    return this._endTurn();
  }

  _applyAction() {
    const { type, actor, target } = this.ctx;
    const me = this.p(actor);
    if (type === 'foreign_aid') { me.coins += 2; this._log({ t: 'gain', player: actor, amount: 2 }); return this._endTurn(); }
    if (type === 'tax') { me.coins += 3; this._log({ t: 'gain', player: actor, amount: 3 }); return this._endTurn(); }
    if (type === 'steal') {
      if (!target || !this.alive(target)) return this._endTurn();
      const amt = Math.min(2, this.p(target).coins);
      this.p(target).coins -= amt; me.coins += amt;
      this._log({ t: 'stole', actor, target, amount: amt });
      return this._endTurn();
    }
    if (type === 'assassinate') {
      if (!target || !this.alive(target)) return this._endTurn();
      return this._queueLose(target, 'assassinated', 'end');
    }
    if (type === 'exchange') {
      const pool = [...me.cards, this.deck.pop(), this.deck.pop()].filter(Boolean);
      this.pending = { type: 'exchange', player: actor, pool, keep: me.cards.length };
      return;
    }
    return this._endTurn();
  }

  resolveExchange(id, keepIdxs) {
    const pend = this.pending;
    if (!pend || pend.type !== 'exchange' || pend.player !== id) throw new Error('no exchange pending');
    const me = this.p(id);
    const idxs = [...new Set((keepIdxs || []).map(Number))].filter((i) => i >= 0 && i < pend.pool.length);
    if (idxs.length !== pend.keep) throw new Error(`keep exactly ${pend.keep}`);
    me.cards = idxs.map((i) => pend.pool[i]);
    const back = pend.pool.filter((_, i) => !idxs.includes(i));
    this.deck.push(...back);
    this.deck = shuffled(this.deck);
    this._log({ t: 'exchanged', player: id });
    this.pending = null;
    return this._endTurn();
  }

  /** influence loss — auto-flips a last card, otherwise asks.
   *  `then` says what resumes afterwards: 'action' | 'blocked' | 'end'. */
  _queueLose(id, why, then) {
    const pl = this.p(id);
    if (!this.alive(id)) return this._resume(then);
    if (pl.cards.length === 1) {
      this._flip(id, 0, why);
      if (this._maybeFinish()) return;
      return this._resume(then);
    }
    this.pending = { type: 'lose', player: id, why, then };
  }
  resolveLose(id, idx) {
    const pend = this.pending;
    if (!pend || pend.type !== 'lose' || pend.player !== id) throw new Error('not your choice');
    const pl = this.p(id);
    const i = Number(idx);
    if (!(i >= 0 && i < pl.cards.length)) throw new Error('bad card');
    this.pending = null;
    this._flip(id, i, pend.why);
    if (this._maybeFinish()) return;
    return this._resume(pend.then);
  }
  _flip(id, idx, why) {
    const pl = this.p(id);
    const [role] = pl.cards.splice(idx, 1);
    pl.revealed.push(role);
    this._log({ t: 'lost', player: id, role, why, out: pl.cards.length === 0 });
  }
  _resume(then) {
    if (then === 'action') return this._applyAction();
    if (then === 'stands') return this._afterClaimStands();   // survived challenge → block window still opens
    if (then === 'blocked') return this._blockStands();
    return this._endTurn();
  }

  view(forId) {
    return {
      players: this.ids.map((id) => {
        const pl = this.p(id);
        return {
          id, coins: pl.coins, alive: pl.cards.length > 0,
          influence: pl.cards.length, revealed: [...pl.revealed],
          cards: id === forId ? [...pl.cards] : pl.cards.map(() => null),
        };
      }),
      deckCount: this.deck.length,
      turn: this.turn,
      winner: this.winner,
    };
  }
}

module.exports = { ClassicGame, ROLES, MOVE_MS, REACT_MS };
