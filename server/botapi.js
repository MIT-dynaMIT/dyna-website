/**
 * botapi — the bridge between the heads-up Coup engine and student bots.
 *
 * Student functions (all optional, safe fallbacks everywhere):
 *   your_turn(state)                 → income() | tax() | exchange()
 *                                      | foreign_aid() | coup(role)
 *                                      | assassinate(role, p)
 *                                      (coup/assassinate NAME a character —
 *                                       "call the coup"; p = probability of
 *                                       challenging a Contessa block)
 *   respond(state, action)           → allow() | challenge() | block(role)
 *   when_assassinated(state, action) → block_contessa() | allow()
 *   choose_card_to_lose(state)       → reveal(role)
 *   choose_exchange(state, pool)     → list of role names to keep
 *   new_game(state)                  → nothing; called ONCE at the start of
 *                                      every game, before any decision, so a
 *                                      bot can clear whatever it counts per
 *                                      game. Top-level variables live for the
 *                                      whole matchup, and resetting them by
 *                                      hand is a trap: whoever moves first
 *                                      decides whether your_turn or respond
 *                                      runs first.
 *
 * The math toolkit (also exposed as blocks):
 *   prob_opponent_has(state, role)   hypergeometric P(opponent holds ≥1 role)
 *   unseen_copies(state, role)       3 - graveyards - my copies
 *   best_coup_call(state)            claim- and reveal-weighted best call
 */
'use strict';

const { compile, CompileError, BotRuntimeError, repr } = require('./botlang');
const { ACTIONS, ROLES, LIVES } = require('./coup');

const ROLE_VALUE = { duke: 5, contessa: 4, captain: 3, assassin: 2, ambassador: 1 };

// ------------------------------------------------------------ log tallies
function tallyLog(log, ids) {
  const T = {};
  for (const id of ids) {
    T[id] = {
      claims: [], claimCounts: {}, challengesMade: 0, challengesWon: 0, caughtBluffing: 0, actions: 0,
    };
  }
  let actionNo = 0;
  for (const e of log) {
    if (e.t === 'action') {
      actionNo++;
      const a = ACTIONS[e.action];
      if (T[e.player]) {
        T[e.player].actions++;
        if (a && a.role) {
          if (!T[e.player].claims.includes(a.role)) T[e.player].claims.push(a.role);
          T[e.player].claimCounts[a.role] = (T[e.player].claimCounts[a.role] || 0) + 1;
        }
      }
    } else if (e.t === 'block') {
      if (T[e.player]) {
        if (!T[e.player].claims.includes(e.role)) T[e.player].claims.push(e.role);
        T[e.player].claimCounts[e.role] = (T[e.player].claimCounts[e.role] || 0) + 1;
      }
    } else if (e.t === 'challenge') {
      if (T[e.by]) {
        T[e.by].challengesMade++;
        if (!e.truthful) T[e.by].challengesWon++;
      }
      if (T[e.against]) {
        if (e.truthful) {
          // proved it and redrew — that role's story resets
          T[e.against].claims = T[e.against].claims.filter((r) => r !== e.role);
          T[e.against].claimCounts[e.role] = 0;
        } else {
          T[e.against].caughtBluffing++;
        }
      }
    } else if (e.t === 'exchanged' || e.t === 'redraw') {
      // exchange or post-miss redraw: their hand may be anything now
      if (T[e.player]) { T[e.player].claims = []; T[e.player].claimCounts = {}; }
    }
  }
  T.__actionNo = actionNo;
  return T;
}

function friendlyHistory(log, nameOf) {
  const out = [];
  for (const e of log) {
    if (e.t === 'action') out.push({ event: 'action', action: e.action, player: nameOf(e.player), target: e.target ? nameOf(e.target) : null, call: e.call || null });
    else if (e.t === 'block') out.push({ event: 'block', player: nameOf(e.player), role: e.role, action: e.action });
    else if (e.t === 'blocked') out.push({ event: 'blocked', action: e.action, player: nameOf(e.by) });
    else if (e.t === 'challenge') out.push({ event: 'challenge', player: nameOf(e.by), against: nameOf(e.against), role: e.role, won: !e.truthful });
    else if (e.t === 'hit') out.push({ event: 'hit', action: e.action, player: nameOf(e.actor), target: nameOf(e.target), call: e.call });
    else if (e.t === 'miss') out.push({ event: 'miss', action: e.action, player: nameOf(e.actor), target: nameOf(e.target), call: e.call, revealed: e.revealed });
    else if (e.t === 'lost') out.push({ event: 'lost_card', player: nameOf(e.player), role: e.role, why: e.why, lives: e.lives });
    else if (e.t === 'stole') out.push({ event: 'stole', player: nameOf(e.actor), target: nameOf(e.target), amount: e.amount });
    else if (e.t === 'exchanged') out.push({ event: 'exchanged', player: nameOf(e.player), reason: e.reason });
    else if (e.t === 'redraw') out.push({ event: 'redraw', player: nameOf(e.player) });
  }
  return out;
}

// ------------------------------------------------------------ math helpers
/** C(n, k) for small n */
function choose(n, k) {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return r;
}

/**
 * P(opponent holds ≥1 copy of `role`) from public info only:
 * unseen pool = 15 - my hand - both graveyards; opponent's hand is a uniform
 * k-subset of it (baseline — claims shift this, which is the bots' job).
 */
function probOpponentHas(state, role) {
  const r = String(role || '').toLowerCase();
  if (!ROLES.includes(r)) throw new BotRuntimeError(`prob_opponent_has needs a role name, got ${repr(role)}`);
  const opp = state.opponent;
  if (!opp) return 0;
  const gameRoles = state.__roles || ROLES;
  if (!gameRoles.includes(r)) return 0;
  const k = opp.num_cards;
  const total = 3 * gameRoles.length;
  const unseen = total - state.my_cards.length - state.my_graveyard.length - opp.graveyard.length;
  const avail = 3 - (state.revealed_roles[r] || 0) - state.my_cards.filter((c) => c === r).length;
  if (avail <= 0 || k <= 0 || unseen <= 0) return 0;
  return 1 - choose(unseen - avail, k) / choose(unseen, k);
}

/**
 * SILENCE IS EVIDENCE — but only about the Duke.
 *
 * Tax is free and always worth taking, so a player holding a Duke almost
 * always claims one. Measured over 28 pairings of the house and archive bots:
 * an opponent who has never taxed holds a Duke 7.5% of the time, against the
 * 53% the hypergeometric alone would tell you. Naming the Duke against a
 * silent opponent is therefore close to a guaranteed miss.
 *
 * Doing this for EVERY role measured worse (67.1% -> 64.0%): the picks simply
 * funnel into Contessa, the one role with no action of its own to stay silent
 * about. Duke alone is worth +3.2 points of hit rate on held-out bots, and
 * drops the silent-Duke call from 15.4% of such turns to 3.5%.
 */
const DUKE_SILENCE_DECAY = 0.35;
const DUKE_SILENCE_FLOOR = 0.08;

/**
 * Claim- and reveal-weighted best role to name in a coup/assassination.
 *
 * `jitter` (0..1) adds that much noise to each score before the argmax, which
 * only ever changes a NEAR-TIE. Without it the function is deterministic, so an
 * opponent that models it can simply stop holding whatever it is about to name.
 * Off by default: the plain call stays predictable, which is the gap a camper
 * closes themselves.
 */
function bestCoupCall(state, jitter = 0, rng = null) {
  const opp = state.opponent;
  const shots = opp ? (opp.actions || 0) : 0;
  const noise = jitter > 0 ? (rng || Math.random) : null;
  let best = 'duke', bestScore = -1;
  for (const r of (state.__roles || ROLES)) {
    let score = probOpponentHas(state, r);
    if (opp) {
      if (opp.claims.includes(r)) score *= 1.7;                       // they said so
      else if (r === 'duke' && shots >= 2) {
        // turns taken without ever taxing: each one is evidence against
        score *= Math.max(DUKE_SILENCE_FLOOR, 1 - DUKE_SILENCE_DECAY * (shots - 1));
      }
      score *= 1 + 0.05 * ROLE_VALUE[r];  // players tend to keep the strong cards
    }
    if (noise) score += noise() * jitter;
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return best;
}

// ------------------------------------------------------------ state building
/**
 * seriesCtx (100-game matchup memory), earned during the current series:
 *   { game, total, winsByName: {name: n}, statsByName: {name: {
 *       challenges, claims, caught, proofs, contessaBlocks }} }
 * Nothing carries over from the ladder — game 1 knows nothing.
 */
function buildState(game, selfId, names, seriesCtx = null) {
  const nameOf = (id) => names[id] || String(id);
  const tally = tallyLog(game.log, game.players.map((p) => p.id));
  const byName = {};
  const played = seriesCtx ? Math.max(0, (seriesCtx.game || 1) - 1) : 0;

  const players = game.players.map((p) => {
    const t = tally[p.id];
    const sName = nameOf(p.id);
    const ss = (seriesCtx && seriesCtx.statsByName && seriesCtx.statsByName[sName]) || {};
    const sw = (seriesCtx && seriesCtx.winsByName && seriesCtx.winsByName[sName]) || 0;
    const obj = {
      name: nameOf(p.id),
      is_me: p.id === selfId,
      alive: game.isAlive(p),
      coins: p.coins,
      lives: game.livesLeft(p),
      num_cards: p.cards.length,
      graveyard: [...p.graveyard],
      cards_lost: [...p.graveyard],          // alias kept for the blocks
      claims: t ? [...t.claims] : [],
      claim_counts: {
        duke: (t && t.claimCounts.duke) || 0,
        assassin: (t && t.claimCounts.assassin) || 0,
        ambassador: (t && t.claimCounts.ambassador) || 0,
        contessa: (t && t.claimCounts.contessa) || 0,
      },
      challenges_made: t ? t.challengesMade : 0,
      successful_challenges: t ? t.challengesWon : 0,
      times_caught_bluffing: t ? t.caughtBluffing : 0,
      // turns they have actually taken this game — the denominator for "they
      // have had N chances to claim a Duke and never have"
      actions: t ? t.actions : 0,
      // series memory — what THIS 100-game matchup has revealed so far.
      // All zeros in game 1: information must be earned.
      series_win_rate: played > 0 ? sw / played : 0.5,
      series_wins: sw,
      series_challenges_per_game: played > 0 ? (ss.challenges || 0) / played : 0,
      series_claims_per_game: played > 0 ? (ss.claims || 0) / played : 0,
      series_caught_bluffing: ss.caught || 0,           // raw totals (stop-rules)
      series_honest_proofs: ss.proofs || 0,
      // per-game RATES — bounded, comparable at any point in the series;
      // use these in suspicion math (totals grow forever and diverge)
      series_caught_per_game: played > 0 ? (ss.caught || 0) / played : 0,
      series_proofs_per_game: played > 0 ? (ss.proofs || 0) / played : 0,
      series_contessa_rate: played > 0 ? (ss.contessaBlocks || 0) / played : 0,
      __id: p.id,
    };
    byName[obj.name] = obj;
    return obj;
  });

  const me = players.find((p) => p.is_me);
  const opp = players.find((p) => !p.is_me);
  const self = game.player(selfId);

  const state = {
    my_name: me.name,
    my_coins: self.coins,
    my_cards: [...self.cards],
    my_num_cards: self.cards.length,
    my_lives: game.livesLeft(self),
    my_graveyard: [...self.graveyard],
    my_claims: me.claims,
    opponent: opp,
    players,
    opponents: opp && opp.alive ? [opp] : [],
    num_alive: players.filter((p) => p.alive).length,
    deck_count: game.deck.length,
    turn_number: game.log.filter((e) => e.t === 'action').length,
    richest_player: opp, strongest_player: opp, weakest_player: opp, // heads-up: it's always them
    history: friendlyHistory(game.log, nameOf),
    me,   // my own player object (series_* self-stats live here too)
    // the series scoreboard: which game of the matchup this is, and the score
    series: {
      game: seriesCtx ? (seriesCtx.game || 1) : 1,
      games_total: seriesCtx ? (seriesCtx.total || 100) : 100,
      my_wins: (seriesCtx && seriesCtx.winsByName && seriesCtx.winsByName[me.name]) || 0,
      their_wins: (opp && seriesCtx && seriesCtx.winsByName && seriesCtx.winsByName[opp.name]) || 0,
    },
    __byName: byName,
  };
  state.revealed_roles = { duke: 0, assassin: 0, captain: 0, ambassador: 0, contessa: 0 };
  for (const p of game.players) {
    for (const r of p.graveyard) state.revealed_roles[r]++;
  }
  state.__roles = game.roles;   // variant support: the roles actually in play
  return state;
}

function buildActionInfo(game, state, kind) {
  const ctx = game.ctx;
  const pend = game.pending;
  const playerObj = (id) => state.players.find((p) => p.__id === id) || null;
  if (!ctx) return null;
  const info = {
    type: ctx.type,
    actor: playerObj(ctx.actor),
    target: ctx.target ? playerObj(ctx.target) : null,
    call: ctx.call || null,                     // the named character, if any
    is_block: false,
    claimed_role: ACTIONS[ctx.type] && ACTIONS[ctx.type].role ? ACTIONS[ctx.type].role : null,
  };
  if (kind === 'challenge' && pend && pend.claim) {
    info.claimed_role = pend.claim.role;
    info.is_block = !!pend.blocking;
    if (pend.blocking) {
      info.blocker = playerObj(pend.claim.player);
      info.blocked_action = ctx.type;
    }
  }
  info.already_claimed = false;
  const claimant = info.is_block ? info.blocker : info.actor;
  if (claimant && info.claimed_role) {
    let count = 0;
    for (const e of game.log) {
      if (e.t === 'exchanged' && e.player === claimant.__id) count = 0;
      else if (e.t === 'action' && e.player === claimant.__id
        && ACTIONS[e.action] && ACTIONS[e.action].role === info.claimed_role) count++;
      else if (e.t === 'block' && e.player === claimant.__id && e.role === info.claimed_role) count++;
    }
    info.already_claimed = count >= 2;
  }
  return info;
}

// ------------------------------------------------------------ builtins
const NUMERIC_PLAYER_PROPS = new Set(['coins', 'num_cards', 'lives', 'claims', 'cards_lost', 'graveyard',
  'challenges_made', 'successful_challenges', 'times_caught_bluffing',
  'series_win_rate', 'series_wins', 'series_challenges_per_game', 'series_claims_per_game',
  'series_caught_bluffing', 'series_honest_proofs', 'series_contessa_rate',
  'series_caught_per_game', 'series_proofs_per_game']);

function pickOpponent(st, prop, dir) {
  const p = String(prop || '');
  if (!st || !Array.isArray(st.opponents) || !st.opponents.length) return null;
  if (!NUMERIC_PLAYER_PROPS.has(p)) {
    throw new BotRuntimeError(`opponent_with_most/least needs a stat name like "coins" — got ${repr(prop)}`);
  }
  const val = (o) => (Array.isArray(o[p]) ? o[p].length : Number(o[p]) || 0);
  return st.opponents.reduce((a, b) => (dir * (val(b) - val(a)) > 0 ? b : a));
}

function gameBuiltins(state, rng = null) {
  const nat = (name, fn) => [name, { __native: fn, name }];
  const asRole = (x, what) => {
    if (x === null || x === undefined) return null;
    if (typeof x === 'object') return null;          // legacy player-object arg → auto-call
    const r = String(x).toLowerCase();
    if (!ROLES.includes(r)) throw new BotRuntimeError(`${what} needs a character name, got ${repr(x)}`);
    return r;
  };
  return Object.fromEntries([
    // actions
    nat('income', () => ({ __act: 'income' })),
    nat('foreign_aid', () => ({ __act: 'foreign_aid' })),
    nat('tax', () => ({ __act: 'tax' })),
    nat('exchange', () => ({ __act: 'exchange' })),
    // no Captain in the dynaMIT rules, so no steal. Kept registered (rather
    // than simply absent) so calling it explains itself instead of surfacing
    // as a bare "not defined" — same wording the block decompiler uses.
    nat('steal', () => {
      throw new Error('steal() is not a move — there is no Captain in the dynaMIT rules. Try income(), foreign_aid(), tax(), exchange(), coup(role) or assassinate(role, p).');
    }),
    // coup("duke") — CALL the coup; coup() lets the engine pick best_coup_call
    nat('coup', (call) => ({ __act: 'coup', call: asRole(call, 'coup') })),
    // assassinate("captain", p): name the character; challenge a Contessa
    // block with probability p
    nat('assassinate', (call, p) => ({
      __act: 'assassinate', call: asRole(call, 'assassinate'),
      p: Math.max(0, Math.min(1, Number(p) || 0)),
    })),
    // responses
    nat('allow', () => ({ __resp: 'pass' })),
    nat('challenge', () => ({ __resp: 'challenge' })),
    nat('block', (role) => {
      const r = String(role || '').toLowerCase();
      if (!ROLES.includes(r)) throw new BotRuntimeError(`block() needs a role name, got ${repr(role)}`);
      return { __resp: 'block', role: r };
    }),
    nat('block_contessa', () => ({ __resp: 'block', role: 'contessa' })),
    nat('reveal', (role) => {
      const r = String(role || '').toLowerCase();
      if (!ROLES.includes(r)) throw new BotRuntimeError(`reveal() needs a role name, got ${repr(role)}`);
      return { __reveal: r };
    }),
    // math toolkit
    nat('prob_opponent_has', (st, role) => probOpponentHas(st, role)),
    nat('unseen_copies', (st, role) => {
      const r = String(role || '').toLowerCase();
      if (!ROLES.includes(r)) throw new BotRuntimeError(`unseen_copies needs a role name, got ${repr(role)}`);
      return Math.max(0, 3 - (st.revealed_roles[r] || 0) - st.my_cards.filter((c) => c === r).length);
    }),
    // a jitter argument only ever flips a near-tie; the seeded rng keeps
    // replays bit-identical, which Math.random would not
    nat('best_coup_call', (st, jit) => bestCoupCall(st, Number(jit) || 0, rng)),
    // convenience
    nat('has_role', (st, role) => (st && Array.isArray(st.my_cards) ? st.my_cards.includes(String(role).toLowerCase()) : false)),
    // how many times a player has claimed a role THIS game (resets when their
    // hand is replaced: exchange, redraw, or a proven challenge)
    nat('times_claimed', (player, role) => {
      const r = String(role || '').toLowerCase();
      if (!player || typeof player !== 'object' || !player.claim_counts) {
        throw new BotRuntimeError('times_claimed(player, role) needs a player, e.g. state.opponent');
      }
      if (!(r in player.claim_counts)) throw new BotRuntimeError(`times_claimed: unknown role ${repr(role)}`);
      return player.claim_counts[r];
    }),
    nat('player_named', (name) => state.__byName[name] || null),
    nat('opponent_with_most', (st, prop) => pickOpponent(st, prop, 1)),
    nat('opponent_with_least', (st, prop) => pickOpponent(st, prop, -1)),
    nat('claimed_card', (st) => {
      const cards = (st && st.my_cards) || [];
      return cards.find((r) => (st.my_claims || []).includes(r)) ?? cards[0] ?? null;
    }),
    nat('unclaimed_card', (st) => {
      const cards = (st && st.my_cards) || [];
      return cards.find((r) => !(st.my_claims || []).includes(r)) ?? cards[0] ?? null;
    }),
    nat('cards_in', (cards, roles) => {
      if (!Array.isArray(cards) || !Array.isArray(roles)) throw new BotRuntimeError('cards_in(cards, roles) needs two lists');
      return cards.filter((r) => roles.includes(r));
    }),
    nat('cards_not_in', (cards, roles) => {
      if (!Array.isArray(cards) || !Array.isArray(roles)) throw new BotRuntimeError('cards_not_in(cards, roles) needs two lists');
      return cards.filter((r) => !roles.includes(r));
    }),
    nat('strongest_cards', (cards, order, n) => {
      if (!Array.isArray(cards)) throw new BotRuntimeError('strongest_cards() needs a list of cards first (e.g. pool)');
      const ord = (Array.isArray(order) ? order : []).map((r) => String(r).toLowerCase());
      const rank = (r) => { const i = ord.indexOf(r); return i < 0 ? 99 : i; };
      const sorted = [...cards].map((r) => String(r).toLowerCase()).sort((a, b) => rank(a) - rank(b));
      if (n === undefined || n === null) return sorted;
      return sorted.slice(0, Math.max(0, Math.min(sorted.length, Math.trunc(Number(n) || 0))));
    }),
  ]);
}

// ------------------------------------------------------------ ScriptBot
class ScriptBot {
  constructor(source, name) {
    this.name = name;
    this.errors = [];
    this.program = compile(source);
  }

  /** forget the bot's top-level variables — called between series, so its own
   *  memory spans exactly what state.series does and no more */
  resetMemory() { this.program.resetGlobals(); this._lastGame = null; }

  /**
   * Build a state, and fire the optional `new_game(state)` hook the first time
   * we are asked anything in a fresh game.
   *
   * This exists because top-level variables survive the whole matchup, so
   * anything a bot counts per-game has to be cleared somewhere. Doing that by
   * hand is a trap: whoever moves first decides whether your_turn or respond
   * runs first, so a reset written into only one of them silently never fires
   * in half the games. The engine calls the hook instead, before any decision,
   * every game, no matter who leads.
   */
  _state(game, selfId, names, seriesCtx, rng) {
    const state = buildState(game, selfId, names, seriesCtx);
    const g = state.series.game;
    if (this._lastGame !== g) {
      this._lastGame = g;
      if (this.program.has('new_game')) this._call('new_game', [state], state, rng);
    }
    return state;
  }

  _call(fn, args, state, rng) {
    if (!this.program.has(fn)) return undefined;
    try {
      return this.program.call(fn, args, { env: Object.assign({ state }, gameBuiltins(state, rng)), rng });
    } catch (err) {
      this.errors.push({ fn, message: err.message, line: err.line });
      return undefined;
    }
  }

  /** → engine action {type, call, p} */
  yourTurn(game, selfId, names, seriesCtx, rng) {
    const state = this._state(game, selfId, names, seriesCtx, rng);
    const mustCoup = game.player(selfId).coins >= 10;
    const legal = game.legalActions(selfId);
    const v = this._call('your_turn', [state], state, rng);
    const auto = () => bestCoupCall(state);
    if (!v || typeof v !== 'object' || !v.__act) return this._fallbackAction(state, legal, mustCoup);
    const spec = legal.find((l) => l.type === v.__act);
    if (!spec || (mustCoup && v.__act !== 'coup')) return this._fallbackAction(state, legal, mustCoup);
    const act = { type: v.__act, call: null, p: v.p || 0 };
    if (spec.call) {
      act.call = v.call || auto();
      if (!game.roles.includes(act.call)) act.call = auto(); // variant: role removed
    }
    return act;
  }

  _fallbackAction(state, legal, mustCoup) {
    const coup = legal.find((l) => l.type === 'coup');
    if (coup && (mustCoup || state.my_coins >= 7)) {
      return { type: 'coup', call: bestCoupCall(state), p: 0 };
    }
    return { type: 'income', call: null, p: 0 };
  }

  respond(game, selfId, names, seriesCtx, rng, kind) {
    const state = this._state(game, selfId, names, seriesCtx, rng);
    const action = buildActionInfo(game, state, kind);
    const v = this._call('respond', [state, action], state, rng);
    if (!v || typeof v !== 'object' || !v.__resp) return 'pass';
    if (v.__resp === 'challenge') return kind === 'challenge' ? { challenge: true } : 'pass';
    if (v.__resp === 'block') {
      if (kind !== 'block' || !game.pending.roles.includes(v.role)) return 'pass';
      return { block: v.role };
    }
    return 'pass';
  }

  /** → {block:'contessa'} | {reveal: role|null} — sees the called role */
  whenAssassinated(game, selfId, names, seriesCtx, rng) {
    const state = this._state(game, selfId, names, seriesCtx, rng);
    const action = buildActionInfo(game, state, 'block');
    action.call = game.pending && game.pending.call ? game.pending.call : action.call;
    const v = this._call('when_assassinated', [state, action], state, rng);
    if (v && typeof v === 'object') {
      if (v.__resp === 'block' && v.role === 'contessa') return { block: 'contessa' };
      if (v.__resp === 'pass') return { reveal: null };
      if (v.__reveal) return { reveal: v.__reveal };
    }
    // fallback: if the call would MISS, let it happen; else block if honest,
    // else block anyway when the hit would be fatal
    const call = game.pending && game.pending.call;
    if (call && !state.my_cards.includes(call)) return { reveal: null };
    if (state.my_cards.includes('contessa')) return { block: 'contessa' };
    if (state.my_lives <= 1) return { block: 'contessa' };
    return { reveal: null };
  }

  chooseCardToLose(game, selfId, names, seriesCtx, rng, preferRole = null) {
    const p = game.player(selfId);
    if (p.cards.length === 1) return 0;
    let role = preferRole;
    if (!role) {
      const state = this._state(game, selfId, names, seriesCtx, rng);
      const v = this._call('choose_card_to_lose', [state], state, rng);
      if (v && typeof v === 'object' && v.__reveal) role = v.__reveal;
    }
    const idx = role ? p.cards.indexOf(role) : -1;
    if (idx >= 0) return idx;
    // fallback: give up the least valuable card
    let worst = 0;
    for (let i = 1; i < p.cards.length; i++) {
      if (ROLE_VALUE[p.cards[i]] < ROLE_VALUE[p.cards[worst]]) worst = i;
    }
    return worst;
  }

  chooseExchange(game, selfId, names, seriesCtx, rng) {
    const { pool, keep, reason } = game.pending;
    if (this.program.has('choose_exchange')) {
      const state = this._state(game, selfId, names, seriesCtx, rng);
      const v = this._call('choose_exchange', [state, [...pool], reason || 'ambassador'], state, rng);
      if (Array.isArray(v) && v.length === keep) {
        const used = new Set();
        const idxs = [];
        for (const want of v) {
          const r = String(want).toLowerCase();
          const i = pool.findIndex((x, k) => x === r && !used.has(k));
          if (i < 0) { idxs.length = 0; break; }
          used.add(i); idxs.push(i);
        }
        if (idxs.length === keep) return idxs;
      }
    }
    // default keep: most valuable distinct roles first
    const order = pool.map((r, i) => ({ r, i, score: ROLE_VALUE[r] }))
      .sort((a, b) => b.score - a.score);
    const chosen = [];
    for (const c of order) {
      if (chosen.length < keep && !chosen.some((x) => pool[x] === c.r)) chosen.push(c.i);
    }
    for (const c of order) {
      if (chosen.length < keep && !chosen.includes(c.i)) chosen.push(c.i);
    }
    return chosen.slice(0, keep);
  }
}

// ------------------------------------------------------------ checker
/**
 * "Check my bot": compile, then call each function directly against a battery
 * of real game states and explain EXACTLY what is wrong in kid terms —
 * which function, which line, missing returns, wrong kinds of return values.
 * Returns {ok, problems: [{fn, line, message}], notes, functions: [{fn, status}]}.
 */
function describeReturn(v) {
  if (v === null || v === undefined) return 'nothing (None)';
  if (typeof v === 'object') {
    if (v.__act) return `the action ${v.__act}(...)`;
    if (v.__resp === 'pass') return 'allow()';
    if (v.__resp === 'challenge') return 'challenge()';
    if (v.__resp === 'block') return `block("${v.role}")`;
    if (v.__reveal) return `reveal("${v.__reveal}")`;
    if (Array.isArray(v)) return 'a list';
  }
  if (typeof v === 'string') return `the text "${v}"`;
  if (typeof v === 'number') return `the number ${v}`;
  if (v === true || v === false) return `${v}`;
  return 'something the game does not understand';
}

function checkProgram(source) {
  const problems = [];
  const notes = [];
  let program;
  try {
    program = compile(source);
  } catch (err) {
    return {
      ok: false, notes,
      problems: [{ line: err.line, message: `This is not valid code: ${err.message}` }],
      functions: [],
    };
  }

  const CORE = ['your_turn', 'respond', 'when_assassinated', 'choose_card_to_lose'];
  const status = {};
  for (const fn of CORE) status[fn] = program.has(fn) ? 'ok' : 'default';
  if (program.has('choose_exchange')) status.choose_exchange = 'ok';
  if (program.has('new_game')) status.new_game = 'ok';
  for (const fn of CORE) {
    if (!program.has(fn)) notes.push(`"${fn}" is not defined — the bot will use the built-in default for it.`);
  }
  if (!program.has('your_turn')) {
    problems.push({ fn: 'your_turn', message: 'your_turn(state) is missing — this one is the heart of your bot.' });
    status.your_turn = 'error';
  }

  const { CoupGame } = require('./coup');
  const mkRng = (seedArr) => { let i = 0; return () => seedArr[(i++) % seedArr.length]; };
  const defLine = (fn) => (program.ast.fns[fn] ? program.ast.fns[fn].line : undefined);
  const addProblem = (fn, message, line) => {
    problems.push({ fn, line: line ?? defLine(fn), message });
    status[fn] = 'error';
  };

  const callRaw = (fn, state, extraArgs, rng) => {
    try {
      const env = Object.assign({ state }, gameBuiltins(state, rng));
      return { value: program.call(fn, [state, ...extraArgs], { env, rng }) };
    } catch (err) {
      return { threw: err };
    }
  };

  const seeds = [[0.1, 0.5, 0.9, 0.3, 0.7], [0.8, 0.2, 0.6, 0.4, 0.05], [0.33, 0.77, 0.51, 0.12, 0.95]];
  const seen = new Set();
  const once = (fn, message, line) => {
    const k = fn + '|' + message;
    if (seen.has(k)) return;
    seen.add(k);
    addProblem(fn, message, line);
  };

  for (const seedArr of seeds) {
    const rng = mkRng(seedArr);
    const names = { a: 'you', b: 'Rival' };

    // ---- state 0: run new_game first, exactly as a real game does.
    // Without this, a bot whose memory starts at None fails the whole battery
    // on "expected a number but got None" — a bot that plays perfectly well.
    if (program.has('new_game')) {
      const g0 = new CoupGame(['a', 'b'], mkRng(seedArr));
      const r0 = callRaw('new_game', buildState(g0, 'a', names, {}), [], rng);
      if (r0.threw) once('new_game', `crashed: ${r0.threw.message}`, r0.threw.line);
    }

    // ---- state 1: your turn, mid-game flavor
    const g1 = new CoupGame(['a', 'b'], rng);
    g1.player('a').coins = 3;
    g1.player('b').coins = 8;
    g1.log.push({ n: g1.log.length, t: 'action', action: 'tax', player: 'b', target: null });
    g1.log.push({ n: g1.log.length, t: 'action', action: 'assassinate', player: 'b', target: 'a' });
    if (program.has('your_turn')) {
      const st = buildState(g1, 'a', names, {});
      const r = callRaw('your_turn', st, [], rng);
      if (r.threw) {
        once('your_turn', `crashed: ${r.threw.message}`, r.threw.line);
      } else {
        const v = r.value;
        const legal = g1.legalActions('a').map((l) => l.type);
        if (!v || typeof v !== 'object' || !v.__act) {
          once('your_turn', v === null || v === undefined
            ? 'returned nothing — EVERY path through your_turn must end with "return <an action>" like "return income()". Check each if/else branch!'
            : `returned ${describeReturn(v)} — but your_turn must return an ACTION: income(), foreign_aid(), tax(), exchange(), coup(role) or assassinate(role, p).`);
        } else if (!legal.includes(v.__act)) {
          once('your_turn', `tried to ${v.__act}() with only ${g1.player('a').coins} coins — the game would reject it. Check costs (coup 7, assassinate 3) before returning.`);
        }
      }
      // rich state: must be able to coup at 10+
      const g1b = new CoupGame(['a', 'b'], mkRng(seedArr));
      g1b.player('a').coins = 11;
      const st2 = buildState(g1b, 'a', names, {});
      const r2 = callRaw('your_turn', st2, [], rng);
      if (!r2.threw && r2.value && r2.value.__act && r2.value.__act !== 'coup') {
        once('your_turn', `with 10+ coins the rules FORCE you to coup, but your bot returned ${describeReturn(r2.value)}. Add "if state.my_coins >= 10: return coup(...)" near the top.`);
      }
    }

    // ---- state 2: opponent claims Duke (respond as challenge window)
    const g2 = new CoupGame(['a', 'b'], mkRng(seedArr));
    g2.submitAction('a', { type: 'income' });
    if (g2.pending && g2.pending.type === 'action' && g2.pending.player === 'b') {
      g2.submitAction('b', { type: 'tax' });
    }
    if (program.has('respond') && g2.pending && g2.pending.type === 'challenge') {
      const st = buildState(g2, 'a', names, {});
      const info = buildActionInfo(g2, st, 'challenge');
      const r = callRaw('respond', st, [info], rng);
      if (r.threw) {
        once('respond', `crashed: ${r.threw.message}`, r.threw.line);
      } else {
        const v = r.value;
        if (!v || typeof v !== 'object' || (!v.__resp && !v.__act)) {
          once('respond', v === null || v === undefined
            ? 'returned nothing — every path through respond must end with "return allow()", "return challenge()" or "return block(role)". The safe last line is "return allow()".'
            : `returned ${describeReturn(v)} — but respond must return allow(), challenge() or block(role).`);
        } else if (v.__act) {
          once('respond', `returned ${describeReturn(v)} — that is a TURN action, but respond answers the opponent's move: return allow(), challenge() or block(role) instead.`);
        }
      }
    }

    // ---- state 3: a real assassination naming a card (when_assassinated)
    const g3 = new CoupGame(['a', 'b'], mkRng(seedArr));
    g3.player('b').coins = 3;
    g3.submitAction('a', { type: 'income' });
    if (g3.pending && g3.pending.type === 'action' && g3.pending.player === 'b') {
      g3.submitAction('b', { type: 'assassinate', call: 'duke' });
      if (g3.pending && g3.pending.type === 'challenge') g3.resolveChallenge(null);
    }
    if (program.has('when_assassinated') && g3.pending && g3.pending.type === 'block') {
      const st = buildState(g3, 'a', names, {});
      const info = buildActionInfo(g3, st, 'block');
      info.call = g3.pending.call || 'duke';
      const r = callRaw('when_assassinated', st, [info], rng);
      if (r.threw) {
        once('when_assassinated', `crashed: ${r.threw.message}`, r.threw.line);
      } else {
        const v = r.value;
        const okShape = v && typeof v === 'object'
          && ((v.__resp === 'block' && v.role === 'contessa') || v.__resp === 'pass' || v.__reveal);
        if (v === null || v === undefined) {
          once('when_assassinated', 'returned nothing — every path must end with "return block_contessa()" or "return allow()" (allow = let it happen; smart when their call would miss!).');
        } else if (v && v.__resp === 'block' && v.role !== 'contessa') {
          once('when_assassinated', `tried to block an assassination with ${v.role} — only the CONTESSA blocks assassinations. Use block_contessa().`);
        } else if (v && v.__act) {
          once('when_assassinated', `returned ${describeReturn(v)} — that is a turn action. When assassinated you can only block_contessa(), allow(), or reveal(card).`);
        } else if (!okShape) {
          once('when_assassinated', `returned ${describeReturn(v)} — expected block_contessa(), allow(), or reveal(card).`);
        }
      }
    }

    // ---- state 4: choosing a card to lose
    if (program.has('choose_card_to_lose')) {
      const g4 = new CoupGame(['a', 'b'], mkRng(seedArr));
      const st = buildState(g4, 'a', names, {});
      const r = callRaw('choose_card_to_lose', st, [], rng);
      if (r.threw) {
        once('choose_card_to_lose', `crashed: ${r.threw.message}`, r.threw.line);
      } else {
        const v = r.value;
        if (v === null || v === undefined) {
          once('choose_card_to_lose', 'returned nothing — end every path with "return reveal(<one of your cards>)", e.g. "return reveal(state.my_cards[0])".');
        } else if (!v || typeof v !== 'object' || !v.__reveal) {
          once('choose_card_to_lose', `returned ${describeReturn(v)} — but this function must return reveal(card), e.g. "return reveal(state.my_cards[0])".`);
        } else if (!st.my_cards.includes(v.__reveal)) {
          notes.push(`choose_card_to_lose picked "${v.__reveal}" in a test game where your hand was [${st.my_cards.join(', ')}] — the game will fall back to a card you actually hold. Prefer picking from state.my_cards.`);
        }
      }
    }

    // ---- state 5: exchange keeps (optional function)
    if (program.has('choose_exchange')) {
      const g5 = new CoupGame(['a', 'b'], mkRng(seedArr));
      const st = buildState(g5, 'a', names, {});
      const pool = [...st.my_cards, 'duke', 'contessa'];
      const r = callRaw('choose_exchange', st, [pool, 'ambassador'], rng);
      if (r.threw) {
        once('choose_exchange', `crashed: ${r.threw.message}`, r.threw.line);
      } else {
        const v = r.value;
        if (!Array.isArray(v)) {
          once('choose_exchange', `returned ${describeReturn(v)} — choose_exchange must return a LIST of role names to keep, e.g. ["duke", "contessa"].`);
        } else if (v.length !== st.my_num_cards) {
          once('choose_exchange', `kept ${v.length} card(s) but you must keep exactly ${st.my_num_cards} (as many as you hold). The game will ignore a wrong-sized keep.`);
        }
      }
    }

    if (problems.length >= 6) break; // enough to work on
  }

  const functions = ['your_turn', 'respond', 'when_assassinated', 'choose_card_to_lose',
    'choose_exchange', 'new_game']
    .filter((fn) => status[fn])
    .map((fn) => ({ fn, status: status[fn] }));
  return { ok: problems.length === 0, problems, notes, functions };
}

module.exports = {
  ScriptBot, buildState, buildActionInfo, tallyLog, checkProgram, gameBuiltins,
  probOpponentHas, bestCoupCall, CompileError, BotRuntimeError,
};
