/**
 * arena-worker — plays one best-of-5 bot match (5 series × 100 games) off the
 * main thread, so gauntlet runs and bot battles never stall live duels.
 */
'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const { ScriptBot } = require('./botapi');
const { playSeries } = require('./runner');

const { a, b, seedBase, seriesCount, seriesGames, sampleAt } = workerData;

try {
  const botA = { bot: new ScriptBot(a.source, a.name), name: a.name };
  const botB = { bot: new ScriptBot(b.source, b.name), name: b.name };
  const series = [];
  let winsA = 0, winsB = 0;
  const errors = { [a.name]: 0, [b.name]: 0 };
  for (let i = 0; i < seriesCount; i++) {
    const r = playSeries({ botA, botB, total: seriesGames, seedBase: (seedBase + i * 104729) >>> 0, sampleAt });
    const wA = r.winsByName[a.name] || 0;
    const wB = r.winsByName[b.name] || 0;
    series.push({ winsA: wA, winsB: wB, winStrip: r.winStrip, samples: r.samples });
    if (wA > wB) winsA++;
    else if (wB > wA) winsB++;
    errors[a.name] += r.errors[a.name] || 0;
    errors[b.name] += r.errors[b.name] || 0;
  }
  parentPort.postMessage({ ok: true, series, score: [winsA, winsB], errors });
} catch (err) {
  parentPort.postMessage({ ok: false, error: err.message });
}
