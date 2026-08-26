/**
 * store — JSON-file persistence for the camp. No database, one folder:
 *   users.json     pre-created logins (scrypt-hashed) + selected bot slot
 *   bots.json      per-student saved bot versions (10 slots, admin 100)
 *   matches.json   best-of-5 bot matches (sample replays inside), capped
 *   achievements.json  per-account unlocks + the un-popped toast queue
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
    this.ladder = this._load('ladder.json', { submissions: [], totalMatches: 0, running: true });
    this.achievements = this._load('achievements.json', {});
    // organizer-tuned knobs that are not about any one subsystem's data
    this.settings = this._load('settings.json', {});
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
  /** achievements move in tiny bursts and matter immediately — short debounce */
  saveAchievements() { this._save('achievements.json', this.achievements, 500); }
  saveSettings() { this._save('settings.json', this.settings, 500); }

  flush() {
    for (const [file, obj] of [['users.json', this.users], ['sessions.json', this.sessions],
      ['bots.json', this.bots], ['matches.json', this.matches], ['ladder.json', this.ladder],
      ['achievements.json', this.achievements], ['settings.json', this.settings]]) {
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
      active: true,
    };
    this._save('users.json', this.users);
    return { user: this.users[uname] };
  }
  checkLogin(username, password) {
    const u = this.users[String(username || '').trim().toLowerCase()];
    if (!u || !checkPassword(password, u.pass)) return null;
    return this.isActive(u) ? u : { deactivated: true };
  }

  // ------------------------------------------------------------ active accounts
  /**
   * Accounts written before the switch existed have no `active` field, so
   * "not explicitly deactivated" is what counts as active. Deactivating is how
   * a finished week's cohort leaves the camp: they cannot log in, and they drop
   * out of every achievement percentage — their unlocks stay on record.
   */
  isActive(user) { return !!user && user.active !== false; }

  /** every active login except the organizers — the achievement denominator */
  activeUsernames() {
    return Object.values(this.users)
      .filter((u) => !u.isAdmin && this.isActive(u))
      .map((u) => u.username);
  }

  /** organizer: retire (or bring back) a set of logins */
  setActive(usernames, active) {
    const changed = [];
    for (const name of usernames) {
      const u = this.users[String(name || '').toLowerCase()];
      if (!u || u.isAdmin) continue;          // never lock the organizers out
      if (this.isActive(u) === !!active) continue;
      u.active = !!active;
      changed.push(u.username);
    }
    if (changed.length) {
      this._save('users.json', this.users);
      if (!active) this.revokeSessions(changed);   // deactivating logs them out
    }
    return changed;
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
    const u = s ? this.users[s.username] || null : null;
    return u && this.isActive(u) ? u : null;
  }
  /** log the given users out everywhere (e.g. archived accounts) */
  revokeSessions(usernames) {
    const set = new Set(usernames);
    let n = 0;
    for (const [tok, s] of Object.entries(this.sessions)) {
      if (set.has(s.username)) { delete this.sessions[tok]; n++; }
    }
    this._save('sessions.json', this.sessions);
    return n;
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
    // per-account retention, sectioned: ladder matches and level/battle
    // matches each keep their own last 5 per owner, so a busy ladder can't
    // evict someone's gauntlet history. A match survives while it is within
    // SOME owner's most recent 5 of its section.
    const seen = new Map();   // owner:section -> kept so far
    const keep = new Set();
    for (let i = this.matches.list.length - 1; i >= 0; i--) {
      const m = this.matches.list[i];
      const section = m.mode === 'ladder' ? 'ladder' : 'other';
      for (const o of m.owners) {
        const k = o + ':' + section;
        const n = seen.get(k) || 0;
        if (n < MATCHES_PER_ACCOUNT) { keep.add(m.id); seen.set(k, n + 1); }
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
    const mine = this.matches.list.filter((m) => m.owners.includes(user.username)).reverse();
    // up to 5 of each section (retention already enforces this globally,
    // but a shared match kept alive by the OTHER owner shouldn't pad mine)
    const out = [];
    const count = { ladder: 0, other: 0 };
    for (const m of mine) {
      const s = m.mode === 'ladder' ? 'ladder' : 'other';
      if (count[s] < MATCHES_PER_ACCOUNT) { out.push(m); count[s]++; }
    }
    return out;
  }
}

module.exports = { Store, hashPassword };
