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
const { Arena, SERIES_COUNT, SERIES_GAMES } = require('./arena');
const { PlayManager } = require('./play');
const { LiveManager } = require('./live');
const { ScriptBot, checkProgram } = require('./botapi');
const { replayMatch } = require('./runner');
const { HOUSE } = require('./samplebots/bots');

const PORT = Number(process.env.PORT || 8787);
const store = new Store(process.env.DATA_DIR || path.join(__dirname, 'data'));
const arena = new Arena(store);
const plays = new PlayManager();
const live = new LiveManager(store);

// resolve the user's SELECTED BOT into a compiling fighter, or an error
function fighterFor(user) {
  const sel = store.selectedBot(user);
  if (sel.error) return sel;
  const check = checkProgram(sel.source);
  if (!check.ok) return { error: `"${sel.name}" has problems — run Check in the editor first` };
  return { owner: user.username, ownerName: user.displayName, name: sel.name, source: sel.source };
}

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
  res.json({
    slots: store.getSlots(req.user),
    slotCount: store.slotCount(req.user),
    selectedSlot: store.selectedSlot(req.user),
  });
});

// NB: registered before /bots/:idx so "selected" isn't parsed as a slot index
app.put('/api/coup/bots/selected', auth, (req, res) => {
  const r = store.setSelectedSlot(req.user, Number(req.body.slot));
  if (r.error) return res.status(400).json(r);
  res.json(r);
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

// ------------------------------------------------------------ the gauntlet
// challenge one of the three house levels with your selected bot:
// best of 5, where each of the 5 is a 100-game series
app.get('/api/coup/gauntlet', auth, (req, res) => {
  const sel = store.selectedBot(req.user);
  res.json({
    levels: HOUSE.map((h, i) => ({ level: i, name: h.name })),
    seriesCount: SERIES_COUNT,
    seriesGames: SERIES_GAMES,
    selected: sel.error ? null : { slot: sel.slot, name: sel.name },
    pending: arena.pendingFor(req.user.username),
  });
});

app.post('/api/coup/gauntlet/challenge', auth, (req, res) => {
  const level = Number(req.body.level);
  const house = HOUSE[level];
  if (!house) return res.status(400).json({ error: 'no such level' });
  const me = fighterFor(req.user);
  if (me.error) return res.status(400).json(me);
  const r = arena.enqueue({
    mode: 'gauntlet', level,
    a: me,
    b: { owner: 'house', ownerName: 'The House', name: house.name, source: house.source },
  });
  if (r.error) return res.status(400).json(r);
  res.json({ ok: true, job: r.job });
});

// ------------------------------------------------------------ match history
app.get('/api/coup/matches', auth, (req, res) => {
  const rows = store.matchesFor(req.user).map((m) => ({
    id: m.id, ts: m.ts, mode: m.mode, level: m.level,
    players: m.players, owners: m.owners, ownerNames: m.ownerNames,
    score: m.score, winnerName: m.winnerName,
    gamesPerSeries: m.gamesPerSeries,
    series: m.series.map((s) => ({ winsA: s.winsA, winsB: s.winsB })),
    mine: m.owners.indexOf(req.user.username),
  }));
  res.json({ matches: rows, pending: arena.pendingFor(req.user.username) });
});

// ?series=i&sample=j → replay sample j of series i (both 0-based)
app.get('/api/coup/matches/:id/replay', auth, (req, res) => {
  const m = store.getMatch(req.params.id);
  if (!m) return res.status(404).json({ error: 'match not found (older matches are pruned)' });
  const si = Math.max(0, Math.min(m.series.length - 1, Number(req.query.series) || 0));
  const ser = m.series[si];
  const samples = ser.samples || [];
  const gi = Math.max(0, Math.min(samples.length - 1, Number(req.query.sample) || 0));
  const sample = samples[gi];
  if (!sample) return res.status(404).json({ error: 'no replayable games stored for this series' });
  const r = replayMatch(sample);
  res.json({
    frames: r.frames, seatNames: sample.seatNames, owners: m.owners,
    winnerName: sample.winnerName, ts: m.ts,
    match: {
      mode: m.mode, level: m.level, players: m.players, ownerNames: m.ownerNames,
      score: m.score, matchWinner: m.winnerName, gamesPerSeries: m.gamesPerSeries,
      seriesIndex: si, seriesScores: m.series.map((s) => [s.winsA, s.winsB]),
      winStrip: ser.winStrip,
      samples: samples.map((s) => s.g), sampleIndex: gi, game: sample.g,
    },
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
  const kind = req.body.kind === 'bots' ? 'bots' : 'duel';
  if (kind === 'bots') {
    const me = fighterFor(req.user);
    if (me.error) return res.status(400).json(me);
  }
  const r = live.challenge(req.user, req.body.to, kind);
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

app.post('/api/coup/live/respond', auth, (req, res) => {
  const r = live.respondInvite(req.user, !!req.body.accept);
  if (r.error) return res.status(400).json(r);
  if (r.bots && req.body.accept) {
    // a bot battle: both sides' selected bots into the arena, no live table
    const me = fighterFor(req.user);
    const them = fighterFor(store.users[r.from]);
    if (me.error) return res.status(400).json(me);
    if (them.error) return res.status(400).json({ error: `${store.users[r.from].displayName}: ${them.error}` });
    const q = arena.enqueue({ mode: 'botduel', a: them, b: me });
    if (q.error) return res.status(400).json(q);
    return res.json({ ok: true, bots: true, job: q.job });
  }
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
    totalMatches: store.matches.list.length,
    students: Object.values(store.users).map((u) => {
      const sel = store.selectedBot(u);
      return {
        username: u.username, displayName: u.displayName, isAdmin: !!u.isAdmin,
        role: u.role || 'student',
        slotsUsed: (store.bots[u.username] || []).filter(Boolean).length,
        selectedBot: sel.error ? null : sel.name,
      };
    }),
  });
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

// pair every online student's SELECTED BOT into a random best-of-5 bot battle
app.post('/api/coup/admin/pair-bots', auth, adminOnly, (req, res) => {
  const pool = [];
  const skipped = [];
  for (const o of live.onlineUsers(null)) {
    if (o.role !== 'student') continue;
    const f = fighterFor(store.users[o.username]);
    if (f.error) skipped.push(o.displayName);
    else pool.push(f);
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  let matches = 0;
  for (let i = 0; i + 1 < pool.length; i += 2) {
    const r = arena.enqueue({ mode: 'botduel', a: pool[i], b: pool[i + 1] });
    if (!r.error) matches++;
  }
  res.json({
    matches, paired: matches * 2,
    benched: pool.length % 2 ? pool[pool.length - 1].ownerName : null,
    skipped,
  });
});

// SPA fallback for /coup/* deep links in production mode
app.get(/^\/(?!api\/).*/, (req, res, next) => {
  res.sendFile(path.join(dist, 'index.html'), (err) => { if (err) next(); });
});

// ------------------------------------------------------------ boot
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  🎭 dynaCOUP camp server → http://localhost:${PORT}`);
    console.log(`     ${Object.keys(store.users).length} logins, ${store.matches.list.length} recorded matches\n`);
  });
  process.on('SIGINT', () => { store.flush(); process.exit(0); });
  process.on('SIGTERM', () => { store.flush(); process.exit(0); });
}

module.exports = { app, store, arena };
