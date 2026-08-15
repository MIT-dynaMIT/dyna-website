/**
 * Heads-up Coup engine — the two-player "Ultimate" variant, dynaMIT edition
 * (based on https://shelfgamer.com/coup-two-player-ultimate-variant/).
 *
 * dynaMIT rules (validated by simulation, see git history):
 *  - Exactly 2 players. NO CAPTAIN: four roles (Duke, Assassin, Ambassador,
 *    Contessa) x 3 copies = a 12-card court deck. No steal action.
 *  - FOUR LIVES each: a dead character goes face-up to the player's
 *    graveyard and is ALWAYS replaced from the deck — you play with a full
 *    2-card hand until the end. The game ends when someone's 4th character
 *    dies (no 1-card endgame).
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

const ROLES = ['duke', 'assassin', 'ambassador', 'contessa'];
const LIVES = 4;
const REPLACE_UNTIL = 3; // every death but the last is replaced — hand stays at 2

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
  /** opts (experimental variants): roles?: string[], lives?: number, replaceUntil?: number */
  constructor(playerIds, rng = defaultRng, opts = {}) {
    if (playerIds.length !== 2) throw new Error('heads-up: exactly 2 players');
    this.rng = rng;
    this.roles = opts.roles || ROLES;
    this.lives = opts.lives || LIVES;
    this.replaceUntil = opts.replaceUntil ?? Math.max(1, this.lives - 1);
    this.deck = [];
    for (const r of this.roles) this.deck.push(r, r, r);
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
    // challenge penalties wait until the ACTION has fully resolved:
    // action first, then penalty discards, then everyone refills to 2
    this.penaltyQueue = [];   // [{playerId, why}]
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
  isAlive(p) { return p.graveyard.length < this.lives && p.cards.length > 0; }
  alivePlayers() { return this.players.filter((p) => this.isAlive(p)); }
  current() { return this.players[this.turnIdx]; }
  hasRole(p, role) { return p.cards.includes(role); }
  livesLeft(p) { return this.lives - p.graveyard.length; }

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
      if (a.role && !this.roles.includes(a.role)) continue; // variant: role removed
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
    if (a.role && !this.roles.includes(a.role)) throw new Error('that role is not in this game');
    if (a.call) {
      named = String(call || '').toLowerCase();
      if (!this.roles.includes(named)) throw new Error(`${type} must name a character`);
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
      // wrong challenge: the action continues FIRST; the challenger's
      // penalty discard waits for the end of the sequence
      this._replaceCard(claimant, claim.role);
      this.penaltyQueue.push({ playerId: challengerId, why: 'lost challenge' });
      return blocking ? this._blockStands() : this._afterActionClaim();
    }
    // caught bluffing
    this.penaltyQueue.push({ playerId: claim.player, why: 'caught bluffing' });
    if (blocking) {
      // the block fails: the original action goes through FIRST (a called
      // card dies), then the blocker pays the challenge penalty
      return this._applyAction();
    }
    // a bluffed action claim never happens at all
    if (this.ctx.type === 'assassinate') this.player(this.ctx.actor).coins += 3; // refund
    this._endTurn();
  }

  _afterActionClaim() {
    if (!this.isAlive(this.player(this.ctx.actor))) return this._endTurn();
    this._openBlockWindow();
  }

  _openBlockWindow() {
    const a = ACTIONS[this.ctx.type];
    const blockedBy = (a.blockedBy || []).filter((r) => this.roles.includes(r));
    if (!blockedBy.length) return this._applyAction();
    const opp = this.other(this.ctx.actor);
    if (!this.isAlive(opp)) return this._applyAction();
    this.pending = { type: 'block', who: [opp.id], roles: blockedBy, action: this.ctx.type, call: this.ctx.call };
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
      this._loseCard(tgt, tgt.cards.indexOf(call), type === 'coup' ? 'couped' : 'assassinated');
      return this._endTurn();
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
  /** a card dies NOW; replacements wait for the end of the sequence */
  _loseCard(p, idx, why) {
    const role = p.cards.splice(idx, 1)[0];
    p.graveyard.push(role);
    const deaths = p.graveyard.length;
    this._log({ t: 'lost', player: p.id, role, why, lives: this.lives - deaths, out: deaths >= this.lives });
  }

  /** pending 'lose' → which card index (into .cards) to give up */
  resolveLose(playerId, cardIdx) {
    this._expect('lose', playerId);
    const p = this.player(playerId);
    if (!(cardIdx >= 0 && cardIdx < p.cards.length)) throw new Error('bad card');
    this._loseCard(p, cardIdx, this.pending.why);
    this.pending = null;
    this._endTurn();
  }

  /** deferred challenge penalties: discard AFTER the action resolved */
  _drainPenalties() {
    while (this.penaltyQueue.length) {
      const next = this.penaltyQueue.shift();
      const p = this.player(next.playerId);
      if (p.graveyard.length >= this.lives || p.cards.length === 0) continue;
      if (p.cards.length === 1) { this._loseCard(p, 0, next.why); continue; }
      this.pending = { type: 'lose', player: p.id, why: next.why };
      return false;    // waiting on a discard choice
    }
    return true;
  }

  /** everyone draws back up to two cards — the last step of every sequence */
  _refillHands() {
    for (const p of this.players) {
      while (p.graveyard.length < this.lives && p.cards.length < 2 && this.deck.length) {
        p.cards.push(this.deck.pop());
      }
    }
  }

  _endTurn() {
    if (!this._drainPenalties()) return;   // a discard choice is pending
    this._refillHands();
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
