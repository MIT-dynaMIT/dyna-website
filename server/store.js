/**
 * store — JSON-file persistence for the camp. No database, one folder:
 *   users.json     pre-created logins (scrypt-hashed) + selected bot slot
 *   bots.json      per-student saved bot versions (10 slots, admin 100)
 *   matches.json   best-of-5 bot matches (sample replays inside), capped
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MATCH_CAP = 250;             // global backstop
const MATCHES_PER_ACCOUNT = 5;     // each account keeps only its last 5 matches

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
      ['bots.json', this.bots], ['matches.json', this.matches]]) {
      clearTimeout(this._timers[file]);
      try { fs.writeFileSync(path.join(this.dir, file), JSON.stringify(obj)); } catch {}
    }
  }

  // ------------------------------------------------------------ users/auth
  createUser(username, password, displayName, isAdmin = false, role = 'student') {
    const uname = String(username || '').trim().toLowerCase();
    if (!/^[a-z0-9_]{2,20}$/.test(uname)) return { error: 'username: 2-20 letters/numbers' };
    if (this.users[uname]) return { error: 'username taken' };
    this.users[uname] = {
      username: uname,
      displayName: String(displayName || username).slice(0, 24),
      pass: hashPassword(password),
      isAdmin: !!isAdmin,
      role: isAdmin ? 'organizer' : (['mentor', 'board'].includes(role) ? role : 'student'),
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

  // ------------------------------------------------------------ selected bot
  /** the slot this user fights with everywhere; falls back to first non-empty */
  selectedSlot(user) {
    const slots = this.getSlots(user);
    const sel = user.selectedSlot;
    if (sel != null && slots[sel] && slots[sel].python && slots[sel].python.trim()) return sel;
    const first = slots.findIndex((s) => s && s.python && s.python.trim());
    return first >= 0 ? first : null;
  }
  setSelectedSlot(user, idx) {
    const slots = this.getSlots(user);
    if (!(idx >= 0 && idx < slots.length)) return { error: 'bad slot' };
    if (!slots[idx] || !slots[idx].python || !slots[idx].python.trim()) return { error: 'that slot is empty' };
    user.selectedSlot = idx;
    this._save('users.json', this.users);
    return { ok: true, slot: idx };
  }
  /** {slot, name, source} of the user's fighting bot, or {error} */
  selectedBot(user) {
    const idx = this.selectedSlot(user);
    if (idx == null) return { error: 'no saved bot — build one in the Bot Editor first' };
    const s = this.getSlots(user)[idx];
    return { slot: idx, name: s.name, source: s.python };
  }

  // ------------------------------------------------------------ match history
  addMatch(match) {
    match.id = crypto.randomBytes(6).toString('hex');
    match.ts = Date.now();
    this.matches.list.push(match);
    // per-account retention: a match survives while it is within SOME owner's
    // most recent 5 — dropping one player's 6th must not erase another's 2nd
    const seen = new Map();   // owner -> how many of their matches kept so far
    const keep = new Set();
    for (let i = this.matches.list.length - 1; i >= 0; i--) {
      const m = this.matches.list[i];
      for (const o of m.owners) {
        const n = seen.get(o) || 0;
        if (n < MATCHES_PER_ACCOUNT) { keep.add(m.id); seen.set(o, n + 1); }
      }
    }
    this.matches.list = this.matches.list.filter((m) => keep.has(m.id));
    if (this.matches.list.length > MATCH_CAP) this.matches.list.splice(0, this.matches.list.length - MATCH_CAP);
    // matches.json carries sample replays and nothing reads it between writes,
    // so it saves on a lazy debounce; flush() on SIGINT/SIGTERM covers shutdown.
    this._save('matches.json', this.matches, 30000);
    return match;
  }

  getMatch(id) { return this.matches.list.find((m) => m.id === id) || null; }

  matchesFor(user) {
    if (user.isAdmin) return [...this.matches.list].reverse();
    return this.matches.list.filter((m) => m.owners.includes(user.username))
      .reverse().slice(0, MATCHES_PER_ACCOUNT);
  }
}

module.exports = { Store, hashPassword };
