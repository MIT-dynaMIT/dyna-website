/**
 * seed — set up the camp: admin login, a dozen sample students with bots,
 * submit them all to the scrimmage ladder, and pre-play a pile of games so
 * the leaderboard is alive before anyone logs in.
 *
 *   node seed.js [games]        (default 1500; use --fresh to wipe data/)
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
const { BOTS, HOUSE } = require('./samplebots/bots');

const store = new Store(dataDir);
const scrim = new ScrimServer(store);

const ADMIN_PASS = process.env.ADMIN_PASS || 'dynamit';
const STUDENT_PASS = 'coup123';

// ------------------------------------------------------------ users + bots
function ensureUser(username, pass, displayName, isAdmin) {
  if (!store.users[username]) {
    const r = store.createUser(username, pass, displayName, isAdmin);
    if (r.error) throw new Error(`${username}: ${r.error}`);
  }
  return store.users[username];
}

const admin = ensureUser('admin', ADMIN_PASS, 'Organizer', true);
// the kid scaffold template lives in the organizer's last slot
{
  const { THE_SCAFFOLD } = require('./samplebots/bots');
  store.saveSlot(admin, 99, { name: 'The Scaffold', mode: 'python', python: THE_SCAFFOLD });
}

console.log('\nSeeding students + bots…');
const roster = [];
for (const b of BOTS) {
  const u = ensureUser(b.username, STUDENT_PASS, b.displayName, false);
  const check = checkProgram(b.source);
  if (!check.ok) {
    console.error(`  ✗ ${b.displayName}'s bot has problems:`, check.problems);
    process.exit(1);
  }
  store.saveSlot(u, 0, { name: b.botName, mode: 'python', python: b.source });
  if (!store.mySubmissions(u).length) {
    const r = store.submit(u, 0);
    if (r.error) throw new Error(r.error);
  }
  roster.push({ login: b.username, password: STUDENT_PASS, name: b.displayName, bot: b.botName });
  console.log(`  ✓ ${b.displayName} (${b.username}) — ${b.botName}`);
}
// the organizer's two ladder bots live in the first two slots
HOUSE.forEach((h, i) => {
  const slot = i;
  store.saveSlot(admin, slot, { name: h.name, mode: 'python', python: h.source });
  if (!store.scrim.submissions.some((s) => s.owner === 'admin' && s.slot === slot)) {
    const r = store.submit(admin, slot);
    if (r.error) throw new Error(r.error);
  }
  console.log(`  ✓ organizer bot — ${h.name} (slot ${slot + 1})`);
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
for (const r of roster) console.log(`  ${r.login.padEnd(10)} / ${r.password}   ${r.name}`);
console.log('');

store.flush();
