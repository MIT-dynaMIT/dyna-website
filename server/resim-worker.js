/**
 * resim-worker — deterministically re-deals ONE series of a recorded match
 * (same sources, same seedBase → bit-identical games) and returns every
 * game's decision list, so the replay page can browse all 100 games.
 */
'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const { ScriptBot } = require('./botapi');
const { playSeries } = require('./runner');

const { a, b, total, seedBase } = workerData;

try {
  const r = playSeries({
    botA: { bot: new ScriptBot(a.source, a.name), name: a.name },
    botB: { bot: new ScriptBot(b.source, b.name), name: b.name },
    total, seedBase,
    sampleAt: Array.from({ length: total }, (_, i) => i),   // keep every game
  });
  parentPort.postMessage({ ok: true, samples: r.samples, winStrip: r.winStrip });
} catch (err) {
  parentPort.postMessage({ ok: false, error: err.message });
}
