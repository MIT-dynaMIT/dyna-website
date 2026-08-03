/**
 * Heads-up Coup engine — the two-player "Ultimate" variant
 * (https://shelfgamer.com/coup-two-player-ultimate-variant/).
 *
 * Differences from standard Coup:
 *  - Exactly 2 players, full 15-card court deck.
 *  - FIVE LIVES each: a dead character goes face-up to the player's graveyard
 *    and is replaced from the deck — but the 4th and 5th deaths are NOT
 *    replaced. The game ends when someone's 5th character dies.
 *  - CALL THE COUP (and assassinations): the attacker names a character.
 *    If the defender holds it, that exact card dies. If not, the attack
 *    MISSES: the defender reveals their hand, draws two, keeps a hand's
 *    worth of the four, and returns the rest to the TOP of the deck.
 *  - Everything else is standard: income +1, foreign aid +2 (Duke blocks),
 *    tax +3 (Duke), steal 2 (Captain; blocked by Captain/Ambassador),
 *    assassinate 3 (Assassin; blocked by Contessa), exchange (Ambassador),
 *    coup 7 unstoppable-but-callable, 10+ coins must coup, challenges on
 *    every role claim with card replacement for truthful claimants.
 *
 * Driver contract is unchanged: the engine stops at `pending` and the driver
 * calls the matching resolve method. Deterministic under a seeded rng.
 */
'use strict';

const ROLES = ['duke', 'assassin', 'captain', 'ambassador', 'contessa'];
const LIVES = 5;
const REPLACE_UNTIL = 3; // deaths 1..3 are replaced from the deck

const ACTIONS = {
  income: { label: 'Income', cost: 0 },
  foreign_aid: { label: 'Foreign Aid', cost: 0, blockedBy: ['duke'] },
  coup: { label: 'Coup', cost: 7, targeted: true, call: true },
  tax: { label: 'Tax', cost: 0, role: 'duke' },
  assassinate: { label: 'Assassinate', cost: 3, role: 'assassin', targeted: true, call: true, blockedBy: ['contessa'] },
  steal: { label: 'Steal', cost: 0, role: 'captain', targeted: true, blockedBy: ['captain', 'ambassador'] },
  exchange: { label: 'Exchange', cost: 0, role: 'ambassador' },
};

function defaultRng() { return Math.random(); }

class CoupGame {
  constructor(playerIds, rng = defaultRng) {
    if (playerIds.length !== 2) throw new Error('heads-up: exactly 2 players');
    this.rng = rng;
    this.deck = [];
    for (const r of ROLES) this.deck.push(r, r, r);
    this._shuffle(this.deck);
    this.players = playerIds.map((id) => ({
      id,
      coins: 2,
      cards: [this.deck.pop(), this.deck.pop()], // active hand: role strings
      graveyard: [],                             // face-up dead characters
    }));
    this.turnIdx = 0;
    this.winner = null;
    this.log = [];
    this.ctx = null;
    this.loseQueue = [];   // [{playerId, why, forcedRole?}]
    this.pending = null;
    this._beginTurn(true);
  }

  // ------------------------------------------------------------ helpers
  _shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
  }

  player(id) { return this.players.find((p) => p.id === id); }
  other(id) { return this.players.find((p) => p.id !== id); }
  isAlive(p) { return p.graveyard.length < LIVES && p.cards.length > 0; }
  alivePlayers() { return this.players.filter((p) => this.isAlive(p)); }
  current() { return this.players[this.turnIdx]; }
  hasRole(p, role) { return p.cards.includes(role); }
  livesLeft(p) { return LIVES - p.graveyard.length; }

  _log(entry) { this.log.push(Object.assign({ n: this.log.length }, entry)); }

  /** truthful claimant returns the shown card to the deck and redraws */
  _replaceCard(p, role) {
    const i = p.cards.indexOf(role);
    this.deck.push(p.cards.splice(i, 1)[0]);
    this._shuffle(this.deck);
    p.cards.push(this.deck.pop());
  }

  // ------------------------------------------------------------ turn flow
  _beginTurn(first = false) {
    if (this._maybeFinish()) return;
    if (!first) this.turnIdx = (this.turnIdx + 1) % 2;
    const p = this.current();
    this.ctx = null;
    this.pending = { type: 'action', player: p.id, mustCoup: p.coins >= 10 };
  }

  _maybeFinish() {
    const dead = this.players.find((p) => !this.isAlive(p));
    if (dead) {
      this.winner = this.other(dead.id).id;
      this.pending = null;
      this._log({ t: 'win', player: this.winner });
      return true;
    }
    return false;
  }

  legalActions(playerId) {
    const p = this.player(playerId);
    if (!p || !this.pending || this.pending.type !== 'action' || this.pending.player !== playerId) return [];
    const opp = this.other(playerId);
    const targets = this.isAlive(opp) ? [opp.id] : [];
    if (p.coins >= 10) return [{ type: 'coup', targets, call: true }];
    const out = [];
    for (const [type, a] of Object.entries(ACTIONS)) {
      if (a.cost > p.coins) continue;
      out.push({ type, ...(a.targeted ? { targets } : {}), ...(a.call ? { call: true } : {}) });
    }
    return out;
  }

  // ------------------------------------------------------------ submissions
  /** pending 'action' → {type, call?} — call = named role for coup/assassinate */
  submitAction(playerId, { type, call }) {
    this._expect('action', playerId);
    const a = ACTIONS[type];
    const p = this.player(playerId);
    if (!a) throw new Error('unknown action');
    if (p.coins >= 10 && type !== 'coup') throw new Error('must coup at 10+');
    if (a.cost > p.coins) throw new Error('cannot afford');
    const tgt = a.targeted ? this.other(playerId) : null;
    let named = null;
    if (a.call) {
      named = String(call || '').toLowerCase();
      if (!ROLES.includes(named)) throw new Error(`${type} must name a character`);
    }
    this.ctx = { type, actor: playerId, target: tgt ? tgt.id : null, call: named, blocked: false };
    this._log({ t: 'action', action: type, player: playerId, target: this.ctx.target, call: named });
    p.coins -= a.cost;

    if (type === 'income') { p.coins += 1; return this._endTurn(); }
    if (type === 'coup') return this._resolveCall();
    if (a.role) {
      this.pending = {
        type: 'challenge', claim: { player: playerId, role: a.role },
        who: [this.other(playerId).id], blocking: false,
      };
      return;
    }
    this._openBlockWindow(); // foreign aid
  }

  /** pending 'challenge' → the challenger id, or null for "let it stand" */
  resolveChallenge(challengerId) {
    this._expect('challenge');
    const { claim } = this.pending;
    const blocking = this.pending.blocking;
    const claimant = this.player(claim.player);
    if (challengerId == null) {
      this._log({ t: 'nochallenge', player: claim.player, role: claim.role });
      return blocking ? this._blockStands() : this._afterActionClaim();
    }
    if (!this.pending.who.includes(challengerId)) throw new Error('not eligible to challenge');
    const truthful = this.hasRole(claimant, claim.role);
    this._log({ t: 'challenge', by: challengerId, against: claim.player, role: claim.role, truthful });
    if (truthful) {
      this._replaceCard(claimant, claim.role);
      this._queueLose(challengerId, 'lost challenge');
      this.ctx.afterLoses = blocking ? 'blockStands' : 'afterActionClaim';
    } else {
      this._queueLose(claim.player, 'caught bluffing');
      if (blocking) {
        this.ctx.afterLoses = 'applyAction';
      } else {
        if (this.ctx.type === 'assassinate') this.player(this.ctx.actor).coins += 3; // refund
        this.ctx.afterLoses = 'endTurn';
      }
    }
    this._drainLoses();
  }

  _afterActionClaim() {
    if (!this.isAlive(this.player(this.ctx.actor))) return this._endTurn();
    this._openBlockWindow();
  }

  _openBlockWindow() {
    const a = ACTIONS[this.ctx.type];
    if (!a.blockedBy) return this._applyAction();
    const opp = this.other(this.ctx.actor);
    if (!this.isAlive(opp)) return this._applyAction();
    this.pending = { type: 'block', who: [opp.id], roles: a.blockedBy, action: this.ctx.type, call: this.ctx.call };
  }

  /** pending 'block' → blocker + claimed role, or null to let it through */
  resolveBlock(blockerId, role) {
    this._expect('block');
    if (blockerId == null) return this._applyAction();
    if (!this.pending.who.includes(blockerId)) throw new Error('not eligible to block');
    if (!this.pending.roles.includes(role)) throw new Error('that role cannot block this');
    this.ctx.blocker = blockerId;
    this._log({ t: 'block', player: blockerId, role, action: this.ctx.type });
    this.pending = {
      type: 'challenge', claim: { player: blockerId, role },
      who: [this.other(blockerId).id], blocking: true,
    };
  }

  _blockStands() {
    this.ctx.blocked = true;
    this._log({ t: 'blocked', action: this.ctx.type, by: this.ctx.blocker });
    this._endTurn();
  }

  // ------------------------------------------------------------ effects
  _applyAction() {
    const { type, actor, target } = this.ctx;
    const p = this.player(actor);
    if (!this.isAlive(p)) return this._endTurn();
    if (type === 'foreign_aid') { p.coins += 2; return this._endTurn(); }
    if (type === 'tax') { p.coins += 3; return this._endTurn(); }
    if (type === 'steal') {
      const t = this.player(target);
      const take = Math.min(2, t.coins);
      t.coins -= take; p.coins += take;
      this._log({ t: 'stole', actor, target, amount: take });
      return this._endTurn();
    }
    if (type === 'assassinate') {
      if (this.isAlive(this.player(target))) return this._resolveCall();
      return this._endTurn();
    }
    if (type === 'exchange') {
      const drawn = [this.deck.pop(), this.deck.pop()].filter(Boolean);
      this.pending = {
        type: 'exchange', player: actor, reason: 'ambassador',
        pool: p.cards.concat(drawn), keep: p.cards.length,
      };
      return;
    }
    this._endTurn();
  }

  /** Call-the-coup / assassinate: hit the named card, or miss → reveal+redraw */
  _resolveCall() {
    const { type, actor, target, call } = this.ctx;
    const tgt = this.player(target);
    if (!this.isAlive(tgt)) return this._endTurn();
    if (this.hasRole(tgt, call)) {
      this._log({ t: 'hit', action: type, actor, target, call });
      this._queueLose(target, type === 'coup' ? 'couped' : 'assassinated', call);
      return this._drainLoses();
    }
    // MISS: the defender proves it by revealing — then the whole hand goes
    // back into the deck (shuffled) and a fresh one is dealt at random, so
    // the reveal teaches the attacker nothing lasting
    this._log({ t: 'miss', action: type, actor, target, call, revealed: [...tgt.cards] });
    const n = tgt.cards.length;
    this.deck.push(...tgt.cards.splice(0, tgt.cards.length));
    this._shuffle(this.deck);
    for (let i = 0; i < n && this.deck.length; i++) tgt.cards.push(this.deck.pop());
    this._log({ t: 'redraw', player: target });
    this._endTurn();
  }

  /** pending 'exchange' → keep indices into pending.pool */
  resolveExchange(playerId, keepIdxs) {
    this._expect('exchange', playerId);
    const { pool, keep, reason } = this.pending;
    if (!Array.isArray(keepIdxs) || keepIdxs.length !== keep
      || new Set(keepIdxs).size !== keep
      || keepIdxs.some((i) => !(i >= 0 && i < pool.length))) throw new Error('bad exchange');
    const p = this.player(playerId);
    p.cards = keepIdxs.map((i) => pool[i]);
    const returned = pool.filter((_, i) => !keepIdxs.includes(i));
    this.deck.push(...returned);
    this._shuffle(this.deck);
    this._log({ t: 'exchanged', player: playerId, reason });
    this._endTurn();
  }

  // ------------------------------------------------------------ influence loss
  _queueLose(playerId, why, forcedRole = null) {
    if (this.isAlive(this.player(playerId))) this.loseQueue.push({ playerId, why, forcedRole });
  }

  _drainLoses() {
    const next = this.loseQueue.shift();
    if (!next) return this._continueAfterLoses();
    const p = this.player(next.playerId);
    if (next.forcedRole && p.cards.includes(next.forcedRole)) {
      return this._loseCard(p, p.cards.indexOf(next.forcedRole), next.why);
    }
    if (p.cards.length === 1) return this._loseCard(p, 0, next.why);
    if (p.cards.length === 0) return this._drainLoses();
    this.pending = { type: 'lose', player: p.id, why: next.why };
  }

  /** pending 'lose' → which card index (into .cards) to give up */
  resolveLose(playerId, cardIdx) {
    this._expect('lose', playerId);
    const p = this.player(playerId);
    if (!(cardIdx >= 0 && cardIdx < p.cards.length)) throw new Error('bad card');
    this._loseCard(p, cardIdx, this.pending.why);
  }

  _loseCard(p, idx, why) {
    const role = p.cards.splice(idx, 1)[0];
    p.graveyard.push(role);
    const deaths = p.graveyard.length;
    // deaths 1..3 are replaced from the deck; 4 and 5 are not
    if (deaths <= REPLACE_UNTIL && this.deck.length) p.cards.push(this.deck.pop());
    this._log({ t: 'lost', player: p.id, role, why, lives: LIVES - deaths, out: deaths >= LIVES });
    this._drainLoses();
  }

  _continueAfterLoses() {
    if (this._maybeFinish()) return;
    const cont = this.ctx && this.ctx.afterLoses;
    if (this.ctx) this.ctx.afterLoses = null;
    if (cont === 'afterActionClaim') return this._afterActionClaim();
    if (cont === 'blockStands') return this._blockStands();
    if (cont === 'applyAction') return this._applyAction();
    this._endTurn();
  }

  _endTurn() {
    if (this._maybeFinish()) return;
    this._beginTurn();
  }

  _expect(type, playerId) {
    if (!this.pending || this.pending.type !== type) throw new Error(`no pending ${type}`);
    if (playerId != null && this.pending.player !== playerId) throw new Error('not your decision');
  }

  /** end a marathon by standing: most lives, then most coins */
  adjudicate() {
    if (this.winner) return;
    const [a, b] = this.players;
    const la = this.livesLeft(a), lb = this.livesLeft(b);
    const w = la !== lb ? (la > lb ? a : b) : (a.coins >= b.coins ? a : b);
    this.winner = w.id;
    this.pending = null;
    this._log({ t: 'win', player: w.id, adjudicated: true });
  }

  // ------------------------------------------------------------ views
  view(viewerId) {
    return {
      players: this.players.map((p) => ({
        id: p.id,
        coins: p.coins,
        alive: this.isAlive(p),
        lives: this.livesLeft(p),
        graveyard: [...p.graveyard],
        cards: p.cards.map((role) => ({
          revealed: false,
          role: (viewerId === 'god' || viewerId === p.id) ? role : null,
        })),
      })),
      turn: this.current() ? this.current().id : null,
      winner: this.winner,
      deckCount: this.deck.length,
      pending: this.pending ? {
        type: this.pending.type,
        player: this.pending.player,
        who: this.pending.who,
        claim: this.pending.claim,
        roles: this.pending.roles,
        action: this.pending.action,
        call: this.pending.call,
        reason: this.pending.reason,
        mustCoup: this.pending.mustCoup,
        why: this.pending.why,
        keep: this.pending.keep,
        pool: (this.pending.type === 'exchange' && (viewerId === this.pending.player || viewerId === 'god'))
          ? this.pending.pool : undefined,
      } : null,
      ctx: this.ctx ? { type: this.ctx.type, actor: this.ctx.actor, target: this.ctx.target, call: this.ctx.call } : null,
    };
  }
}

module.exports = { CoupGame, ROLES, ACTIONS, LIVES };
