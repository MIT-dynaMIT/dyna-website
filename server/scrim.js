/**
 * scrim — the continuously-running heads-up ladder. Every tick it samples 2
 * submitted bots (favoring the least-played), plays a full 1v1 game of the
 * two-player Ultimate variant, updates ELO, and records the match.
 *
 * ELO: classic 1v1, K = 24.
 */
'use strict';

const { ScriptBot } = require('./botapi');
const { playBotGame } = require('./runner');

const K = 24;

class ScrimServer {
  constructor(store) {
    this.store = store;
    this._programs = new Map(); // submissionId → {key, bot}
    this._timer = null;
    this.lastError = null;
  }

  _botFor(sub) {
    const key = sub.source.length + ':' + sub.createdAt;
    const hit = this._programs.get(sub.id);
    if (hit && hit.key === key) { hit.bot.errors.length = 0; return hit.bot; }
    try {
      const bot = new ScriptBot(sub.source, sub.name);
      this._programs.set(sub.id, { key, bot });
      return bot;
    } catch (err) {
      return null; // does not compile (shouldn't happen: validated at submit)
    }
  }

  /** weighted sample without replacement, favoring fewer games */
  _sample(subs, n, rand = Math.random) {
    const pool = [...subs];
    const out = [];
    while (out.length < n && pool.length) {
      const weights = pool.map((s) => 1 / (1 + s.games * 0.02));
      const total = weights.reduce((a, b) => a + b, 0);
      let r = rand() * total;
      let i = 0;
      while (i < pool.length - 1 && (r -= weights[i]) > 0) i++;
      out.push(pool.splice(i, 1)[0]);
    }
    return out;
  }

  playOne(seed = (Math.random() * 2 ** 31) | 0) {
    const subs = this.store.scrim.submissions;
    if (subs.length < 2) return null;
    const picked = this._sample(subs, 2);
    const bots = [];
    for (const sub of picked) {
      const bot = this._botFor(sub);
      if (!bot) return null;
      bots.push({ bot, name: sub.name, sub });
    }
    const scrimStats = {};
    for (const b of bots) scrimStats[b.name] = this.store.statsFor(b.sub);

    const result = playBotGame({ bots, seed, scrimStats });

    // per-bot in-game counts from the log
    const counts = {};
    for (const b of bots) counts[b.name] = { ch: 0, chW: 0, cl: 0, clC: 0 };
    const nameOf = (pid) => result.names[pid];
    const { ACTIONS } = require('./coup');
    for (const e of result.log) {
      if (e.t === 'action' && ACTIONS[e.action] && ACTIONS[e.action].role) counts[nameOf(e.player)].cl++;
      else if (e.t === 'block') counts[nameOf(e.player)].cl++;
      else if (e.t === 'challenge') {
        counts[nameOf(e.by)].ch++;
        if (!e.truthful) { counts[nameOf(e.by)].chW++; counts[nameOf(e.against)].clC++; }
      }
    }

    // elo: classic 1v1
    const winner = bots.find((b) => b.name === result.winnerName);
    const loser = bots.find((b) => b !== winner);
    const expected = 1 / (1 + 10 ** ((loser.sub.elo - winner.sub.elo) / 400));
    const gain = K * (1 - expected);
    const eloDelta = { [winner.name]: gain, [loser.name]: -gain };

    const perBot = {};
    for (const b of bots) {
      perBot[b.sub.id] = {
        win: b === winner,
        ...counts[b.name],
        errors: (result.errorsByBot[b.name] || []).length,
        eloDelta: eloDelta[b.name],
      };
    }
    const match = {
      seed: result.seed,
      seatNames: result.seatNames,
      subIds: bots.map((b) => b.sub.id),
      owners: bots.map((b) => b.sub.ownerName),
      decisions: result.decisions,
      winnerName: result.winnerName,
      eloDelta: Object.fromEntries(Object.entries(eloDelta).map(([k, v]) => [k, Math.round(v)])),
      turns: result.log.filter((e) => e.t === 'action').length,
      adjudicated: result.adjudicated,
    };
    this.store.recordScrimGame(match, perBot);
    return match;
  }

  start(intervalMs = 4000, gamesPerTick = 3) {
    this.stop();
    this._timer = setInterval(() => {
      if (!this.store.scrim.running) return;
      try {
        for (let i = 0; i < gamesPerTick; i++) this.playOne();
        this.lastError = null;
      } catch (err) {
        this.lastError = err.message;
        console.error('[scrim]', err);
      }
    }, intervalMs);
    if (this._timer.unref) this._timer.unref();
  }
  stop() { if (this._timer) clearInterval(this._timer); this._timer = null; }

  runMany(n, onProgress) {
    let played = 0;
    for (let i = 0; i < n; i++) {
      if (this.playOne(((i + 1) * 2654435761) % 2 ** 31)) played++;
      if (onProgress && i % 100 === 99) onProgress(i + 1);
    }
    return played;
  }
}

module.exports = { ScrimServer };
