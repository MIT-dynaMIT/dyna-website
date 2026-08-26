/**
 * seed — set up the camp: the admin login, real camper/mentor logins from
 * roster.csv (if present), the house bots in the organizer's slots,
 * and one demo best-of-5 so Match History isn't empty on day one.
 *
 *   node seed.js              (use --fresh to wipe data/)
 *
 * roster.csv lives next to this file (NOT in data/, so --fresh keeps it and
 * NOT in git — it holds plaintext passwords). Columns:
 *   username,password,displayName,role      role = student | mentor
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
if (args.includes('--fresh')) fs.rmSync(dataDir, { recursive: true, force: true });

const { Store } = require('./store');
const { checkProgram, ScriptBot } = require('./botapi');
const { playSeries, replayMatch } = require('./runner');
const { SERIES_COUNT, SERIES_GAMES } = require('./arena');
const { HOUSE, THE_SCAFFOLD } = require('./samplebots/bots');

const store = new Store(dataDir);
const ADMIN_PASS = process.env.ADMIN_PASS || 'dynamit';

// ------------------------------------------------------------ users
function ensureUser(username, pass, displayName, isAdmin, role) {
  if (!store.users[username]) {
    const r = store.createUser(username, pass, displayName, isAdmin, role);
    if (r.error) throw new Error(`${username}: ${r.error}`);
  }
  return store.users[username];
}

const admin = ensureUser('admin', ADMIN_PASS, 'Organizer', true);
store.saveSlot(admin, 99, { name: 'The Scaffold', mode: 'python', python: THE_SCAFFOLD });

// local default; on Render this points at the Secret File (/etc/secrets/roster.csv)
const rosterPath = process.env.ROSTER_PATH || path.join(__dirname, 'roster.csv');
let rosterCount = 0;
if (fs.existsSync(rosterPath)) {
  const rows = fs.readFileSync(rosterPath, 'utf8').trim().split(/\r?\n/).slice(1);
  for (const row of rows) {
    if (!row.trim()) continue;
    const [username, password, displayName, role] = row.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    if (!username || !password) continue;
    ensureUser(username, password, displayName || username, false, role);
    rosterCount++;
  }
  console.log(`\n  ✓ ${rosterCount} camp logins from roster.csv`);
} else {
  console.log('\n  (no roster.csv — only the admin login exists; see server/roster.csv)');
}

// ------------------------------------------------------------ house bots
console.log('\nChecking house bots…');
HOUSE.forEach((h, i) => {
  const check = checkProgram(h.source);
  if (!check.ok) {
    console.error(`  ✗ ${h.name} has problems:`, check.problems);
    process.exit(1);
  }
  store.saveSlot(admin, i, { name: h.name, mode: 'python', python: h.source });
  console.log(`  ✓ level ${i + 1} — ${h.name}`);
});

// ------------------------------------------------------------ demo match
if (!store.matches.list.length) {
  // the demo is the FINAL boss against the one below it — indexes shift every
  // time a level is inserted, so take them from the end, not by position
  const top = HOUSE[HOUSE.length - 1];
  const mid = HOUSE[HOUSE.length - 2];
  console.log(`\nPlaying a demo best-of-${SERIES_COUNT}: ${top.name} vs ${mid.name}…`);
  const botA = { bot: new ScriptBot(top.source, top.name), name: top.name };
  const botB = { bot: new ScriptBot(mid.source, mid.name), name: mid.name };
  const series = [];
  let winsA = 0, winsB = 0;
  for (let i = 0; i < SERIES_COUNT; i++) {
    const sb = (20260815 + i * 104729) >>> 0;
    const r = playSeries({ botA, botB, total: SERIES_GAMES, seedBase: sb, sampleAt: [0, 49, 99] });
    const wA = r.winsByName[top.name], wB = r.winsByName[mid.name];
    series.push({ winsA: wA, winsB: wB, winStrip: r.winStrip, seedBase: sb, samples: r.samples });
    if (wA > wB) winsA++; else if (wB > wA) winsB++;
    console.log(`  series ${i + 1}: ${wA}–${wB}`);
  }
  const demo = store.addMatch({
    mode: 'botduel', level: null,
    players: [top.name, mid.name], owners: ['house', 'house'], ownerNames: ['The House', 'The House'],
    score: [winsA, winsB],
    winnerName: winsA > winsB ? top.name : winsB > winsA ? mid.name : null,
    gamesPerSeries: SERIES_GAMES, series,
    sources: [top.source, mid.source], errors: {},
  });
  // sanity: a stored sample must replay to the same winner
  const sample = demo.series[0].samples[0];
  const rep = replayMatch(sample);
  if (rep.winnerName !== sample.winnerName) {
    console.error(`  ✗ REPLAY MISMATCH: recorded ${sample.winnerName}, replayed ${rep.winnerName}`);
    process.exit(1);
  }
  console.log(`  ✓ match ${winsA}–${winsB}, replay determinism check passed (${rep.frames.length} frames)`);
}

// ------------------------------------------------------------ report
console.log('\n=== LOGINS ===');
console.log(`  admin / ${ADMIN_PASS}   (organizer console)`);
console.log(rosterCount
  ? `  + ${rosterCount} camp logins — usernames and passwords in server/roster.csv`
  : '  (no camp logins yet)');
console.log('');

store.flush();
