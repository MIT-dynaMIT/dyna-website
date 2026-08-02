/**
 * botapi — the bridge between the Coup engine and student bot programs.
 *
 * Students implement four functions (all optional — sensible fallbacks fill
 * the gaps):
 *
 *   your_turn(state)                → an action: income(), tax(), coup(p), ...
 *                                     assassinate(target, p) auto-challenges a
 *                                     Contessa block with probability p
 *   respond(state, action)          → allow() | challenge() | block(role)
 *   when_assassinated(state, action)→ block_contessa() | reveal(role)
 *   choose_card_to_lose(state)      → reveal(role)
 *
 * Optional power-user hook: choose_exchange(state, pool) → list of roles to keep.
 *
 * `state` is rebuilt from the public log on every call, so bots see live,
 * claim-accurate info: a player's `claims` list is cleared when they exchange
 * (Ambassador) and a proven role is removed when they show it and redraw.
 */
'use strict';

const { compile, CompileError, BotRuntimeError, repr } = require('./botlang');
const { ACTIONS, ROLES } = require('./coup');

const ROLE_VALUE = { duke: 5, contessa: 4, captain: 3, assassin: 2, ambassador: 1 };

// ------------------------------------------------------------ log tallies
/** Rebuild per-player public knowledge from the game log. */
function tallyLog(log, ids) {
  const T = {};
  for (const id of ids) {
    T[id] = { claims: [], challengesMade: 0, challengesWon: 0, caughtBluffing: 0, attacked: {}, actions: 0 };
  }
  for (const e of log) {
    if (e.t === 'action') {
      const a = ACTIONS[e.action];
      if (T[e.player]) {
        T[e.player].actions++;
        if (a && a.role && !T[e.player].claims.includes(a.role)) T[e.player].claims.push(a.role);
      }
      if (e.target && T[e.target] && (e.action === 'steal' || e.action === 'assassinate' || e.action === 'coup')) {
        T[e.target].attacked[e.player] = (T[e.target].attacked[e.player] || 0) + 1;
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
          // proved it and drew a replacement — that claim no longer means anything
          T[e.against].claims = T[e.against].claims.filter((r) => r !== e.role);
        } else {
          T[e.against].caughtBluffing++;
        }
      }
    } else if (e.t === 'exchanged') {
      if (T[e.player]) T[e.player].claims = []; // whole hand may have changed
    }
  }
  return T;
}

function friendlyHistory(log, nameOf) {
  const out = [];
  for (const e of log) {
    if (e.t === 'action') out.push({ event: 'action', action: e.action, player: nameOf(e.player), target: e.target ? nameOf(e.target) : null });
    else if (e.t === 'block') out.push({ event: 'block', player: nameOf(e.player), role: e.role, action: e.action });
    else if (e.t === 'blocked') out.push({ event: 'blocked', action: e.action, player: nameOf(e.by) });
    else if (e.t === 'challenge') out.push({ event: 'challenge', player: nameOf(e.by), against: nameOf(e.against), role: e.role, won: !e.truthful });
    else if (e.t === 'lost') out.push({ event: 'lost_card', player: nameOf(e.player), role: e.role, why: e.why });
    else if (e.t === 'stole') out.push({ event: 'stole', player: nameOf(e.actor), target: nameOf(e.target), amount: e.amount });
    else if (e.t === 'exchanged') out.push({ event: 'exchanged', player: nameOf(e.player) });
  }
  return out;
}

// ------------------------------------------------------------ state building
/**
 * Build the `state` object a bot sees.
 *  game       CoupGame
 *  selfId     engine player id of this bot
 *  names      {engineId → display name}
 *  scrimStats {engineId → {challenge_success, bluff_rate, win_rate, games}}
 */
function buildState(game, selfId, names, scrimStats = {}) {
  const nameOf = (id) => names[id] || String(id);
  const tally = tallyLog(game.log, game.players.map((p) => p.id));
  const byName = {};

  const players = game.players.map((p) => {
    const t = tally[p.id];
    const st = scrimStats[p.id] || {};
    const attackedMe = t ? Object.entries(tally[selfId] ? tally[selfId].attacked : {}) : [];
    const obj = {
      name: nameOf(p.id),
      is_me: p.id === selfId,
      alive: game.isAlive(p),
      coins: p.coins,
      num_cards: p.cards.filter((c) => !c.revealed).length,
      cards_lost: p.cards.filter((c) => c.revealed).map((c) => c.role),
      claims: t ? [...t.claims] : [],
      challenges_made: t ? t.challengesMade : 0,
      successful_challenges: t ? t.challengesWon : 0,
      times_caught_bluffing: t ? t.caughtBluffing : 0,
      attacked_me: (tally[selfId] && tally[selfId].attacked[p.id]) || 0,
      // scrim-history stats (last ~50 games), neutral defaults when unknown
      scrim_challenge_success: st.challenge_success ?? 0.5,
      scrim_bluff_rate: st.bluff_rate ?? 0.25,
      scrim_win_rate: st.win_rate ?? 0.2,
      __id: p.id,
    };
    byName[obj.name] = obj;
    return obj;
  });

  const me = players.find((p) => p.is_me);
  const self = game.player(selfId);
  const opponents = players.filter((p) => !p.is_me && p.alive);
  const score = (p) => p.num_cards * 10 + Math.min(p.coins, 12) * 0.5;

  const state = {
    // about me
    my_name: me.name,
    my_coins: self.coins,
    my_cards: self.cards.filter((c) => !c.revealed).map((c) => c.role),
    my_num_cards: me.num_cards,
    my_claims: me.claims,
    // the table
    players,
    opponents,
    num_alive: players.filter((p) => p.alive).length,
    deck_count: game.deck.length,
    turn_number: game.log.filter((e) => e.t === 'action').length,
    richest_player: opponents.length ? opponents.reduce((a, b) => (b.coins > a.coins ? b : a)) : null,
    strongest_player: opponents.length ? opponents.reduce((a, b) => (score(b) > score(a) ? b : a)) : null,
    weakest_player: opponents.length ? opponents.reduce((a, b) => (score(b) < score(a) ? b : a)) : null,
    // whole game history, oldest first
    history: friendlyHistory(game.log, nameOf),
    __byName: byName,
  };
  // how many copies of each role are already face-up on the table (3 exist of
  // each — at 3 the role is provably out of the game)
  state.revealed_roles = { duke: 0, assassin: 0, captain: 0, ambassador: 0, contessa: 0 };
  for (const p of game.players) {
    for (const c of p.cards) if (c.revealed) state.revealed_roles[c.role]++;
  }
  return state;
}

/** Describe the action a bot is being asked to respond to. */
function buildActionInfo(game, state, kind) {
  const ctx = game.ctx;
  const pend = game.pending;
  const nameOf = (id) => (state.__byName && Object.values(state.__byName).find((p) => p.__id === id)) || null;
  const playerObj = (id) => state.players.find((p) => p.__id === id) || null;
  if (!ctx) return null;
  const info = {
    type: ctx.type,
    actor: playerObj(ctx.actor),
    target: ctx.target ? playerObj(ctx.target) : null,
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
  // consistency check: had the claimant already claimed this same role earlier
  // in the game (before this move)? Claims stop counting after they exchange.
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
    info.already_claimed = count >= 2; // the current claim is already in the log
  }
  return info;
}

const NUMERIC_PLAYER_PROPS = new Set(['coins', 'num_cards', 'claims', 'cards_lost',
  'challenges_made', 'successful_challenges', 'times_caught_bluffing', 'attacked_me',
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

// ------------------------------------------------------------ action builtins
function gameBuiltins(state) {
  const nat = (name, fn) => [name, { __native: fn, name }];
  const asName = (t) => {
    if (t === null || t === undefined) return null;
    if (typeof t === 'string') return t;
    if (typeof t === 'object' && typeof t.name === 'string') return t.name;
    throw new BotRuntimeError('target must be a player (e.g. state.richest_player) or a name');
  };
  return Object.fromEntries([
    // actions for your_turn
    nat('income', () => ({ __act: 'income' })),
    nat('foreign_aid', () => ({ __act: 'foreign_aid' })),
    nat('tax', () => ({ __act: 'tax' })),
    nat('exchange', () => ({ __act: 'exchange' })),
    nat('steal', (t) => ({ __act: 'steal', target: asName(t) })),
    nat('coup', (t) => ({ __act: 'coup', target: asName(t) })),
    // assassinate(target, p): if the target claims Contessa, challenge with probability p
    nat('assassinate', (t, p) => ({ __act: 'assassinate', target: asName(t), p: Math.max(0, Math.min(1, Number(p) || 0)) })),
    // responses
    nat('allow', () => ({ __resp: 'pass' })),
    nat('challenge', () => ({ __resp: 'challenge' })),
    nat('block', (role) => {
      const r = String(role || '').toLowerCase();
      if (!ROLES.includes(r)) throw new BotRuntimeError(`block() needs a role name, got ${repr(role)}`);
      return { __resp: 'block', role: r };
    }),
    nat('block_contessa', () => ({ __resp: 'block', role: 'contessa' })),
    // card reveals
    nat('reveal', (role) => {
      const r = String(role || '').toLowerCase();
      if (!ROLES.includes(r)) throw new BotRuntimeError(`reveal() needs a role name, got ${repr(role)}`);
      return { __reveal: r };
    }),
    // convenience
    nat('has_role', (st, role) => (st && Array.isArray(st.my_cards) ? st.my_cards.includes(String(role).toLowerCase()) : false)),
    nat('player_named', (name) => state.__byName[name] || null),
    // smart target pickers: the opponent maximizing/minimizing a numeric stat
    nat('opponent_with_most', (st, prop) => pickOpponent(st, prop, 1)),
    nat('opponent_with_least', (st, prop) => pickOpponent(st, prop, -1)),
    // claim-aware card pickers. Never None while you hold cards: if nothing
    // matches, they fall back to your first card so reveal() always works.
    nat('claimed_card', (st) => {
      const cards = (st && st.my_cards) || [];
      return cards.find((r) => (st.my_claims || []).includes(r)) ?? cards[0] ?? null;
    }),
    nat('unclaimed_card', (st) => {
      const cards = (st && st.my_cards) || [];
      return cards.find((r) => !(st.my_claims || []).includes(r)) ?? cards[0] ?? null;
    }),
    // generic filters for power users: subset of `cards` in / not in `roles`
    nat('cards_in', (cards, roles) => {
      if (!Array.isArray(cards) || !Array.isArray(roles)) throw new BotRuntimeError('cards_in(cards, roles) needs two lists');
      return cards.filter((r) => roles.includes(r));
    }),
    nat('cards_not_in', (cards, roles) => {
      if (!Array.isArray(cards) || !Array.isArray(roles)) throw new BotRuntimeError('cards_not_in(cards, roles) needs two lists');
      return cards.filter((r) => !roles.includes(r));
    }),
    // sort cards by a personal power ordering and take the strongest n.
    // strongest_cards(pool, ["duke","contessa",...], 2) → ["duke", ...]
    // Roles missing from the ordering sort last; omit n to get the whole
    // pool sorted strongest-first.
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
  /** @param source botlang source  @param name display name */
  constructor(source, name) {
    this.name = name;
    this.errors = [];
    this.program = compile(source); // throws CompileError to the caller
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

  /** → engine action {type, target(engineId), p} */
  yourTurn(game, selfId, names, scrimStats, rng) {
    const state = buildState(game, selfId, names, scrimStats);
    const mustCoup = game.player(selfId).coins >= 10;
    const legal = game.legalActions(selfId);
    const v = this._call('your_turn', [state], state, rng);
    const fallback = () => this._fallbackAction(state, legal, mustCoup);
    if (!v || typeof v !== 'object' || !v.__act) return fallback();
    const spec = legal.find((l) => l.type === v.__act);
    if (!spec || (mustCoup && v.__act !== 'coup')) return fallback();
    let target = null;
    if (spec.targets) {
      const p = v.target != null ? state.__byName[v.target] : null;
      target = p && spec.targets.includes(p.__id) ? p.__id : null;
      if (!target) {
        // bad/missing target on a targeted action → pick the strongest
        if (v.__act === 'coup' || v.__act === 'assassinate' || v.__act === 'steal') {
          const s = state.strongest_player;
          target = s && spec.targets.includes(s.__id) ? s.__id : spec.targets[0];
        }
      }
    }
    return { type: v.__act, target, p: v.p || 0 };
  }

  _fallbackAction(state, legal, mustCoup) {
    if (mustCoup || legal.some((l) => l.type === 'coup')) {
      const c = legal.find((l) => l.type === 'coup');
      if (c && (mustCoup || state.my_coins >= 7)) {
        const s = state.strongest_player;
        return { type: 'coup', target: s && c.targets.includes(s.__id) ? s.__id : c.targets[0], p: 0 };
      }
    }
    return { type: 'income', target: null, p: 0 };
  }

  /** → 'pass' | {challenge:true} | {block: role} */
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

  /** → {block:'contessa'} | {reveal: role|null} */
  whenAssassinated(game, selfId, names, scrimStats, rng) {
    const state = buildState(game, selfId, names, scrimStats);
    const action = buildActionInfo(game, state, 'block');
    const v = this._call('when_assassinated', [state, action], state, rng);
    if (v && typeof v === 'object') {
      if (v.__resp === 'block' && v.role === 'contessa') return { block: 'contessa' };
      if (v.__reveal) return { reveal: v.__reveal };
    }
    // fallback: block only if we actually hold Contessa
    if (state.my_cards.includes('contessa')) return { block: 'contessa' };
    return { reveal: null };
  }

  /** → card index into player.cards */
  chooseCardToLose(game, selfId, names, scrimStats, rng, preferRole = null) {
    const p = game.player(selfId);
    const unrevealed = p.cards.map((c, i) => ({ role: c.role, i })).filter((_, i) => !p.cards[i].revealed);
    if (unrevealed.length === 1) return unrevealed[0].i;
    let role = preferRole;
    if (!role) {
      const state = buildState(game, selfId, names, scrimStats);
      const v = this._call('choose_card_to_lose', [state], state, rng);
      if (v && typeof v === 'object' && v.__reveal) role = v.__reveal;
    }
    const pick = role ? unrevealed.find((c) => c.role === role) : null;
    if (pick) return pick.i;
    // fallback: give up the least valuable card
    return unrevealed.reduce((a, b) => (ROLE_VALUE[b.role] < ROLE_VALUE[a.role] ? b : a)).i;
  }

  /** → keep indices into pending.pool */
  chooseExchange(game, selfId, names, scrimStats, rng) {
    const { pool, keep } = game.pending;
    if (this.program.has('choose_exchange')) {
      const state = buildState(game, selfId, names, scrimStats);
      const v = this._call('choose_exchange', [state, [...pool]], state, rng);
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
    // default: keep the most valuable distinct roles
    const order = pool.map((r, i) => ({ r, i }))
      .sort((a, b) => ROLE_VALUE[b.r] - ROLE_VALUE[a.r]);
    const chosen = [];
    for (const c of order) { // prefer distinct roles first
      if (chosen.length < keep && !chosen.some((x) => pool[x] === c.r)) chosen.push(c.i);
    }
    for (const c of order) {
      if (chosen.length < keep && !chosen.includes(c.i)) chosen.push(c.i);
    }
    return chosen.slice(0, keep);
  }
}

/**
 * The "does it make sense" checker: compile, then smoke-run every core
 * function against a battery of synthetic game states and verify the returns
 * are things the game can use. Returns {ok, problems: [{fn?, line?, message}], notes}.
 */
function checkProgram(source) {
  const problems = [];
  const notes = [];
  let program;
  try {
    program = compile(source);
  } catch (err) {
    return { ok: false, problems: [{ line: err.line, message: err.message }], notes };
  }
  const { CoupGame } = require('./coup');
  const mkRng = (seedArr) => { let i = 0; return () => seedArr[(i++) % seedArr.length]; };
  const CORE = ['your_turn', 'respond', 'when_assassinated', 'choose_card_to_lose'];
  for (const fn of CORE) {
    if (!program.has(fn)) notes.push(`"${fn}" is not defined — the bot will use the built-in default for it.`);
  }
  if (!program.has('your_turn')) problems.push({ message: 'your_turn(state) is missing — this one is the heart of your bot.' });

  // run a battery: several seeded mini-games, poke each function
  const seeds = [[0.1, 0.5, 0.9, 0.3, 0.7], [0.8, 0.2, 0.6, 0.4, 0.05], [0.33, 0.77, 0.51, 0.12, 0.95]];
  for (const seedArr of seeds) {
    const rng = mkRng(seedArr);
    const game = new CoupGame(['a', 'b', 'c', 'd', 'e'], rng);
    const names = { a: 'you', b: 'Ava', c: 'Ben', d: 'Cleo', e: 'Dan' };
    const bot = Object.create(ScriptBot.prototype);
    bot.name = 'check'; bot.errors = []; bot.program = program;

    // richer mid-game state: log some claims/coins
    game.player('b').coins = 8;
    game.log.push({ n: game.log.length, t: 'action', action: 'tax', player: 'b', target: null });
    game.log.push({ n: game.log.length, t: 'action', action: 'steal', player: 'c', target: 'a' });

    const act = bot.yourTurn(game, 'a', names, {}, rng);
    const legalTypes = game.legalActions('a').map((l) => l.type);
    if (!legalTypes.includes(act.type)) problems.push({ fn: 'your_turn', message: `returned an illegal action "${act.type}"` });

    // respond to a challengeable claim
    game.submitAction('a', { type: 'income' }); // advance turn to b
    if (game.pending && game.pending.type === 'action' && game.pending.player === 'b') {
      game.submitAction('b', { type: 'tax' });
      if (game.pending && game.pending.type === 'challenge') {
        bot.respond(game, 'a', names, {}, rng, 'challenge');
      }
    }
    const g2 = new CoupGame(['a', 'b', 'c', 'd', 'e'], mkRng(seedArr));
    g2.player('a').coins = 5;
    g2.submitAction('a', { type: 'income' });
    bot.whenAssassinated(game, 'a', names, {}, rng);
    bot.chooseCardToLose(game, 'a', names, {}, rng);
    for (const err of bot.errors) {
      problems.push({ fn: err.fn, line: err.line, message: err.message });
    }
    if (bot.errors.length) break;
  }
  // dedupe
  const seen = new Set();
  const unique = problems.filter((p) => {
    const k = `${p.fn}|${p.line}|${p.message}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
  return { ok: unique.length === 0, problems: unique, notes };
}

module.exports = { ScriptBot, buildState, buildActionInfo, tallyLog, checkProgram, gameBuiltins, CompileError, BotRuntimeError };
