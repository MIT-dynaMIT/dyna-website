/**
 * seed — set up the camp: the admin login, real camper/mentor logins from
 * roster.csv (if present), the three graded house bots on the ladder, and a
 * pile of pre-played series so the leaderboard is alive before anyone logs in.
 *
 *   node seed.js [series]       (default 60; use --fresh to wipe data/)
 *
 * roster.csv lives next to this file (NOT in data/, so --fresh keeps it and
 * NOT in git — it holds plaintext passwords). Columns:
 *   username,password,displayName,role      role = student | mentor
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const GAMES = Number(args.find((a) => /^\d+$/.test(a))) || 60;   // series, not games
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
if (args.includes('--fresh')) fs.rmSync(dataDir, { recursive: true, force: true });

const { Store } = require('./store');
const { ScrimServer } = require('./scrim');
const { checkProgram } = require('./botapi');
const { replayMatch } = require('./runner');
const { HOUSE, THE_SCAFFOLD } = require('./samplebots/bots');

const store = new Store(dataDir);
const scrim = new ScrimServer(store);

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
// the kid scaffold template lives in the organizer's last slot
store.saveSlot(admin, 99, { name: 'The Scaffold', mode: 'python', python: THE_SCAFFOLD });

// real camp logins — generated from the camp spreadsheet
const rosterPath = path.join(__dirname, 'roster.csv');
let rosterCount = 0;
if (fs.existsSync(rosterPath)) {
  const rows = fs.readFileSync(rosterPath, 'utf8').trim().split('\n').slice(1);
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
console.log('\nSeeding house bots…');
HOUSE.forEach((h, i) => {
  const check = checkProgram(h.source);
  if (!check.ok) {
    console.error(`  ✗ ${h.name} has problems:`, check.problems);
    process.exit(1);
  }
  store.saveSlot(admin, i, { name: h.name, mode: 'python', python: h.source });
  if (!store.scrim.submissions.some((s) => s.owner === 'admin' && s.slot === i)) {
    const r = store.submit(admin, i);
    if (r.error) throw new Error(r.error);
  }
  console.log(`  ✓ house bot — ${h.name} (slot ${i + 1})`);
});

// ------------------------------------------------------------ warm the ladder
console.log(`\nPlaying ${GAMES} scrim series (${GAMES * 100} games)…`);
const t0 = Date.now();
const played = scrim.runMany(GAMES, (n) => {
  console.log(`  …${n} series (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
});
console.log(`  done: ${played}/${GAMES} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// sanity: a stored sample game must replay to the same winner
const series = store.matches.list[store.matches.list.length - 1];
const g0 = series.samples[0];
const rep = replayMatch(g0);
if (rep.winnerName !== g0.winnerName) {
  console.error(`  ✗ REPLAY MISMATCH: recorded ${g0.winnerName}, replayed ${rep.winnerName}`);
  process.exit(1);
}
console.log(`  ✓ replay determinism check passed (series game ${g0.g}, ${rep.frames.length} frames)`);

// ------------------------------------------------------------ report
console.log('\n=== LEADERBOARD ===');
for (const row of store.leaderboard()) {
  console.log(
    `  ${String(row.rank).padStart(2)}. ${row.name.padEnd(16)} ${String(row.elo).padStart(5)}` +
    `  games ${String(row.games).padStart(4)}  wr ${(row.winRate * 100).toFixed(0).padStart(3)}%` +
    `  (${row.isHouse ? 'house' : row.owner})`);
}
const errTotal = store.scrim.submissions.reduce((a, s) => a + s.errors, 0);
console.log(`\n  bot runtime errors across all games: ${errTotal}`);

console.log('\n=== LOGINS ===');
console.log(`  admin / ${ADMIN_PASS}   (organizer console)`);
console.log(rosterCount
  ? `  + ${rosterCount} camp logins — usernames and passwords in server/roster.csv`
  : '  (no camp logins yet)');
console.log('');

store.flush();
