/**
 * dynaCOUP camp server — API behind the dynaMIT website's /coup pages.
 *
 *   node index.js            → http://localhost:8787  (Vite proxies /api here)
 *   node seed.js             → create logins + sample bots + warm up the ladder
 *
 * Everything lives under /api/coup/*. Auth is a Bearer token from /login;
 * accounts are pre-created (no signup) — students get their logins on paper.
 */
'use strict';

const path = require('node:path');
const express = require('express');

const { Store } = require('./store');
const { ScrimServer } = require('./scrim');
const { PlayManager } = require('./play');
const { LiveManager } = require('./live');
const { ScriptBot, checkProgram } = require('./botapi');
const { replayMatch } = require('./runner');
const { HOUSE } = require('./samplebots/bots');

const PORT = Number(process.env.PORT || 8787);
const store = new Store(process.env.DATA_DIR || path.join(__dirname, 'data'));
const scrim = new ScrimServer(store);
const plays = new PlayManager();
const live = new LiveManager(store);

const app = express();
app.use(express.json({ limit: '1mb' }));

// serve the built website too, if it exists (production single-process mode)
const dist = path.join(__dirname, '..', 'dist');
app.use(express.static(dist));

// ------------------------------------------------------------ auth plumbing
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const user = store.getSessionUser(token);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  req.user = user;
  next();
}
function adminOnly(req, res, next) {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'Organizers only' });
  next();
}
const pub = (u) => ({ username: u.username, displayName: u.displayName, isAdmin: !!u.isAdmin });

app.post('/api/coup/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = store.checkLogin(username, password);
  if (!user) return res.status(401).json({ error: 'Wrong username or password' });
  res.json({ token: store.createSession(user.username), user: pub(user) });
});

app.get('/api/coup/me', auth, (req, res) => res.json({ user: pub(req.user) }));

// ------------------------------------------------------------ bot slots
app.get('/api/coup/bots', auth, (req, res) => {
  res.json({ slots: store.getSlots(req.user), slotCount: store.slotCount(req.user) });
});

app.put('/api/coup/bots/:idx', auth, (req, res) => {
  const r = store.saveSlot(req.user, Number(req.params.idx), req.body || {});
  if (r.conflict) return res.status(409).json({ error: 'this slot was changed elsewhere — reloading it', slot: r.slot });
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

app.post('/api/coup/check', auth, (req, res) => {
  res.json(checkProgram(String(req.body.python || '')));
});

// parse botlang into its AST — powers the editor's python→blocks decompiler
app.post('/api/coup/parse', auth, (req, res) => {
  try {
    const { compile } = require('./botlang');
    const program = compile(String(req.body.python || ''));
    res.json({ ok: true, ast: program.ast });
  } catch (err) {
    res.json({ ok: false, error: err.message, line: err.line });
  }
});

// ------------------------------------------------------------ scrimmage
app.get('/api/coup/scrim', auth, (req, res) => {
  const board = store.leaderboard();
  const mine = store.mySubmissions(req.user).map((s) => ({
    id: s.id, name: s.name, slot: s.slot, elo: Math.round(s.elo), games: s.games,
    winRate: s.last.length ? s.last.reduce((a, x) => a + x, 0) / s.last.length : 0,
    lastN: s.last.length, errors: s.errors,
    rank: board.findIndex((b) => b.id === s.id) + 1,
  }));
  res.json({
    top: board.slice(0, 10),
    totalBots: board.length,
    totalGames: store.scrim.totalGames,
    running: !!store.scrim.running,
    mine,
  });
});

app.post('/api/coup/scrim/submit', auth, (req, res) => {
  const idx = Number(req.body.slot);
  const slots = store.getSlots(req.user);
  const s = slots[idx];
  if (!s || !s.python) return res.status(400).json({ error: 'that slot is empty' });
  const check = checkProgram(s.python);
  if (!check.ok) return res.status(400).json({ error: 'the bot has problems — run "Check my bot" in the editor first', problems: check.problems });
  const r = store.submit(req.user, idx);
  if (r.error) return res.status(400).json(r);
  res.json({ ok: true, unchanged: !!r.unchanged, submission: { id: r.submission.id, name: r.submission.name } });
});

app.post('/api/coup/scrim/withdraw', auth, (req, res) => {
  res.json({ ok: store.withdraw(req.user, String(req.body.id || '')) });
});

// ------------------------------------------------------------ match history
app.get('/api/coup/matches', auth, (req, res) => {
  const subId = req.query.sub || null;
  const mine = store.mySubmissions(req.user);
  const sub = subId ? mine.find((s) => s.id === subId) : mine[0];
  if (!sub) return res.json({ bot: null, matches: [] });
  const matches = sub.matchIds.map((id) => store.getMatch(id)).filter(Boolean).reverse().map((m) => ({
    id: m.id, ts: m.ts,
    myBot: sub.name,
    win: m.winnerName === sub.name,
    winnerName: m.winnerName,
    players: m.seatNames,
    owners: m.owners,
    eloDelta: m.eloDelta[sub.name] ?? 0,
    turns: m.turns,
    adjudicated: !!m.adjudicated,
    series: !!m.series,
    gamesTotal: m.gamesTotal,
    score: m.score,
    winStrip: m.winStrip,
    sampleGames: (m.samples || []).map((s) => s.g),
  }));
  res.json({
    bot: { id: sub.id, name: sub.name, elo: Math.round(sub.elo), games: sub.games },
    matches,
  });
});

app.get('/api/coup/matches/:id/replay', auth, (req, res) => {
  const m = store.getMatch(req.params.id);
  if (!m) return res.status(404).json({ error: 'match not found (older series are pruned)' });
  // a series stores a few sample games; ?sample=n picks one (default first)
  const samples = m.samples || [];
  const si = Math.max(0, Math.min(samples.length - 1, Number(req.query.sample) || 0));
  const sample = samples[si];
  if (!sample) return res.status(404).json({ error: 'no replayable games stored for this series' });
  const r = replayMatch(sample);
  res.json({
    frames: r.frames, seatNames: sample.seatNames, owners: m.owners,
    winnerName: sample.winnerName, eloDelta: m.eloDelta, ts: m.ts,
    series: { game: sample.g, gamesTotal: m.gamesTotal, score: m.score, winStrip: m.winStrip, samples: samples.map((s) => s.g), sampleIndex: si },
  });
});

// ------------------------------------------------------------ heads-up play
app.post('/api/coup/play/start', auth, (req, res) => {
  const picks = Array.isArray(req.body.opponents) ? req.body.opponents : [req.body.opponent];
  const pick = picks[0];
  const slots = store.getSlots(req.user);
  let source, name;
  if (pick != null && pick !== 'house' && slots[pick] && slots[pick].python) {
    source = slots[pick].python;
    name = slots[pick].name;
  } else {
    const h = typeof pick === 'string' && pick.startsWith('house:')
      ? HOUSE.find((x) => x.name === pick.slice(6)) || HOUSE[0]
      : HOUSE[0];
    source = h.source; name = h.name;
  }
  if (name === req.user.displayName) name += ' Ⅱ';
  let opponent;
  try {
    opponent = { bot: new ScriptBot(source, name), name };
  } catch (err) {
    return res.status(400).json({ error: `that bot does not compile: ${err.message}` });
  }
  const sess = plays.create(req.user.displayName, [opponent]);
  res.json(sess.snapshot(0));
});

// list of house opponents for the play setup screen
app.get('/api/coup/play/house-bots', auth, (_req, res) => {
  res.json({ bots: HOUSE.map((h) => h.name) });
});

app.get('/api/coup/play/:id', auth, (req, res) => {
  const sess = plays.get(req.params.id);
  if (!sess) return res.status(404).json({ error: 'no such game' });
  res.json(sess.snapshot(Number(req.query.cursor) || 0));
});

app.post('/api/coup/play/:id/move', auth, (req, res) => {
  const sess = plays.get(req.params.id);
  if (!sess) return res.status(404).json({ error: 'no such game' });
  const cursor = Number(req.body.cursor) || 0;
  try { sess.humanMove(req.body || {}); }
  catch (err) { return res.status(400).json({ error: err.message }); }
  res.json(sess.snapshot(cursor));
});

// ------------------------------------------------------------ live (human vs human)
// presence heartbeat + who's online + your invite/match — clients poll this
app.post('/api/coup/live/poll', auth, (req, res) => {
  res.json(live.poll(req.user));
});

app.post('/api/coup/live/challenge', auth, (req, res) => {
  const r = live.challenge(req.user, req.body.to);
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

app.post('/api/coup/live/respond', auth, (req, res) => {
  const r = live.respondInvite(req.user, !!req.body.accept);
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

app.post('/api/coup/live/leave', auth, (req, res) => {
  live.leave(req.user);
  res.json({ ok: true });
});

app.get('/api/coup/live/match/:id', auth, (req, res) => {
  const sess = live.get(req.params.id);
  if (!sess || !sess.seatOf[req.user.username]) return res.status(404).json({ error: 'no such duel' });
  res.json(sess.snapshot(req.user.username, Number(req.query.cursor) || 0));
});

app.post('/api/coup/live/match/:id/move', auth, (req, res) => {
  const sess = live.get(req.params.id);
  if (!sess || !sess.seatOf[req.user.username]) return res.status(404).json({ error: 'no such duel' });
  const cursor = Number(req.body.cursor) || 0;
  try { sess.move(req.user.username, req.body || {}); }
  catch (err) { return res.status(400).json({ error: err.message }); }
  res.json(sess.snapshot(req.user.username, cursor));
});

app.post('/api/coup/live/match/:id/forfeit', auth, (req, res) => {
  const sess = live.get(req.params.id);
  if (!sess || !sess.seatOf[req.user.username]) return res.status(404).json({ error: 'no such duel' });
  sess.forfeit(req.user.username);
  res.json(sess.snapshot(req.user.username, Number(req.body.cursor) || 0));
});

// ------------------------------------------------------------ admin
app.get('/api/coup/admin/overview', auth, adminOnly, (req, res) => {
  res.json({
    leaderboard: store.leaderboard(),
    totalGames: store.scrim.totalGames,
    running: !!store.scrim.running,
    // ladder health: the longest the scrim loop has held the event loop
    perf: { lastChunkMs: scrim.lastChunkMs, maxChunkMs: scrim.maxChunkMs, lastError: scrim.lastError },
    students: Object.values(store.users).filter((u) => u.username !== '__house').map((u) => ({
      username: u.username, displayName: u.displayName, isAdmin: !!u.isAdmin,
      slotsUsed: (store.bots[u.username] || []).filter(Boolean).length,
      submitted: store.scrim.submissions.filter((s) => s.owner === u.username).map((s) => s.name),
    })),
  });
});

app.post('/api/coup/admin/running', auth, adminOnly, (req, res) => {
  store.scrim.running = !!req.body.running;
  store._save('scrim.json', store.scrim);
  res.json({ ok: true, running: store.scrim.running });
});

app.post('/api/coup/admin/reset-password', auth, adminOnly, (req, res) => {
  const ok = store.resetPassword(req.body.username, req.body.newPassword || 'coup123');
  res.json(ok ? { ok: true } : { ok: false, error: 'no such user' });
});

app.post('/api/coup/admin/create-user', auth, adminOnly, (req, res) => {
  const r = store.createUser(req.body.username, req.body.password || 'coup123', req.body.displayName, false, req.body.role);
  if (r.error) return res.status(400).json(r);
  res.json({ ok: true, user: pub(r.user) });
});

// pair every online student into a random live duel
app.post('/api/coup/admin/pair-online', auth, adminOnly, (req, res) => {
  res.json(live.pairStudents());
});

// SPA fallback for /coup/* deep links in production mode
app.get(/^\/(?!api\/).*/, (req, res, next) => {
  res.sendFile(path.join(dist, 'index.html'), (err) => { if (err) next(); });
});

// ------------------------------------------------------------ boot
if (require.main === module) {
  scrim.start(4000, 3);
  app.listen(PORT, () => {
    console.log(`\n  🎭 dynaCOUP camp server → http://localhost:${PORT}`);
    console.log(`     scrims: ${store.scrim.submissions.length} bots in the pool, ${store.scrim.totalGames} games played\n`);
  });
  process.on('SIGINT', () => { store.flush(); process.exit(0); });
  process.on('SIGTERM', () => { store.flush(); process.exit(0); });
}

module.exports = { app, store, scrim };
