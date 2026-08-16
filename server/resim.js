/**
 * resim — on-demand series re-simulation with a small cache. First request
 * for a series re-deals all its games in a worker (~2-3s); after that every
 * game of that series replays instantly.
 */
'use strict';

const path = require('node:path');
const { Worker } = require('node:worker_threads');

const CACHE_MAX = 8;   // ~0.5-1MB per cached series

class Resim {
  constructor() {
    this.cache = new Map();      // key -> samples[]  (Map preserves LRU order)
    this.inflight = new Map();   // key -> Promise
  }

  /** all games of series `si` of `match` — [{g, seed, seatNames, decisions, winnerName}] */
  seriesGames(match, si) {
    const ser = match.series[si];
    if (!ser || !match.sources || ser.seedBase == null) {
      return Promise.reject(new Error('this match predates the game browser — only sampled games are stored'));
    }
    const key = `${match.id}:${si}`;
    if (this.cache.has(key)) {
      const v = this.cache.get(key);
      this.cache.delete(key); this.cache.set(key, v);   // LRU bump
      return Promise.resolve(v);
    }
    if (this.inflight.has(key)) return this.inflight.get(key);
    const p = new Promise((resolve, reject) => {
      const worker = new Worker(path.join(__dirname, 'resim-worker.js'), {
        workerData: {
          a: { name: match.players[0], source: match.sources[0] },
          b: { name: match.players[1], source: match.sources[1] },
          total: match.gamesPerSeries, seedBase: ser.seedBase,
        },
      });
      worker.once('message', (r) => {
        if (!r.ok) return reject(new Error(r.error));
        // determinism guard: the re-deal must reproduce the recorded strip
        if (r.winStrip !== ser.winStrip) {
          return reject(new Error('re-deal mismatch — the bots or engine changed since this match was played'));
        }
        this.cache.set(key, r.samples);
        while (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value);
        resolve(r.samples);
      });
      worker.once('error', (err) => reject(err));
    }).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }
}

module.exports = { Resim };
