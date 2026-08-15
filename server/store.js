/**
 * store — JSON-file persistence for the camp. No database, one folder:
 *   users.json     pre-created logins (scrypt-hashed) + sessions
 *   bots.json      per-student saved bot versions (10 slots, admin 100)
 *   scrim.json     scrim submissions + elo + rolling per-game stats
 *   matches.json   recorded matches (seed + decisions → replayable), capped
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MATCH_CAP = 600;   // series records carry sample replays
const LAST_N_RESULTS = 100;   // rolling series-score window
const MATCH_REFS = 20;        // per-bot series history shown to students

function hashPassword(pw) {
  const salt = crypto.randomBytes(12).toString('hex');
  const h = crypto.scryptSync(String(pw), salt, 32).toString('hex');
  return salt + ':' + h;
}
function checkPassword(pw, stored) {
  const [salt, h] = String(stored || '').split(':');
  if (!salt || !h) return false;
  const test = crypto.scryptSync(String(pw), salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(test, 'hex'));
}

class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.users = this._load('users.json', {});
    this.sessions = this._load('sessions.json', {});
    this.bots = this._load('bots.json', {});
    this.scrim = this._load('scrim.json', { submissions: [], totalGames: 0, running: true });
    this.matches = this._load('matches.json', { list: [] });
    this._timers = {};
  }

  _load(file, fallback) {
    try { return JSON.parse(fs.readFileSync(path.join(this.dir, file), 'utf8')); }
    catch { return fallback; }
  }
  _save(file, obj, delay = 2000) {
    clearTimeout(this._timers[file]);
    this._timers[file] = setTimeout(() => {
      try { fs.writeFileSync(path.join(this.dir, file), JSON.stringify(obj)); }
      catch (err) { console.error('[store] save failed', file, err.message); }
    }, delay);
  }
  flush() {
    for (const [file, obj] of [['users.json', this.users], ['sessions.json', this.sessions],
      ['bots.json', this.bots], ['scrim.json', this.scrim], ['matches.json', this.matches]]) {
      clearTimeout(this._timers[file]);
      try { fs.writeFileSync(path.join(this.dir, file), JSON.stringify(obj)); } catch {}
    }
  }

  // ------------------------------------------------------------ users/auth
  createUser(username, password, displayName, isAdmin = false) {
    const uname = String(username || '').trim().toLowerCase();
    if (!/^[a-z0-9_]{2,20}$/.test(uname)) return { error: 'username: 2-20 letters/numbers' };
    if (this.users[uname]) return { error: 'username taken' };
    this.users[uname] = {
      username: uname,
      displayName: String(displayName || username).slice(0, 24),
      pass: hashPassword(password),
      isAdmin: !!isAdmin,
    };
    this._save('users.json', this.users);
    return { user: this.users[uname] };
  }
  checkLogin(username, password) {
    const u = this.users[String(username || '').trim().toLowerCase()];
    return u && checkPassword(password, u.pass) ? u : null;
  }
  resetPassword(username, newPassword) {
    const u = this.users[String(username || '').toLowerCase()];
    if (!u) return false;
    u.pass = hashPassword(newPassword);
    this._save('users.json', this.users);
    return true;
  }
  createSession(username) {
    const token = crypto.randomBytes(24).toString('hex');
    this.sessions[token] = { username, ts: Date.now() };
    this._save('sessions.json', this.sessions);
    return token;
  }
  getSessionUser(token) {
    const s = token && this.sessions[token];
    return s ? this.users[s.username] || null : null;
  }

  // ------------------------------------------------------------ bot slots
  slotCount(user) { return user.isAdmin ? 100 : 10; }
  getSlots(user) {
    const n = this.slotCount(user);
    const cur = this.bots[user.username] || [];
    while (cur.length < n) cur.push(null);
    this.bots[user.username] = cur.slice(0, n);
    return this.bots[user.username];
  }
  saveSlot(user, idx, data) {
    const slots = this.getSlots(user);
    if (!(idx >= 0 && idx < slots.length)) return { error: 'bad slot' };
    // optimistic concurrency: a stale tab (loaded before someone else saved
    // this slot) must not silently clobber the newer version
    if (data.baseUpdatedAt !== undefined && slots[idx]
      && slots[idx].updatedAt !== data.baseUpdatedAt) {
      return { conflict: true, slot: slots[idx] };
    }
    slots[idx] = {
      name: String(data.name || `Bot ${idx + 1}`).slice(0, 24),
      mode: data.mode === 'python' ? 'python' : 'blocks',
      blocksJson: data.blocksJson ?? (slots[idx] ? slots[idx].blocksJson : null),
      python: String(data.python || ''),
      updatedAt: Date.now(),
    };
    this._save('bots.json', this.bots);
    return { slot: slots[idx] };
  }

  // ------------------------------------------------------------ scrim pool
  /** student: replaces their single submission; admin: adds another (≤100) */
  submit(user, idx) {
    const slots = this.getSlots(user);
    const s = slots[idx];
    if (!s || !s.python || !s.python.trim()) return { error: 'that slot is empty' };
    const subs = this.scrim.submissions;
    if (!user.isAdmin) {
      const old = subs.find((x) => x.owner === user.username);
      // same code resubmitted → keep the entry (and its elo/history) intact;
      // kids re-click "submit" constantly and shouldn't nuke their own rating
      if (old && old.source === s.python) return { submission: old, unchanged: true };
      if (old) this._removeSubmission(old.id);
    } else if (subs.filter((x) => x.owner === user.username).length >= 100) {
      return { error: 'admin bot cap (100) reached' };
    }
    const entry = {
      id: crypto.randomBytes(6).toString('hex'),
      owner: user.username,
      ownerName: user.displayName,
      slot: idx,
      name: this._uniqueBotName(s.name || user.displayName),
      source: s.python,
      elo: 1000, games: 0, wins: 0,
      last: [],        // last 100 results, 1/0
      recent: [],      // last 50 per-game {ch, chW, cl, clC}
      matchIds: [],    // last 20 match refs
      errors: 0,
      createdAt: Date.now(),
    };
    subs.push(entry);
    this._save('scrim.json', this.scrim);
    return { submission: entry };
  }
  _uniqueBotName(base) {
    let name = String(base || 'Bot').slice(0, 20);
    const taken = new Set(this.scrim.submissions.map((s) => s.name));
    let i = 2;
    while (taken.has(name)) name = `${String(base).slice(0, 17)} ${i++}`;
    return name;
  }
  _removeSubmission(id) {
    const i = this.scrim.submissions.findIndex((x) => x.id === id);
    if (i >= 0) this.scrim.submissions.splice(i, 1);
  }
  withdraw(user, id) {
    const s = this.scrim.submissions.find((x) => x.id === id);
    if (!s || (s.owner !== user.username && !user.isAdmin)) return false;
    this._removeSubmission(id);
    this._save('scrim.json', this.scrim);
    return true;
  }
  mySubmissions(user) {
    return this.scrim.submissions.filter((s) => s.owner === user.username);
  }

  recordScrimGame(match, perBot) {
    // perBot: {submissionId: {win, ch, chW, cl, clC, errors, eloDelta}}
    this.scrim.totalGames++;
    const id = crypto.randomBytes(6).toString('hex');
    match.id = id;
    match.ts = Date.now();
    this.matches.list.push(match);
    if (this.matches.list.length > MATCH_CAP) this.matches.list.splice(0, this.matches.list.length - MATCH_CAP);
    for (const [sid, r] of Object.entries(perBot)) {
      const sub = this.scrim.submissions.find((s) => s.id === sid);
      if (!sub) continue;
      sub.games++;                 // series played
      if (r.win) sub.wins++;
      sub.elo = Math.round((sub.elo + r.eloDelta) * 10) / 10;
      sub.last.push(r.score ?? (r.win ? 1 : 0));   // score fraction per series
      if (sub.last.length > LAST_N_RESULTS) sub.last.splice(0, sub.last.length - LAST_N_RESULTS);
      sub.matchIds.push(id);
      if (sub.matchIds.length > MATCH_REFS) sub.matchIds.splice(0, sub.matchIds.length - MATCH_REFS);
      if (r.errors) sub.errors += r.errors;
    }
    this._save('scrim.json', this.scrim);
    // matches.json carries sample replays (~10KB/series, ~4.7MB at the cap) and
    // nothing reads it between writes, so it saves on a lazy debounce; flush()
    // on SIGINT/SIGTERM covers clean shutdown.
    this._save('matches.json', this.matches, 30000);
  }

  getMatch(id) { return this.matches.list.find((m) => m.id === id) || null; }

  leaderboard() {
    return [...this.scrim.submissions].sort((a, b) => b.elo - a.elo).map((s, i) => ({
      rank: i + 1, id: s.id, name: s.name, owner: s.ownerName, isHouse: s.owner === '__house',
      elo: Math.round(s.elo), games: s.games,
      winRate: s.last.length ? s.last.reduce((a, x) => a + x, 0) / s.last.length : 0,
    }));
  }
}

module.exports = { Store, hashPassword };
