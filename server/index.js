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

const { AchievementBook } = require('./achievements');

const PORT = Number(process.env.PORT || 8787);
const store = new Store(process.env.DATA_DIR || path.join(__dirname, 'data'));
const book = new AchievementBook(store);
const arena = new Arena(store, book);
const plays = new PlayManager();
const live = new LiveManager(store);
const { Resim } = require('./resim');
const resim = new Resim();
const { MultiManager } = require('./multi');
const multi = new MultiManager(store);
const { LadderServer } = require('./ladder');
const ladder = new LadderServer(store, book);

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

// unauthenticated health probe — Render's health check + "is the API here?" pings
app.get('/api/coup/health', (_req, res) => {
  res.json({ ok: true, users: Object.keys(store.users).length });
});

app.post('/api/coup/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = store.checkLogin(username, password);
  if (!user) return res.status(401).json({ error: 'Wrong username or password' });
  if (user.deactivated) {
    return res.status(403).json({ error: 'That account has been retired — ask a mentor if you think this is a mistake.' });
  }
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
  // saving is where the code-craft awards get handed out
  try { book.fromSlots(req.user.username, store.getSlots(req.user)); }
  catch (err) { console.error('[achievements] save scan failed', err.message); }
  res.json(r);
});

app.post('/api/coup/check', auth, (req, res) => {
  const result = checkProgram(String(req.body.python || ''));
  try {
    book.fromCheck(req.user.username, result);
    book.countCheck(req.user.username);
  } catch (err) { console.error('[achievements] check failed', err.message); }
  res.json(result);
});

// ------------------------------------------------------------ achievements
app.get('/api/coup/achievements', auth, (req, res) => {
  // a first visit backfills whatever the saved bots already earn, so nobody
  // who built a bot before this page existed starts on zero
  try { book.fromSlots(req.user.username, store.getSlots(req.user)); }
  catch (err) { console.error('[achievements] backfill failed', err.message); }
  res.json(book.view(req.user.username));
});

// the client has shown these unlock toasts — stop re-sending them
app.post('/api/coup/achievements/ack', auth, (req, res) => {
  book.ack(req.user.username, Array.isArray(req.body.ids) ? req.body.ids.map(String) : []);
  res.json({ ok: true });
});

// a bufo got tickled — three are hidden around the app
app.post('/api/coup/achievements/bufo', auth, (req, res) => {
  const r = book.tickleBufo(req.user.username, String(req.body.id || ''));
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

// browser-only moments: scrolled to the bottom, saw every tab, up/downloaded
app.post('/api/coup/achievements/event', auth, (req, res) => {
  book.fromEvent(req.user.username, String(req.body.name || ''));
  res.json({ ok: true });
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
  // while the scrimmage is paused its matches are part of what stays hidden
  const visible = (ladder.running || req.user.isAdmin)
    ? store.matchesFor(req.user)
    : store.matchesFor(req.user).filter((m) => m.mode !== 'ladder');
  const rows = visible.map((m) => ({
    id: m.id, ts: m.ts, mode: m.mode, level: m.level,
    players: m.players, owners: m.owners, ownerNames: m.ownerNames,
    score: m.score, winnerName: m.winnerName,
    gamesPerSeries: m.gamesPerSeries,
    series: m.series.map((s) => ({ winsA: s.winsA, winsB: s.winsB })),
    mine: m.owners.indexOf(req.user.username),
  }));
  res.json({ matches: rows, pending: arena.pendingFor(req.user.username) });
});

// ?series=i&game=N → replay game N (1-based) of series i (0-based).
// Stored samples answer instantly; anything else re-deals the series in a
// worker (deterministic — same seed, same bots) and caches all 100 games.
app.get('/api/coup/matches/:id/replay', auth, async (req, res) => {
  const m = store.getMatch(req.params.id);
  if (!m) return res.status(404).json({ error: 'match not found (older matches are pruned)' });
  // no peeking at scrimmage replays by link while it is paused
  if (m.mode === 'ladder' && !ladder.running && !req.user.isAdmin) {
    return res.status(404).json({ error: 'match not found (older matches are pruned)' });
  }
  const si = Math.max(0, Math.min(m.series.length - 1, Number(req.query.series) || 0));
  const ser = m.series[si];
  const samples = ser.samples || [];
  const browsable = !!m.sources && ser.seedBase != null;
  const g = Math.max(1, Math.min(m.gamesPerSeries, Number(req.query.game) || (samples[0] ? samples[0].g : 1)));
  let sample = samples.find((s) => s.g === g);
  if (!sample) {
    if (!browsable) return res.status(404).json({ error: 'only games ' + samples.map((s) => s.g).join(', ') + ' are stored for this match' });
    try {
      const all = await resim.seriesGames(m, si);
      sample = all[g - 1];
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
  const r = replayMatch(sample);
  res.json({
    frames: r.frames, seatNames: sample.seatNames, owners: m.owners,
    winnerName: sample.winnerName, ts: m.ts,
    match: {
      mode: m.mode, level: m.level, players: m.players, ownerNames: m.ownerNames,
      score: m.score, matchWinner: m.winnerName, gamesPerSeries: m.gamesPerSeries,
      seriesIndex: si, seriesScores: m.series.map((s) => [s.winsA, s.winsB]),
      winStrip: ser.winStrip,
      browsable, samples: samples.map((s) => s.g), game: g,
    },
  });
});

// ------------------------------------------------------------ heads-up play
app.post('/api/coup/play/start', auth, (req, res) => {
  const picks = Array.isArray(req.body.opponents) ? req.body.opponents : [req.body.opponent];
  const pick = picks[0];
  const slots = store.getSlots(req.user);
  let source, name;
  let vsOwnBot = false;
  if (pick != null && pick !== 'house' && slots[pick] && slots[pick].python) {
    source = slots[pick].python;
    name = slots[pick].name;
    vsOwnBot = true;
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
  const sess = plays.create(req.user.displayName, [opponent],
    { username: req.user.username, vsOwnBot });
  book.unlock(req.user.username, 'table_first');
  res.json(sess.snapshot(0));
});

/** award a finished table game to the human who was sitting at it */
function awardTable(user, ctx) {
  try { book.fromTable(user.username, ctx); }
  catch (err) { console.error('[achievements] table failed', err.message); }
}

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
  awardTable(req.user, {
    kind: 'play',
    won: !!sess.game.winner && sess.game.winner === sess.humanId,
    bluffed: sess.bluffs.size > 0,
    vsOwnBot: sess.vsOwnBot,
  });
  res.json(sess.snapshot(cursor));
});

// ------------------------------------------------------------ live (human vs human)
// presence heartbeat + who's online + your invite/match — clients poll this
// every few seconds, so quiet ticks answer with a ~20-byte "same" instead of
// re-sending the whole roster (the client echoes the version it last saw)
const pollHash = (s) => require('node:crypto').createHash('md5').update(s).digest('hex').slice(0, 10);
app.post('/api/coup/live/poll', auth, (req, res) => {
  // the app-wide heartbeat also carries the scrimmage switch, so the
  // Leaderboard tab appears and disappears without a poll of its own —
  // and any unlock the client has not popped up yet, so trophies land
  // within a beat of being earned wherever you happen to be standing
  const data = {
    ...live.poll(req.user),
    ladderOn: ladder.running,
    ach: book.pending(req.user.username),
    achCount: book.count(req.user.username),
    achTotal: book.total(),
  };
  const v = pollHash(JSON.stringify(data));
  if (req.body && req.body.v === v) return res.json({ same: true, v });
  res.json({ ...data, v });
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
  awardTable(req.user, { kind: 'live', ...sess.outcomeFor(req.user.username) });
  res.json(sess.snapshot(req.user.username, cursor));
});

app.post('/api/coup/live/match/:id/forfeit', auth, (req, res) => {
  const sess = live.get(req.params.id);
  if (!sess || !sess.seatOf[req.user.username]) return res.status(404).json({ error: 'no such duel' });
  sess.forfeit(req.user.username);
  res.json(sess.snapshot(req.user.username, Number(req.body.cursor) || 0));
});

// ------------------------------------------------------------ the leaderboard (ELO scrimmage)
app.get('/api/coup/ladder', auth, (req, res) => {
  res.json(ladder.view(req.user));
});

// a paused scrimmage takes no entries and gives nothing away
function ladderOpen(req, res, next) {
  if (!ladder.running) return res.status(403).json({ error: 'The scrimmage is paused right now — check back when an organizer starts it.' });
  next();
}

app.post('/api/coup/ladder/submit', auth, ladderOpen, (req, res) => {
  const idx = Number(req.body.slot);
  const slots = store.getSlots(req.user);
  const s = slots[idx];
  if (!s || !s.python || !s.python.trim()) return res.status(400).json({ error: 'that slot is empty' });
  const check = checkProgram(s.python);
  if (!check.ok) return res.status(400).json({ error: 'that bot has problems — run "Check my bot" in the editor first' });
  const r = ladder.submit(req.user, idx, s);
  book.unlock(req.user.username, 'ladder_submit');
  res.json({ ok: true, unchanged: !!r.unchanged, submission: { id: r.submission.id, name: r.submission.name } });
});

app.post('/api/coup/ladder/withdraw', auth, ladderOpen, (req, res) => {
  res.json({ ok: ladder.withdraw(req.user, String(req.body.id || '')) });
});

// ------------------------------------------------------------ multiplayer (classic Coup tables)
app.get('/api/coup/multi/lobby', auth, (req, res) => {
  res.json(multi.lobby(req.user));
});
app.post('/api/coup/multi/create', auth, (req, res) => {
  // practice tables (bot-filled) exist in multi.js but are not exposed —
  // organizer preview only, via multi.create(user, size, true) if ever needed
  const r = multi.create(req.user, req.body.size);
  if (r.error) return res.status(400).json(r);
  res.json(r);
});
app.post('/api/coup/multi/sit', auth, (req, res) => {
  const r = multi.sit(req.user, String(req.body.id || ''));
  if (r.error) return res.status(400).json(r);
  res.json(r);
});
app.post('/api/coup/multi/leave', auth, (req, res) => {
  res.json(multi.leave(req.user));
});
app.get('/api/coup/multi/game', auth, (req, res) => {
  const s = multi.session(req.user);
  if (!s) return res.status(404).json({ error: 'no game at your table' });
  res.json(s.snapshot(req.user.username, Number(req.query.cursor) || 0));
});
app.post('/api/coup/multi/move', auth, (req, res) => {
  const s = multi.session(req.user);
  if (!s) return res.status(404).json({ error: 'no game at your table' });
  try { s.move(req.user.username, req.body || {}); }
  catch (err) { return res.status(400).json({ error: err.message }); }
  awardTable(req.user, { kind: 'multi', ...s.outcomeFor(req.user.username) });
  res.json(s.snapshot(req.user.username, Number(req.body.cursor) || 0));
});

// ------------------------------------------------------------ admin
app.get('/api/coup/admin/overview', auth, adminOnly, (req, res) => {
  res.json({
    totalMatches: store.matches.list.length,
    activeCount: store.activeUsernames().length,
    achievementTotal: book.total(),
    students: Object.values(store.users).map((u) => {
      const sel = store.selectedBot(u);
      return {
        username: u.username, displayName: u.displayName, isAdmin: !!u.isAdmin,
        role: u.role || 'student',
        active: store.isActive(u),
        slotsUsed: (store.bots[u.username] || []).filter(Boolean).length,
        selectedBot: sel.error ? null : sel.name,
        achievements: book.count(u.username),
      };
    }),
  });
});

/**
 * Retire (or bring back) a set of logins. A deactivated account cannot log in,
 * is signed out everywhere, and leaves every achievement percentage — which is
 * how last week's cohort stops dragging this week's rarity numbers down. Their
 * unlocks are kept, so reactivating restores everything.
 */
app.post('/api/coup/admin/set-active', auth, adminOnly, (req, res) => {
  const names = Array.isArray(req.body.usernames) ? req.body.usernames.map(String) : [];
  const changed = store.setActive(names, !!req.body.active);
  res.json({ ok: true, changed, activeCount: store.activeUsernames().length });
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

// everything the camp produced, one JSON: every account's saved bots (full
// source), selections, and match records. Backup + "read the students' work".
app.get('/api/coup/admin/export', auth, adminOnly, (req, res) => {
  res.json({
    exportedAt: new Date().toISOString(),
    users: Object.values(store.users).map((u) => ({
      username: u.username, displayName: u.displayName, role: u.role || 'student',
      selectedSlot: store.selectedSlot(u),
      bots: (store.bots[u.username] || [])
        .map((s, i) => s && s.python && s.python.trim()
          ? { slot: i, name: s.name, mode: s.mode, updatedAt: s.updatedAt, python: s.python }
          : null)
        .filter(Boolean),
    })).filter((u) => u.bots.length || u.role !== 'student'),
    matches: store.matches.list.map(({ series, sources, ...m }) => ({
      ...m, series: series.map((r) => ({ winsA: r.winsA, winsB: r.winsB })),
    })),
    ladder: {
      totalMatches: store.ladder.totalMatches,
      board: ladder.board(),
    },
  });
});

// log a list of users out everywhere (archived accounts keep no sessions)
app.post('/api/coup/admin/revoke-sessions', auth, adminOnly, (req, res) => {
  const names = Array.isArray(req.body.usernames) ? req.body.usernames.map(String) : [];
  res.json({ ok: true, revoked: store.revokeSessions(names) });
});

// fresh week: clear the leaderboard, Andrew re-seats at 1000
/** the scrimmage switch: {running:true} starts pairing, {running:false}
 *  stops it and hides the leaderboard from everyone but organizers */
app.post('/api/coup/admin/ladder-run', auth, adminOnly, (req, res) => {
  const running = ladder.setRunning(!!(req.body && req.body.running));
  res.json({ ok: true, running });
});

app.post('/api/coup/admin/ladder-reset', auth, adminOnly, (req, res) => {
  ladder.reset();
  res.json({ ok: true });
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
  // odd bot out battles the organizer's selected bot
  if (pool.length % 2 === 1) {
    const admin = Object.values(store.users).find((u) => u.isAdmin);
    const f = admin && fighterFor(admin);
    if (f && !f.error) pool.push(f);
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
  // the scrimmage is organizer-controlled from the Organizer tab; if it was
  // running when the server went down, it picks up where it left off
  ladder.start();
  app.listen(PORT, () => {
    console.log(`\n  🎭 dynaCOUP camp server → http://localhost:${PORT}`);
    console.log(`     ${Object.keys(store.users).length} logins, ${store.matches.list.length} recorded matches\n`);
  });
  process.on('SIGINT', () => { store.flush(); process.exit(0); });
  process.on('SIGTERM', () => { store.flush(); process.exit(0); });
}

module.exports = { app, store, arena };
