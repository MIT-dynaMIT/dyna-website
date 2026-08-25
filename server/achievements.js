/**
 * achievements — the camp's trophy cabinet.
 *
 * Steam-shaped: a fixed registry of named awards, each with an icon, a funny
 * title and a description. Some are HIDDEN — campers see a locked plaque with
 * no description until they trip over it. Every award carries the share of
 * ACTIVE accounts that hold it, so a rare one feels rare.
 *
 * Nothing here changes how a game is played. Awards are read off things that
 * already happen: match flags collected god-side by the runner, ladder
 * standings, the bot source a student saves, and their own table games. The
 * point is to nudge: half of these can only be earned by opening the editor
 * and trying something new.
 *
 * Storage lives in the Store (achievements.json):
 *   { <username>: { unlocked: {id: ts}, pending: [id, ...] } }
 * `pending` is the toast queue — ids the client has not popped up yet.
 */
'use strict';

// ------------------------------------------------------------ categories
const CATEGORIES = [
  { id: 'levels', name: 'The Gauntlet', blurb: 'Three house bots stand in your way.' },
  { id: 'bluff', name: 'The Art of Lying', blurb: 'Claim what you do not hold.' },
  { id: 'read', name: 'Reading the Room', blurb: 'Work out when THEY are lying.' },
  { id: 'ladder', name: 'The Scrimmage', blurb: 'Everyone else’s bots, all day long.' },
  { id: 'code', name: 'Code Craft', blurb: 'What is actually inside your bot.' },
  { id: 'bugs', name: 'Occupational Hazards', blurb: 'It happens to everyone. Really.' },
  { id: 'table', name: 'At the Table', blurb: 'You, playing with your own two hands.' },
];

/**
 * The registry. `hidden: true` keeps name + description secret until unlocked.
 * `hint` is the one line a hidden award shows once it IS unlocked, explaining
 * what tripped it — locked hidden awards show nothing at all.
 */
const ACHIEVEMENTS = [
  // ---------------------------------------------------------- the gauntlet
  { id: 'first_match', cat: 'levels', icon: '⚔️', name: 'Baptism by Fire',
    desc: 'Send a bot into its first real match.' },
  { id: 'beat_victor', cat: 'levels', icon: '🥉', name: 'Better Than the Guy Who Made It',
    desc: 'Beat Level 1. Victor wrote this game; that never meant he was good at it.' },
  { id: 'beat_megan', cat: 'levels', icon: '🥈', name: 'Megan Is Still Disappointed',
    desc: 'Beat Level 2. She expected this, but she is not impressed.' },
  { id: 'beat_andrew', cat: 'levels', icon: '🏆', name: 'We Do Not Talk About Andrew',
    desc: 'Beat Level 3. The final boss falls.' },
  { id: 'beat_all', cat: 'levels', icon: '👑', name: 'Clean Sweep of the Court',
    desc: 'Beat all three house bots.' },
  { id: 'sweep', cat: 'levels', icon: '💯', name: 'Not Even Close',
    desc: 'Win a match without dropping a single round.' },

  // ---------------------------------------------------------- bluffing
  { id: 'bluff_duke', cat: 'bluff', icon: '👑', name: 'Taxation Without Representation',
    desc: 'Have your bot collect tax with a Duke it does not hold.' },
  { id: 'bluff_assassin', cat: 'bluff', icon: '🗡️', name: 'Unlicensed Practitioner',
    desc: 'Have your bot order an assassination without the Assassin.' },
  { id: 'bluff_ambassador', cat: 'bluff', icon: '🎩', name: 'Diplomatic Fraud',
    desc: 'Have your bot call an exchange with no Ambassador in sight.' },
  { id: 'bluff_contessa', cat: 'bluff', icon: '🌹', name: 'The Contessa Defence',
    desc: 'Have your bot block an assassination with a Contessa it invented.' },
  { id: 'bluff_slam', cat: 'bluff', icon: '🃏', name: 'Full House of Lies',
    desc: 'Bluff all four characters inside a single match.' },
  { id: 'honest_win', cat: 'bluff', icon: '😇', name: 'Honest Work',
    desc: 'Win a match without telling a single lie. Harder than it sounds.' },
  { id: 'caught_lots', cat: 'bluff', icon: '😳', name: 'Terrible Poker Face', hidden: true,
    desc: 'Get caught bluffing 250 times in a single match.',
    hint: 'Two hundred and fifty lies. Two hundred and fifty faces caught.' },

  // ---------------------------------------------------------- reading them
  { id: 'first_catch', cat: 'read', icon: '🔍', name: 'J’Accuse',
    desc: 'Catch your opponent in a lie.' },
  { id: 'catch_many', cat: 'read', icon: '🎯', name: 'Human Lie Detector',
    desc: 'Finish a match having challenged at least 50 times and been right more often than not.' },
  { id: 'called_shot', cat: 'read', icon: '🎪', name: 'Called Shot',
    desc: 'Finish a match naming the right card on 65% of your coups. Guessing gets ~53%, and best_coup_call() alone gets ~61% — you will have to out-read your opponent yourself.' },
  { id: 'never_challenge', cat: 'read', icon: '🙈', name: 'Trusting Soul', hidden: true,
    desc: 'Win a match without ever challenging anybody.',
    hint: 'You never called them out once — and still won. Challenging is usually a losing move.' },

  // ---------------------------------------------------------- the scrimmage
  { id: 'ladder_submit', cat: 'ladder', icon: '🎪', name: 'Into the Arena',
    desc: 'Put a bot into the scrimmage.' },
  { id: 'top10', cat: 'ladder', icon: '🔟', name: 'Top Ten Material',
    desc: 'Reach the top 10 of the leaderboard.' },
  { id: 'top3', cat: 'ladder', icon: '🥇', name: 'On the Podium',
    desc: 'Reach the top 3 of the leaderboard.' },
  { id: 'rank1', cat: 'ladder', icon: '♛', name: 'King of the Court', hidden: true,
    desc: 'Sit at number one on the leaderboard.',
    hint: 'Number one. For now.' },
  { id: 'rated', cat: 'ladder', icon: '📈', name: 'Rated Threat',
    desc: 'Push a bot past 1150 on the ladder.' },

  // ---------------------------------------------------------- code craft
  { id: 'advanced', cat: 'code', icon: '⌨️', name: 'Off the Rails',
    desc: 'Save a bot written by hand in Advanced (Python).' },
  { id: 'commented', cat: 'code', icon: '💬', name: 'For Future You',
    desc: 'Leave a comment of your own in your bot.' },
  { id: 'loop', cat: 'code', icon: '🔁', name: 'Round and Round',
    desc: 'Use a loop in your bot.' },
  { id: 'sorted_list', cat: 'code', icon: '🔢', name: 'Everything In Its Right Place',
    desc: 'Sort a list in your bot.' },
  { id: 'dict', cat: 'code', icon: '🗂️', name: 'Filed Under D',
    desc: 'Use a dictionary to keep track of something.' },
  { id: 'helper', cat: 'code', icon: '🧱', name: 'Your Own Two Hands',
    desc: 'Write a helper function of your own and call it.' },
  { id: 'math', cat: 'code', icon: '📐', name: 'Show Your Work',
    desc: 'Work out the odds with prob_opponent_has() or unseen_copies().' },
  { id: 'randomness', cat: 'code', icon: '🎲', name: 'Chaos Agent',
    desc: 'Let a dice roll decide something.' },
  { id: 'counting', cat: 'code', icon: '🧮', name: 'Counting Cards',
    desc: 'Use times_claimed() to notice how often they claim the same card.' },
  { id: 'series_memory', cat: 'code', icon: '🧠', name: 'Learning Their Tells',
    desc: 'Read the series stats and adapt part-way through a matchup.' },
  { id: 'all_five_fns', cat: 'code', icon: '🛠️', name: 'Fully Armed',
    desc: 'Write all five bot functions, choose_exchange included.' },
  { id: 'long_bot', cat: 'code', icon: '📜', name: 'War and Peace',
    desc: 'Save a bot longer than 80 lines.' },
  { id: 'five_bots', cat: 'code', icon: '🧪', name: 'Mad Scientist',
    desc: 'Keep five different bots saved at the same time.' },

  // ---------------------------------------------------------- hazards
  { id: 'check_pass', cat: 'bugs', icon: '✅', name: 'All Green',
    desc: 'Get a clean bill of health from "Check my bot".' },
  { id: 'check_fail', cat: 'bugs', icon: '🔧', name: 'Have You Tried Turning It Off',
    desc: 'Have "Check my bot" find something wrong. Everyone gets this one.' },
  { id: 'redemption', cat: 'bugs', icon: '🩹', name: 'Debugged', hidden: true,
    desc: 'Take a bot from a failing check to a passing one.',
    hint: 'It was broken. You fixed it. That is the whole job.' },
  { id: 'first_crash', cat: 'bugs', icon: '🐛', name: 'It’s Not a Bug',
    desc: 'Have your bot fall over in the middle of a real match.' },
  { id: 'crash_but_win', cat: 'bugs', icon: '🔥', name: 'This Is Fine', hidden: true,
    desc: 'Win a match your bot was crashing during.',
    hint: 'Your bot threw errors the entire match and won it anyway.' },

  // ---------------------------------------------------------- at the table
  { id: 'table_first', cat: 'table', icon: '🃏', name: 'Dealt In',
    desc: 'Sit down and play a hand of Coup yourself.' },
  { id: 'beat_own_bot', cat: 'table', icon: '🪞', name: 'Beating Yourself Up',
    desc: 'Beat your own bot at a table.' },
  { id: 'human_bluff', cat: 'table', icon: '😈', name: 'Lying to a Real Human',
    desc: 'Claim a card you do not hold, with your own hands, against a person.' },
  { id: 'table_win', cat: 'table', icon: '🤝', name: 'Face to Face',
    desc: 'Win a live duel against another camper.' },
  { id: 'multi_win', cat: 'table', icon: '🏝️', name: 'Last One Standing',
    desc: 'Win a multiplayer table.' },
];

const BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

// ------------------------------------------------------------ source scanning
// The scaffold every camper starts from already contains comments and calls
// best_coup_call(). Awards must go to what the STUDENT added, so anything the
// scaffold hands out for free is subtracted before scanning.
const API_FNS = new Set(['your_turn', 'respond', 'when_assassinated',
  'choose_card_to_lose', 'choose_exchange']);

/** comment text, one entry per `#` comment line, trimmed */
function commentsOf(source) {
  const out = [];
  for (const raw of String(source || '').split('\n')) {
    // botlang has no string escapes worth chasing here: a '#' inside quotes is
    // rare in kid bots and a false negative only costs an award nobody noticed
    const i = raw.indexOf('#');
    if (i < 0) continue;
    const text = raw.slice(i + 1).trim();
    if (text) out.push(text);
  }
  return out;
}

/** the same source with every `#` comment removed, lines kept in place */
function stripComments(source) {
  return String(source || '').split('\n')
    .map((raw) => {
      const i = raw.indexOf('#');
      return i < 0 ? raw : raw.slice(0, i);
    })
    .join('\n');
}

/**
 * Which code-craft awards this source earns.
 * @param source  the bot's python
 * @param scaffoldComments  Set of comment lines the starter gives away free
 */
function scanSource(source, scaffoldComments) {
  const raw = String(source || '');
  if (!raw.trim()) return [];
  const got = [];
  // Code awards read CODE. The scaffold's own comments name prob_opponent_has
  // and friends as a hint, and a hint is not a use of one.
  const src = stripComments(raw);
  const has = (re) => re.test(src);

  // a comment the scaffold did not already write for them
  if (commentsOf(raw).some((c) => !scaffoldComments.has(c))) got.push('commented');
  if (has(/^[ \t]*(for|while)\b/m)) got.push('loop');
  // sorted()/.sort() by hand, or the "sorted strongest-first" block
  if (has(/\bsorted\s*\(|\.sort\s*\(|\bstrongest_cards\s*\(/)) got.push('sorted_list');
  // a dict literal: {} or {"a": 1} — botlang's only use of braces
  if (has(/\{/)) got.push('dict');
  if (has(/\bprob_opponent_has\s*\(|\bunseen_copies\s*\(/)) got.push('math');
  if (has(/\brandom\s*\(|\brandom_int\s*\(|\brandom_choice\s*\(/)) got.push('randomness');
  if (has(/\btimes_claimed\s*\(/)) got.push('counting');
  if (has(/\bstate\.series\b|\bseries_[a-z_]+/)) got.push('series_memory');

  // a function of their own, that they actually call. Blank the `def` lines
  // first so defining a helper and never using it does not count.
  const defs = [...src.matchAll(/^[ \t]*def[ \t]+([A-Za-z_]\w*)/gm)].map((m) => m[1]);
  const body = src.replace(/^[ \t]*def[ \t]+[A-Za-z_]\w*/gm, '');
  const mine = defs.filter((d) => !API_FNS.has(d));
  if (mine.some((d) => new RegExp(`\\b${d}\\s*\\(`).test(body))) got.push('helper');
  if ([...API_FNS].every((f) => defs.includes(f))) got.push('all_five_fns');

  const lines = src.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
  if (lines.length > 80) got.push('long_bot');
  return got;
}

// ------------------------------------------------------------ the engine
class AchievementBook {
  constructor(store) {
    this.store = store;
    // scaffold comments are "free" — loaded lazily so a missing samplebots
    // folder can never stop the server booting
    this._scaffold = null;
  }

  get _data() { return this.store.achievements; }

  get scaffoldComments() {
    if (!this._scaffold) {
      let text = '';
      try { text = require('./samplebots/bots').THE_SCAFFOLD || ''; } catch { /* none */ }
      this._scaffold = new Set(commentsOf(text));
    }
    return this._scaffold;
  }

  _rec(username) {
    let r = this._data[username];
    if (!r) { r = this._data[username] = { unlocked: {}, pending: [] }; }
    if (!r.unlocked) r.unlocked = {};
    if (!r.pending) r.pending = [];
    return r;
  }

  /**
   * Award one or more achievements. Already-held ids are ignored.
   * @returns the ids that are NEW (also queued for the unlock toast)
   */
  unlock(username, ids) {
    if (!username || username === 'house') return [];
    const list = (Array.isArray(ids) ? ids : [ids]).filter((id) => BY_ID.has(id));
    if (!list.length) return [];
    const rec = this._rec(username);
    const fresh = [];
    for (const id of list) {
      if (rec.unlocked[id]) continue;
      rec.unlocked[id] = Date.now();
      rec.pending.push(id);
      fresh.push(id);
    }
    if (fresh.length) this.store.saveAchievements();
    return fresh;
  }

  count(username) { return Object.keys(this._rec(username).unlocked).length; }
  total() { return ACHIEVEMENTS.length; }

  /** the unlock toasts this client has not shown yet */
  pending(username) {
    return this._rec(username).pending
      .map((id) => BY_ID.get(id))
      .filter(Boolean)
      .map((a) => ({ id: a.id, icon: a.icon, name: a.name, desc: a.hidden ? (a.hint || a.desc) : a.desc }));
  }

  /** the client has popped them up — stop re-sending */
  ack(username, ids) {
    const rec = this._rec(username);
    const drop = new Set(Array.isArray(ids) && ids.length ? ids : rec.pending);
    const before = rec.pending.length;
    rec.pending = rec.pending.filter((id) => !drop.has(id));
    if (rec.pending.length !== before) this.store.saveAchievements();
  }

  /**
   * How many ACTIVE accounts hold each achievement, as a fraction.
   * Active = every non-organizer login that has not been deactivated —
   * students, mentors and board alike. Deactivating last week's cohort keeps
   * their unlocks on record but takes them out of every denominator.
   */
  rarity() {
    const active = this.store.activeUsernames();
    const n = active.length;
    const out = {};
    for (const a of ACHIEVEMENTS) out[a.id] = { holders: 0, pct: 0 };
    for (const u of active) {
      const rec = this._data[u];
      if (!rec || !rec.unlocked) continue;
      for (const id of Object.keys(rec.unlocked)) {
        if (out[id]) out[id].holders++;
      }
    }
    if (n) for (const id of Object.keys(out)) out[id].pct = out[id].holders / n;
    return { rarity: out, activeCount: n };
  }

  /** everything the Achievements page renders */
  view(username) {
    const rec = this._rec(username);
    const { rarity, activeCount } = this.rarity();
    return {
      categories: CATEGORIES,
      activeCount,
      unlockedCount: Object.keys(rec.unlocked).length,
      total: ACHIEVEMENTS.length,
      achievements: ACHIEVEMENTS.map((a) => {
        const at = rec.unlocked[a.id] || null;
        const secret = !!a.hidden && !at;
        return {
          id: a.id,
          cat: a.cat,
          hidden: !!a.hidden,
          unlockedAt: at,
          pct: rarity[a.id] ? rarity[a.id].pct : 0,
          holders: rarity[a.id] ? rarity[a.id].holders : 0,
          // a locked hidden award gives nothing away but its rarity
          icon: secret ? null : a.icon,
          name: secret ? null : a.name,
          desc: secret ? null : (at && a.hidden ? (a.hint || a.desc) : a.desc),
        };
      }),
    };
  }

  // ---------------------------------------------------------- evaluators

  /**
   * Scan a student's saved bots for the code-craft awards.
   *
   * Unlocks themselves are stored, never recomputed — this only re-reads the
   * SOURCE, and only when a slot has actually been saved since the last look.
   * The Achievements page calls it on every visit to backfill bots written
   * before any of this existed, and without the guard that would re-scan ten
   * unchanged programs on every page load.
   */
  fromSlots(username, slots) {
    const rec = this._rec(username);
    const newest = (slots || []).reduce(
      (m, s) => (s && s.updatedAt > m ? s.updatedAt : m), 0);
    if (rec.scannedAt != null && newest <= rec.scannedAt) return [];

    const ids = new Set();
    let filled = 0;
    for (const s of slots || []) {
      if (!s || !s.python || !s.python.trim()) continue;
      filled++;
      if (s.mode === 'python') ids.add('advanced');
      for (const id of scanSource(s.python, this.scaffoldComments)) ids.add(id);
    }
    if (filled >= 5) ids.add('five_bots');
    const fresh = this.unlock(username, [...ids]);
    rec.scannedAt = newest;
    if (!fresh.length) this.store.saveAchievements();   // remember the watermark
    return fresh;
  }

  /** "Check my bot" came back */
  fromCheck(username, result) {
    const rec = this._rec(username);
    const ids = [];
    if (result.ok) {
      // only a redemption if this account has actually seen a failing check
      if (rec.unlocked.check_fail) ids.push('redemption');
      ids.push('check_pass');
    } else {
      ids.push('check_fail');
    }
    return this.unlock(username, ids);
  }

  /**
   * A finished bot match, from one owner's side.
   * @param ctx {mode, level, houseName, won, swept, flags}
   *        flags = the god-side tally for THIS owner's bot (see runner.js)
   */
  fromMatch(username, ctx) {
    const ids = ['first_match'];
    const f = ctx.flags || {};
    const bluffs = f.bluffs || {};

    if (bluffs.duke) ids.push('bluff_duke');
    if (bluffs.assassin) ids.push('bluff_assassin');
    if (bluffs.ambassador) ids.push('bluff_ambassador');
    if (bluffs.contessa) ids.push('bluff_contessa');
    if (bluffs.duke && bluffs.assassin && bluffs.ambassador && bluffs.contessa) ids.push('bluff_slam');
    if ((f.caught || 0) >= 250) ids.push('caught_lots');
    if (f.challengeWins) ids.push('first_catch');
    // volume alone proves nothing over a 500-game match — these two are about
    // being RIGHT, which is the only way either skill is worth anything
    if ((f.challengesMade || 0) >= 50 && f.challengeWins / f.challengesMade > 0.5) ids.push('catch_many');
    if ((f.coupCalls || 0) >= 100 && f.coupHits / f.coupCalls >= 0.65) ids.push('called_shot');
    if (f.errors) ids.push('first_crash');

    if (ctx.won) {
      const totalBluffs = Object.values(bluffs).reduce((a, b) => a + b, 0);
      if (!totalBluffs) ids.push('honest_win');
      if (!f.challengesMade) ids.push('never_challenge');
      if (f.errors) ids.push('crash_but_win');
      if (ctx.swept) ids.push('sweep');
      if (ctx.mode === 'gauntlet') {
        const level = { Victor: 'beat_victor', Megan: 'beat_megan', Andrew: 'beat_andrew' }[ctx.houseName];
        if (level) {
          ids.push(level);
          const held = this._rec(username).unlocked;
          const all = ['beat_victor', 'beat_megan', 'beat_andrew'];
          if (all.every((x) => x === level || held[x])) ids.push('beat_all');
        }
      }
    }
    return this.unlock(username, ids);
  }

  /** the ladder moved — `entry` is this owner's submission, `rank` 1-based */
  fromLadder(username, entry, rank) {
    const ids = [];
    if (rank && rank <= 10) ids.push('top10');
    if (rank && rank <= 3) ids.push('top3');
    if (rank === 1) ids.push('rank1');
    if (entry && entry.elo >= 1150) ids.push('rated');
    return this.unlock(username, ids);
  }

  /**
   * A table game you played with your own hands.
   * @param ctx {won, bluffed, vsOwnBot, kind: 'play'|'live'|'multi'}
   */
  fromTable(username, ctx) {
    const ids = ['table_first'];
    if (ctx.bluffed) ids.push('human_bluff');
    if (ctx.won) {
      if (ctx.vsOwnBot) ids.push('beat_own_bot');
      if (ctx.kind === 'live') ids.push('table_win');
      if (ctx.kind === 'multi') ids.push('multi_win');
    }
    return this.unlock(username, ids);
  }
}

module.exports = { AchievementBook, ACHIEVEMENTS, CATEGORIES, scanSource, commentsOf };
