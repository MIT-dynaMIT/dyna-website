/**
 * runner — plays bot-vs-bot Coup games headlessly and records every decision,
 * so a match can be replayed later by re-running the ENGINE ONLY (no bot code,
 * no stats needed): same seed + same decision list = identical game.
 *
 * Decision records (in order):
 *   ['action', playerId, {type, target}]      ['challenge', challengerId|null]
 *   ['block', blockerId|null, role]           ['lose', playerId, cardIdx]
 *   ['exchange', playerId, [keepIdxs]]
 */
'use strict';

const { CoupGame } = require('./coup');
const { ScriptBot } = require('./botapi');

/** deterministic rng */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Play one full game between ScriptBots.
 *  bots       [{bot: ScriptBot, name}] — seat order
 *  seed       integer
 *  series     optional 100-game matchup memory {game, total, winsByName,
 *             statsByName} — passed into bot states as state.series / series_*
 * → {winnerName, seed, decisions, log, names, errorsByBot, adjudicated}
 */
function playBotGame({ bots, seed, series = null, gameOpts }) {
  // Two independent streams: the engine only ever draws from `rng`, bots from
  // `botRng`. Replay re-runs the engine alone, so its stream must not be
  // perturbed by however many random() calls the bots made in between.
  const rng = mulberry32(seed);
  const botRng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const ids = bots.map((_, i) => 'p' + i);
  const names = {};
  ids.forEach((id, i) => { names[id] = bots[i].name; });
  const botOf = {};
  ids.forEach((id, i) => { botOf[id] = bots[i].bot; });

  const game = new CoupGame(ids, rng, gameOpts || {});
  const decisions = [];
  let guard = 0;
  const MAX = 2000;

  while (!game.winner) {
    if (++guard > MAX) { game.adjudicate(); break; }
    const pend = game.pending;
    if (!pend) break;
    if (pend.type === 'action') {
      const id = pend.player;
      const act = botOf[id].yourTurn(game, id, names, series, botRng);
      decisions.push(['action', id, { type: act.type, call: act.call }]);
      // remember the assassin's auto-challenge probability for the contessa block
      game._assassinP = act.type === 'assassinate' ? (act.p || 0) : 0;
      game.submitAction(id, act);
    } else if (pend.type === 'challenge') {
      let challenger = null;
      // the "assassinate(target, p)" rider: the assassin challenges a Contessa
      // block with probability p, with priority
      if (pend.blocking && game.ctx && game.ctx.type === 'assassinate'
        && pend.claim.role === 'contessa' && pend.who.includes(game.ctx.actor)
        && (game._assassinP || 0) > 0 && botRng() < game._assassinP) {
        challenger = game.ctx.actor;
      }
      if (!challenger) {
        for (const id of pend.who) {
          if (id === game.ctx?.actor && pend.blocking && game.ctx.type === 'assassinate') continue; // already rolled
          const r = botOf[id].respond(game, id, names, series, botRng, 'challenge');
          if (r && r.challenge) { challenger = id; break; }
        }
      }
      decisions.push(['challenge', challenger]);
      game.resolveChallenge(challenger);
    } else if (pend.type === 'block') {
      let blocker = null, role = null;
      for (const id of pend.who) {
        let r;
        if (game.ctx.type === 'assassinate' && id === game.ctx.target) {
          const w = botOf[id].whenAssassinated(game, id, names, series, botRng);
          r = w.block ? { block: 'contessa' } : 'pass';
        } else {
          r = botOf[id].respond(game, id, names, series, botRng, 'block');
        }
        if (r && r.block) { blocker = id; role = r.block; break; }
      }
      decisions.push(['block', blocker, role]);
      game.resolveBlock(blocker, role);
    } else if (pend.type === 'lose') {
      const id = pend.player;
      const idx = botOf[id].chooseCardToLose(game, id, names, series, botRng);
      decisions.push(['lose', id, idx]);
      game.resolveLose(id, idx);
    } else if (pend.type === 'exchange') {
      const id = pend.player;
      const keep = botOf[id].chooseExchange(game, id, names, series, botRng);
      decisions.push(['exchange', id, keep]);
      game.resolveExchange(id, keep);
    } else {
      break;
    }
  }

  const errorsByBot = {};
  ids.forEach((id) => {
    const b = botOf[id];
    if (b.errors && b.errors.length) errorsByBot[names[id]] = b.errors.splice(0, b.errors.length);
  });
  return {
    winnerName: names[game.winner],
    seed,
    decisions,
    log: game.log,
    names,
    seatNames: ids.map((id) => names[id]),
    adjudicated: !!game.log.find((e) => e.t === 'win' && e.adjudicated),
    errorsByBot,
  };
}


/** Count one game's public log into a series stats accumulator. */
function accumulateSeriesStats(log, names, statsByName) {
  const { ACTIONS } = require('./coup');
  for (const e of log) {
    if (e.t === 'action' && ACTIONS[e.action] && ACTIONS[e.action].role) {
      statsByName[names[e.player]].claims++;
    } else if (e.t === 'block') {
      statsByName[names[e.player]].claims++;
      if (e.role === 'contessa') statsByName[names[e.player]].contessaBlocks++;
    } else if (e.t === 'challenge') {
      statsByName[names[e.by]].challenges++;
      if (e.truthful) statsByName[names[e.against]].proofs++;
      else statsByName[names[e.against]].caught++;
    }
  }
}

/**
 * A MATCHUP, as a generator: `total` games between two bots, seats
 * alternating, with series memory (score + behavioral aggregates) fed to both
 * bots each game. Yields every `chunk` games so a caller that shares a thread
 * with an HTTP server can hand the event loop back between batches; the
 * return value is the finished series.
 *
 * Yielding changes scheduling only — every game is seeded from `seedBase`
 * alone, so draining this at any chunk size gives bit-identical results.
 *
 * → { winsByName, statsByName, winStrip (A's perspective), samples, errors,
 *     turnsTotal, adjudicated }
 */
function* playSeriesIter({ botA, botB, total = 100, seedBase = 1, gameOpts, sampleAt = null, chunk = 5 }) {
  const winsByName = { [botA.name]: 0, [botB.name]: 0 };
  const statsByName = {
    [botA.name]: { challenges: 0, claims: 0, caught: 0, proofs: 0, contessaBlocks: 0 },
    [botB.name]: { challenges: 0, claims: 0, caught: 0, proofs: 0, contessaBlocks: 0 },
  };
  const samples = [];
  const sampleIdx = new Set(sampleAt || [0, Math.floor(total / 2), total - 1]);
  const errors = {};
  let winStrip = '';
  let turnsTotal = 0, adjudicated = 0;
  for (let g = 0; g < total; g++) {
    const seats = g % 2 === 0 ? [botA, botB] : [botB, botA];
    const seed = (seedBase + g * 7919) >>> 0;
    const r = playBotGame({
      bots: seats, seed, gameOpts,
      series: { game: g + 1, total, winsByName, statsByName },
    });
    winsByName[r.winnerName]++;
    winStrip += r.winnerName === botA.name ? '1' : '0';
    turnsTotal += r.log.filter((e) => e.t === 'action').length;
    if (r.adjudicated) adjudicated++;
    accumulateSeriesStats(r.log, r.names, statsByName);
    for (const [n, errs] of Object.entries(r.errorsByBot)) {
      errors[n] = (errors[n] || 0) + errs.length;
    }
    if (sampleIdx.has(g)) {
      samples.push({ g: g + 1, seed, seatNames: r.seatNames, decisions: r.decisions, winnerName: r.winnerName });
    }
    if (chunk > 0 && (g + 1) % chunk === 0 && g + 1 < total) yield g + 1;
  }
  return { winsByName, statsByName, winStrip, samples, errors, turnsTotal, adjudicated, total };
}

/** Drain a matchup in one go — for seeding and any offline batch run. */
function playSeries(opts) {
  const it = playSeriesIter(opts);
  let step = it.next();
  while (!step.done) step = it.next();
  return step.value;
}

/**
 * Re-simulate a recorded match into replay frames.
 * Each frame: {log: <the entry>, view: god-view snapshot AFTER that entry}.
 */
function replayMatch({ seed, seatNames, decisions }) {
  const rng = mulberry32(seed);
  const ids = seatNames.map((_, i) => 'p' + i);
  const game = new CoupGame(ids, rng);
  const frames = [];
  let logIdx = 0;
  const snap = () => {
    while (logIdx < game.log.length) {
      frames.push({ log: game.log[logIdx], view: game.view('god') });
      logIdx++;
    }
  };
  snap();
  for (const d of decisions) {
    const [kind, a, b] = d;
    try {
      if (kind === 'action') game.submitAction(a, b);
      else if (kind === 'challenge') game.resolveChallenge(a);
      else if (kind === 'block') game.resolveBlock(a, b);
      else if (kind === 'lose') game.resolveLose(a, b);
      else if (kind === 'exchange') game.resolveExchange(a, b);
    } catch (err) {
      break; // corrupted record — show what we have
    }
    snap();
  }
  if (!game.winner && !frames.some((f) => f.log.t === 'win')) {
    game.adjudicate();
    snap();
  }
  return { frames, seatNames, winnerName: game.winner ? seatNames[ids.indexOf(game.winner)] : null };
}

module.exports = { playBotGame, playSeries, playSeriesIter, replayMatch, mulberry32 };
