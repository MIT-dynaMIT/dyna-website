/**
 * Coup engine — pure rules, no timers, no network.
 *
 * The table driver (tables.js) owns pacing: the engine stops at a `pending`
 * decision and exposes who must answer; the driver collects answers from
 * humans (with countdowns) or bots (instantly) and calls the matching
 * resolve method. Deterministic when given a seeded rng, which is how the
 * tests hammer it.
 *
 * Rules implemented: standard Coup (FFG/Indie Boards & Cards).
 *  - Income +1 · Foreign Aid +2 (blockable: Duke) · Coup 7 (unstoppable)
 *  - Tax +3 (Duke) · Assassinate 3 (Assassin, blockable: Contessa)
 *  - Steal 2 (Captain, blockable: Captain/Ambassador) · Exchange (Ambassador)
 *  - Any role claim can be challenged, including block claims.
 *  - Truthful claimant shuffles the shown card back and draws a replacement.
 *  - Assassination cost is refunded only if the assassin is caught lying
 *    (successful challenge voids the action); a blocked assassination stays paid.
 *  - 10+ coins → must Coup.
 */
'use strict';

const ROLES = ['duke', 'assassin', 'captain', 'ambassador', 'contessa'];

const ACTIONS = {
  income: { label: 'Income', cost: 0 },
  foreign_aid: { label: 'Foreign Aid', cost: 0, blockedBy: ['duke'] },
  coup: { label: 'Coup', cost: 7, targeted: true },
  tax: { label: 'Tax', cost: 0, role: 'duke' },
  assassinate: { label: 'Assassinate', cost: 3, role: 'assassin', targeted: true, blockedBy: ['contessa'] },
  steal: { label: 'Steal', cost: 0, role: 'captain', targeted: true, blockedBy: ['captain', 'ambassador'] },
  exchange: { label: 'Exchange', cost: 0, role: 'ambassador' },
};

function defaultRng() { return Math.random(); }

class CoupGame {
  constructor(playerIds, rng = defaultRng) {
    if (playerIds.length < 2 || playerIds.length > 6) throw new Error('2-6 players');
    this.rng = rng;
    this.deck = [];
    for (const r of ROLES) this.deck.push(r, r, r);
    this._shuffle(this.deck);
    this.players = playerIds.map((id) => ({
      id,
      coins: 2,
      cards: [
        { role: this.deck.pop(), revealed: false },
        { role: this.deck.pop(), revealed: false },
      ],
    }));
    this.turnIdx = 0;
    this.winner = null;
    this.log = [];
    this.ctx = null;        // the action being resolved this turn
    this.loseQueue = [];    // [{playerId, why}] influence losses awaiting a card choice
    this.pending = null;    // {type, ...} what the driver must collect next
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
  isAlive(p) { return p.cards.some((c) => !c.revealed); }
  alivePlayers() { return this.players.filter((p) => this.isAlive(p)); }
  current() { return this.players[this.turnIdx]; }
  hasRole(p, role) { return p.cards.some((c) => !c.revealed && c.role === role); }

  _log(entry) { this.log.push(Object.assign({ n: this.log.length }, entry)); }

  /** others, clockwise from `fromId`, alive only */
  clockwiseFrom(fromId) {
    const i = this.players.findIndex((p) => p.id === fromId);
    const out = [];
    for (let k = 1; k < this.players.length; k++) {
      const p = this.players[(i + k) % this.players.length];
      if (this.isAlive(p)) out.push(p.id);
    }
    return out;
  }

  /** the shown truthful card goes back in the deck; draw a fresh one */
  _replaceCard(p, role) {
    const card = p.cards.find((c) => !c.revealed && c.role === role);
    card.role = null;
    this.deck.push(role);
    this._shuffle(this.deck);
    card.role = this.deck.pop();
  }

  // ------------------------------------------------------------ turn flow
  _beginTurn(first = false) {
    if (this._maybeFinish()) return;
    if (!first) {
      do { this.turnIdx = (this.turnIdx + 1) % this.players.length; }
      while (!this.isAlive(this.players[this.turnIdx]));
    } else if (!this.isAlive(this.players[this.turnIdx])) {
      return this._beginTurn(false);
    }
    const p = this.current();
    this.ctx = null;
    this.pending = { type: 'action', player: p.id, mustCoup: p.coins >= 10 };
  }

  _maybeFinish() {
    const alive = this.alivePlayers();
    if (alive.length === 1) {
      this.winner = alive[0].id;
      this.pending = null;
      this._log({ t: 'win', player: this.winner });
      return true;
    }
    return false;
  }

  legalActions(playerId) {
    const p = this.player(playerId);
    if (!p || !this.pending || this.pending.type !== 'action' || this.pending.player !== playerId) return [];
    const targets = this.alivePlayers().filter((q) => q.id !== playerId).map((q) => q.id);
    if (p.coins >= 10) return [{ type: 'coup', targets }];
    const out = [];
    for (const [type, a] of Object.entries(ACTIONS)) {
      if (a.cost > p.coins) continue;
      out.push(a.targeted ? { type, targets } : { type });
    }
    return out;
  }

  // ------------------------------------------------------------ submissions
  /** pending 'action' → the current player picks an action */
  submitAction(playerId, { type, target }) {
    this._expect('action', playerId);
    const a = ACTIONS[type];
    const p = this.player(playerId);
    if (!a) throw new Error('unknown action');
    if (p.coins >= 10 && type !== 'coup') throw new Error('must coup at 10+');
    if (a.cost > p.coins) throw new Error('cannot afford');
    let tgt = null;
    if (a.targeted) {
      tgt = this.player(target);
      if (!tgt || tgt.id === playerId || !this.isAlive(tgt)) throw new Error('bad target');
    }
    this.ctx = { type, actor: playerId, target: tgt ? tgt.id : null, blocked: false };
    this._log({ t: 'action', action: type, player: playerId, target: this.ctx.target });
    p.coins -= a.cost; // coup & assassinate pay up front

    if (type === 'income') { p.coins += 1; return this._endTurn(); }
    if (type === 'coup') {
      this._queueLose(tgt.id, 'coup');
      return this._drainLoses();
    }
    if (a.role) {
      this.pending = {
        type: 'challenge', claim: { player: playerId, role: a.role },
        who: this.clockwiseFrom(playerId), blocking: false,
      };
      return;
    }
    // foreign aid: no role claim, straight to the block window
    this._openBlockWindow();
  }

  /** pending 'challenge' → driver reports the earliest challenger, or null */
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
        this.ctx.afterLoses = 'applyAction';         // failed block: action goes through
      } else {
        if (this.ctx.type === 'assassinate') this.player(this.ctx.actor).coins += 3; // refund
        this.ctx.afterLoses = 'endTurn';             // action voided
      }
    }
    this._drainLoses();
  }

  _afterActionClaim() {
    // actor's claim stood (unchallenged or vindicated) → block window or apply
    if (!this.isAlive(this.player(this.ctx.actor))) return this._endTurn();
    this._openBlockWindow();
  }

  _openBlockWindow() {
    const a = ACTIONS[this.ctx.type];
    if (!a.blockedBy) return this._applyAction();
    // foreign aid: anyone may block; targeted actions: only the target
    const eligible = this.ctx.type === 'foreign_aid'
      ? this.clockwiseFrom(this.ctx.actor)
      : (this.ctx.target && this.isAlive(this.player(this.ctx.target)) ? [this.ctx.target] : []);
    if (!eligible.length) return this._applyAction();
    this.pending = { type: 'block', who: eligible, roles: a.blockedBy, action: this.ctx.type };
  }

  /** pending 'block' → driver reports the earliest blocker + claimed role, or null */
  resolveBlock(blockerId, role) {
    this._expect('block');
    if (blockerId == null) return this._applyAction();
    if (!this.pending.who.includes(blockerId)) throw new Error('not eligible to block');
    if (!this.pending.roles.includes(role)) throw new Error('that role cannot block this');
    this.ctx.blocker = blockerId;
    this._log({ t: 'block', player: blockerId, role, action: this.ctx.type });
    this.pending = {
      type: 'challenge', claim: { player: blockerId, role },
      who: this.clockwiseFrom(blockerId), blocking: true,
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
    if (type === 'foreign_aid') p.coins += 2;
    if (type === 'tax') p.coins += 3;
    if (type === 'steal') {
      const t = this.player(target);
      const take = Math.min(2, t.coins);
      t.coins -= take; p.coins += take;
      this._log({ t: 'stole', actor, target, amount: take });
    }
    if (type === 'assassinate') {
      const t = this.player(target);
      if (this.isAlive(t)) { this._queueLose(target, 'assassinated'); return this._drainLoses(); }
    }
    if (type === 'exchange') {
      const drawn = [this.deck.pop(), this.deck.pop()];
      this.ctx.exchange = drawn;
      const keepCount = p.cards.filter((c) => !c.revealed).length;
      this.pending = {
        type: 'exchange', player: actor,
        pool: p.cards.filter((c) => !c.revealed).map((c) => c.role).concat(drawn),
        keep: keepCount,
      };
      return;
    }
    this._endTurn();
  }

  /** pending 'exchange' → keep indices into pending.pool */
  resolveExchange(playerId, keepIdxs) {
    this._expect('exchange', playerId);
    const { pool, keep } = this.pending;
    if (!Array.isArray(keepIdxs) || keepIdxs.length !== keep
      || new Set(keepIdxs).size !== keep
      || keepIdxs.some((i) => !(i >= 0 && i < pool.length))) throw new Error('bad exchange');
    const p = this.player(playerId);
    const kept = keepIdxs.map((i) => pool[i]);
    const returned = pool.filter((_, i) => !keepIdxs.includes(i));
    let k = 0;
    for (const c of p.cards) if (!c.revealed) c.role = kept[k++];
    this.deck.push(...returned);
    this._shuffle(this.deck);
    this._log({ t: 'exchanged', player: playerId });
    this._endTurn();
  }

  // ------------------------------------------------------------ influence loss
  _queueLose(playerId, why) {
    if (this.isAlive(this.player(playerId))) this.loseQueue.push({ playerId, why });
  }

  _drainLoses() {
    const next = this.loseQueue.shift();
    if (!next) return this._continueAfterLoses();
    const p = this.player(next.playerId);
    const unrevealed = p.cards.filter((c) => !c.revealed);
    if (unrevealed.length === 1) {
      // no choice to make — flip it
      unrevealed[0].revealed = true;
      this._log({ t: 'lost', player: p.id, role: unrevealed[0].role, why: next.why, out: !this.isAlive(p) });
      return this._drainLoses();
    }
    this.pending = { type: 'lose', player: p.id, why: next.why };
  }

  /** pending 'lose' → which card index (into .cards) to flip */
  resolveLose(playerId, cardIdx) {
    this._expect('lose', playerId);
    const p = this.player(playerId);
    const card = p.cards[cardIdx];
    if (!card || card.revealed) throw new Error('bad card');
    card.revealed = true;
    this._log({ t: 'lost', player: p.id, role: card.role, why: this.pending.why, out: !this.isAlive(p) });
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

  /** end a marathon round by standing: most cards, then most coins */
  adjudicate() {
    if (this.winner) return;
    const best = [...this.alivePlayers()].sort((a, b) =>
      (b.cards.filter((c) => !c.revealed).length - a.cards.filter((c) => !c.revealed).length)
      || (b.coins - a.coins))[0];
    this.winner = best.id;
    this.pending = null;
    this._log({ t: 'win', player: best.id, adjudicated: true });
  }

  // ------------------------------------------------------------ views
  /** what `viewerId` may see; viewerId null = public, 'god' = everything */
  view(viewerId) {
    return {
      players: this.players.map((p) => ({
        id: p.id,
        coins: p.coins,
        alive: this.isAlive(p),
        cards: p.cards.map((c) => ({
          revealed: c.revealed,
          role: (c.revealed || viewerId === 'god' || viewerId === p.id) ? c.role : null,
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
        mustCoup: this.pending.mustCoup,
        why: this.pending.why,
        keep: this.pending.keep,
        pool: (this.pending.type === 'exchange' && (viewerId === this.pending.player || viewerId === 'god'))
          ? this.pending.pool : undefined,
      } : null,
      ctx: this.ctx ? { type: this.ctx.type, actor: this.ctx.actor, target: this.ctx.target } : null,
    };
  }
}

module.exports = { CoupGame, ROLES, ACTIONS };
