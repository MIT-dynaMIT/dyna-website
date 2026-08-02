/**
 * botapi — the bridge between the heads-up Coup engine and student bots.
 *
 * Student functions (all optional, safe fallbacks everywhere):
 *   your_turn(state)                 → income() | tax() | steal() | exchange()
 *                                      | foreign_aid() | coup(role)
 *                                      | assassinate(role, p)
 *                                      (coup/assassinate NAME a character —
 *                                       "call the coup"; p = probability of
 *                                       challenging a Contessa block)
 *   respond(state, action)           → allow() | challenge() | block(role)
 *   when_assassinated(state, action) → block_contessa() | allow()
 *   choose_card_to_lose(state)       → reveal(role)
 *   choose_exchange(state, pool)     → list of role names to keep
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
const TOTAL_CARDS = 15;

// ------------------------------------------------------------ log tallies
function tallyLog(log, ids) {
  const T = {};
  for (const id of ids) {
    T[id] = {
      claims: [], challengesMade: 0, challengesWon: 0, caughtBluffing: 0,
      actions: 0, lastRevealed: [], lastRevealedAt: -1,
    };
  }
  let actionNo = 0;
  for (const e of log) {
    if (e.t === 'action') {
      actionNo++;
      const a = ACTIONS[e.action];
      if (T[e.player]) {
        T[e.player].actions++;
        if (a && a.role && !T[e.player].claims.includes(a.role)) T[e.player].claims.push(a.role);
      }
    } else if (e.t === 'block') {
      if (T[e.player] && !T[e.player].claims.includes(e.role)) T[e.player].claims.push(e.role);
    } else if (e.t === 'challenge') {
      if (T[e.by]) {
        T[e.by].challengesMade++;
        if (!e.truthful) T[e.by].challengesWon++;
      }
      if (T[e.against]) {
        if (e.truthful) {
          T[e.against].claims = T[e.against].claims.filter((r) => r !== e.role);
        } else {
          T[e.against].caughtBluffing++;
        }
      }
    } else if (e.t === 'miss') {
      if (T[e.target]) {
        T[e.target].lastRevealed = [...(e.revealed || [])];
        T[e.target].lastRevealedAt = actionNo;
      }
    } else if (e.t === 'exchanged') {
      if (T[e.player]) {
        T[e.player].claims = [];
        if (e.reason !== 'miss') { T[e.player].lastRevealed = []; T[e.player].lastRevealedAt = -1; }
      }
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
  const k = opp.num_cards;
  const unseen = TOTAL_CARDS - state.my_cards.length - state.my_graveyard.length - opp.graveyard.length;
  const avail = 3 - (state.revealed_roles[r] || 0) - state.my_cards.filter((c) => c === r).length;
  if (avail <= 0 || k <= 0 || unseen <= 0) return 0;
  return 1 - choose(unseen - avail, k) / choose(unseen, k);
}

/** claim- and reveal-weighted best role to name in a coup/assassination */
function bestCoupCall(state) {
  const opp = state.opponent;
  let best = 'duke', bestScore = -1;
  for (const r of ROLES) {
    let score = probOpponentHas(state, r);
    if (opp) {
      if (opp.claims.includes(r)) score *= 1.7;                       // they said so
      if (opp.last_revealed.includes(r)) {
        // after a miss they kept a hand's worth of (revealed + 2 drawn):
        // revealed cards usually survive the redraw. Decay slowly.
        score *= opp.last_revealed_age <= 2 ? 1.9
          : opp.last_revealed_age <= 12 ? 1.5 : 1.15;
      }
      score *= 1 + 0.05 * ROLE_VALUE[r];  // players tend to keep the strong cards
    }
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return best;
}

// ------------------------------------------------------------ state building
function buildState(game, selfId, names, scrimStats = {}) {
  const nameOf = (id) => names[id] || String(id);
  const tally = tallyLog(game.log, game.players.map((p) => p.id));
  const byName = {};

  const players = game.players.map((p) => {
    const t = tally[p.id];
    const st = scrimStats[p.id] || {};
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
      challenges_made: t ? t.challengesMade : 0,
      successful_challenges: t ? t.challengesWon : 0,
      times_caught_bluffing: t ? t.caughtBluffing : 0,
      last_revealed: t ? [...t.lastRevealed] : [],
      last_revealed_age: (t && t.lastRevealedAt >= 0) ? (tally.__actionNo - t.lastRevealedAt) : 999,
      scrim_challenge_success: st.challenge_success ?? 0.5,
      scrim_bluff_rate: st.bluff_rate ?? 0.25,
      scrim_win_rate: st.win_rate ?? 0.5,
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
    __byName: byName,
  };
  state.revealed_roles = { duke: 0, assassin: 0, captain: 0, ambassador: 0, contessa: 0 };
  for (const p of game.players) {
    for (const r of p.graveyard) state.revealed_roles[r]++;
  }
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
  'scrim_challenge_success', 'scrim_bluff_rate', 'scrim_win_rate']);

function pickOpponent(st, prop, dir) {
  const p = String(prop || '');
  if (!st || !Array.isArray(st.opponents) || !st.opponents.length) return null;
  if (!NUMERIC_PLAYER_PROPS.has(p)) {
    throw new BotRuntimeError(`opponent_with_most/least needs a stat name like "coins" — got ${repr(prop)}`);
  }
  const val = (o) => (Array.isArray(o[p]) ? o[p].length : Number(o[p]) || 0);
  return st.opponents.reduce((a, b) => (dir * (val(b) - val(a)) > 0 ? b : a));
}

function gameBuiltins(state) {
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
    nat('steal', () => ({ __act: 'steal' })),
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
    nat('best_coup_call', (st) => bestCoupCall(st)),
    // convenience
    nat('has_role', (st, role) => (st && Array.isArray(st.my_cards) ? st.my_cards.includes(String(role).toLowerCase()) : false)),
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

  _call(fn, args, state, rng) {
    if (!this.program.has(fn)) return undefined;
    try {
      return this.program.call(fn, args, { env: Object.assign({ state }, gameBuiltins(state)), rng });
    } catch (err) {
      this.errors.push({ fn, message: err.message, line: err.line });
      return undefined;
    }
  }

  /** → engine action {type, call, p} */
  yourTurn(game, selfId, names, scrimStats, rng) {
    const state = buildState(game, selfId, names, scrimStats);
    const mustCoup = game.player(selfId).coins >= 10;
    const legal = game.legalActions(selfId);
    const v = this._call('your_turn', [state], state, rng);
    const auto = () => bestCoupCall(state);
    if (!v || typeof v !== 'object' || !v.__act) return this._fallbackAction(state, legal, mustCoup);
    const spec = legal.find((l) => l.type === v.__act);
    if (!spec || (mustCoup && v.__act !== 'coup')) return this._fallbackAction(state, legal, mustCoup);
    const act = { type: v.__act, call: null, p: v.p || 0 };
    if (spec.call) act.call = v.call || auto();
    return act;
  }

  _fallbackAction(state, legal, mustCoup) {
    const coup = legal.find((l) => l.type === 'coup');
    if (coup && (mustCoup || state.my_coins >= 7)) {
      return { type: 'coup', call: bestCoupCall(state), p: 0 };
    }
    return { type: 'income', call: null, p: 0 };
  }

  respond(game, selfId, names, scrimStats, rng, kind) {
    const state = buildState(game, selfId, names, scrimStats);
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
  whenAssassinated(game, selfId, names, scrimStats, rng) {
    const state = buildState(game, selfId, names, scrimStats);
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

  chooseCardToLose(game, selfId, names, scrimStats, rng, preferRole = null) {
    const p = game.player(selfId);
    if (p.cards.length === 1) return 0;
    let role = preferRole;
    if (!role) {
      const state = buildState(game, selfId, names, scrimStats);
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

  chooseExchange(game, selfId, names, scrimStats, rng) {
    const { pool, keep, reason } = game.pending;
    if (this.program.has('choose_exchange')) {
      const state = buildState(game, selfId, names, scrimStats);
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
    // default keep: value-ranked, but after a MISS the opponent has just seen
    // our old cards (pool[0..keep-1]) — prefer the freshly drawn ones so the
    // next call at us is a guess again
    const seenPenalty = reason === 'miss' ? 1.6 : 0;
    const order = pool.map((r, i) => ({ r, i, score: ROLE_VALUE[r] - (i < keep ? seenPenalty : 0) }))
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
      const env = Object.assign({ state }, gameBuiltins(state));
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

    // ---- state 1: your turn, mid-game flavor
    const g1 = new CoupGame(['a', 'b'], rng);
    g1.player('a').coins = 3;
    g1.player('b').coins = 8;
    g1.log.push({ n: g1.log.length, t: 'action', action: 'tax', player: 'b', target: null });
    g1.log.push({ n: g1.log.length, t: 'action', action: 'steal', player: 'b', target: 'a' });
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
            : `returned ${describeReturn(v)} — but your_turn must return an ACTION: income(), foreign_aid(), tax(), steal(), exchange(), coup(role) or assassinate(role, p).`);
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

  const functions = ['your_turn', 'respond', 'when_assassinated', 'choose_card_to_lose', 'choose_exchange']
    .filter((fn) => status[fn])
    .map((fn) => ({ fn, status: status[fn] }));
  return { ok: problems.length === 0, problems, notes, functions };
}

module.exports = {
  ScriptBot, buildState, buildActionInfo, tallyLog, checkProgram, gameBuiltins,
  probOpponentHas, bestCoupCall, CompileError, BotRuntimeError,
};
