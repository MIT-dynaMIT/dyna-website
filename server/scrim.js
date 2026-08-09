/**
 * scrim — the continuously-running heads-up ladder, SERIES EDITION.
 *
 * A ladder pairing is a 100-game MATCHUP (seats alternate every game), not a
 * single game: variance collapses, and bots get series memory — state.series
 * plus opponent.series_* aggregates earned during the matchup. Nothing about
 * past ladder results is fed to bots (that was scouting for free); within a
 * series, explore → exploit.
 *
 * ELO: one update per series on the score fraction (62-38 → S=0.62),
 * delta = K * (S - E) — the margin is real evidence, so it moves ratings.
 */
'use strict';

const { ScriptBot } = require('./botapi');
const { playSeries } = require('./runner');

const K = 64;
const SERIES_GAMES = Number(process.env.COUP_SERIES_GAMES || 100);

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

  /** weighted sample without replacement, favoring fewer series */
  _sample(subs, n, rand = Math.random) {
    const pool = [...subs];
    const out = [];
    while (out.length < n && pool.length) {
      const weights = pool.map((s) => 1 / (1 + s.games * 0.5));
      const total = weights.reduce((a, b) => a + b, 0);
      let r = rand() * total;
      let i = 0;
      while (i < pool.length - 1 && (r -= weights[i]) > 0) i++;
      out.push(pool.splice(i, 1)[0]);
    }
    return out;
  }

  /** play one full 100-game matchup between two sampled submissions */
  playOne(seedBase = (Math.random() * 2 ** 31) | 0) {
    const subs = this.store.scrim.submissions;
    if (subs.length < 2) return null;
    const [sa, sb] = this._sample(subs, 2);
    const botA = this._botFor(sa);
    const botB = this._botFor(sb);
    if (!botA || !botB) return null;

    const r = playSeries({
      botA: { bot: botA, name: sa.name },
      botB: { bot: botB, name: sb.name },
      total: SERIES_GAMES, seedBase,
    });

    const winsA = r.winsByName[sa.name];
    const score = winsA / SERIES_GAMES;                       // A's score fraction
    const expected = 1 / (1 + 10 ** ((sb.elo - sa.elo) / 400));
    const delta = K * (score - expected);
    const eloDelta = { [sa.name]: delta, [sb.name]: -delta };

    const perBot = {
      [sa.id]: { win: score > 0.5, score, errors: r.errors[sa.name] || 0, eloDelta: delta },
      [sb.id]: { win: score < 0.5, score: 1 - score, errors: r.errors[sb.name] || 0, eloDelta: -delta },
    };
    const match = {
      series: true,
      gamesTotal: SERIES_GAMES,
      seed: seedBase,
      seatNames: [sa.name, sb.name],
      subIds: [sa.id, sb.id],
      owners: [sa.ownerName, sb.ownerName],
      score: { [sa.name]: winsA, [sb.name]: SERIES_GAMES - winsA },
      winStrip: r.winStrip,
      samples: r.samples,
      winnerName: score > 0.5 ? sa.name : sb.name,
      eloDelta: { [sa.name]: Math.round(delta), [sb.name]: Math.round(-delta) },
      turns: Math.round(r.turnsTotal / SERIES_GAMES),
      adjudicated: r.adjudicated,
    };
    this.store.recordScrimGame(match, perBot);
    return match;
  }

  start(intervalMs = 20000, seriesPerTick = 1) {
    this.stop();
    this._timer = setInterval(() => {
      if (!this.store.scrim.running) return;
      try {
        for (let i = 0; i < seriesPerTick; i++) this.playOne();
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
      if (onProgress && i % 10 === 9) onProgress(i + 1);
    }
    return played;
  }
}

module.exports = { ScrimServer, SERIES_GAMES };
