/**
 * stress — hostile-bot battery for the camp ladder.
 *
 *   node server/stress.js
 *
 * Kids write broken code; some of it will be broken in creative ways. The
 * question this answers is NOT "does the bot crash" (crashing is fine and
 * expected — ScriptBot catches every throw and falls back). It is:
 *
 *   1. can a bot kill the ladder?      playSeries must never throw
 *   2. can a bot hang the ladder?      a series must finish in bounded time
 *   3. can a bot corrupt a replay?     stored games must re-simulate exactly
 *   4. can a bot escape the sandbox?   no host objects, no engine mutation
 *
 * Any FAIL here is a bug worth fixing before camp. Errors counted in the
 * "errors" column are the healthy path, not a failure.
 */
'use strict';

const { ScriptBot, checkProgram } = require('./botapi');
const { playSeries, replayMatch } = require('./runner');
const { HOUSE } = require('./samplebots/bots');

const GAMES = 10;               // per hostile bot
const TIME_BUDGET_MS = 15000;   // a 10-game series must finish inside this

/**
 * A legal, boring your_turn. Specimens that target some OTHER entry point
 * must include it, or checkProgram stops at "with 10+ coins you must coup"
 * and the pathology under test is never reached — which is exactly the trap
 * an earlier version of this file fell into.
 */
const SANE_TURN = `
def your_turn(state):
    if state.my_coins >= 7:
        return coup(best_coup_call(state))
    return income()
`;

// ------------------------------------------------------------ the specimens
const SPECIMENS = [
  // --- crashes in each entry point (all five, not just your_turn) ---
  { name: 'throws in your_turn', src: `
def your_turn(state):
    if state.my_coins >= 5:
        return coup(state.my_cards[99])
    return income()
` },
  { name: 'throws in respond', src: SANE_TURN + `
def respond(state, action):
    return allow(1 / 0)
` },
  { name: 'throws in when_assassinated', src: SANE_TURN + `
def when_assassinated(state, action):
    return block_contessa(state.nope.nope)
` },
  { name: 'throws in choose_card_to_lose', src: SANE_TURN + `
def choose_card_to_lose(state):
    return reveal(state.my_cards[404])
` },
  { name: 'throws in choose_exchange', src: `
def your_turn(state):
    if state.my_coins >= 7:
        return coup(best_coup_call(state))
    return exchange()
def choose_exchange(state, pool):
    return pool[999]
` },

  // --- resource abuse ---
  { name: 'infinite loop', src: `
def your_turn(state):
    while True:
        pass
` },
  { name: 'deep recursion', src: `
def boom(n):
    return boom(n + 1)
def your_turn(state):
    return boom(0)
` },
  { name: 'giant list', src: `
def your_turn(state):
    xs = []
    while len(xs) < 10000000:
        xs.append("duke")
    return income()
` },
  { name: 'giant string', src: `
def your_turn(state):
    s = "x"
    i = 0
    while i < 1000:
        s = s + s
        i = i + 1
    return income()
` },
  { name: 'slow but legal (heavy loop each turn)', src: `
def your_turn(state):
    total = 0
    i = 0
    while i < 20000:
        total = total + prob_opponent_has(state, "duke")
        i = i + 1
    return income()
` },

  // --- sandbox probes ---
  { name: 'reach host via prototype', src: `
def your_turn(state):
    c = state.constructor
    return c()
` },
  { name: 'reach host via __proto__', src: `
def your_turn(state):
    p = state.__proto__
    return p.constructor("return process")()
` },
  { name: 'mutate engine claims (live reference)', src: `
def your_turn(state):
    state.my_claims.append("duke")
    state.my_claims.append("contessa")
    if state.my_coins >= 7:
        return coup(best_coup_call(state))
    return income()
` },
  { name: 'mutate own hand', src: `
def your_turn(state):
    state.my_cards.append("duke")
    state.my_cards.append("duke")
    if state.my_coins >= 7:
        return coup(best_coup_call(state))
    return tax()
` },
  { name: 'index-assign into state', src: `
def your_turn(state):
    state["my_coins"] = 999999
    if state.my_coins >= 7:
        return coup(best_coup_call(state))
    return income()
` },

  // --- protocol abuse ---
  { name: 'illegal action (no coins)', src: `
def your_turn(state):
    return coup("duke")
` },
  { name: 'returns None everywhere', src: `
def your_turn(state):
    return None
def respond(state, action):
    return None
def choose_card_to_lose(state):
    return None
` },
  { name: 'names a role that does not exist', src: `
def your_turn(state):
    if state.my_coins >= 7:
        return coup("captain")
    return income()
` },
];

// ------------------------------------------------------------ the harness
const house = () => ({ bot: new ScriptBot(HOUSE[0].source, 'House'), name: 'House' });
const rows = [];
let fails = 0;

for (const spec of SPECIMENS) {
  const row = { name: spec.name, check: '—', errors: 0, ms: 0, verdict: 'PASS', note: '' };

  let bot;
  try {
    bot = new ScriptBot(spec.src, 'Hostile');
  } catch (err) {
    row.check = 'compile-blocked';
    row.note = err.message.slice(0, 60);
    rows.push(row);
    continue;
  }

  const chk = checkProgram(spec.src);
  row.check = chk.ok ? 'PASSES submit' : 'blocked at submit';
  // the reason matters as much as the verdict: a bot blocked for the WRONG
  // reason means a camper gets a misleading message
  if (!chk.ok && chk.problems.length) row.why = chk.problems[0].message;

  // 1 + 2: the ladder must survive it, in bounded time
  const t0 = Date.now();
  let r;
  try {
    r = playSeries({
      botA: { bot, name: 'Hostile' }, botB: house(),
      total: GAMES, seedBase: 20260817,
    });
  } catch (err) {
    row.verdict = 'FAIL';
    row.note = 'playSeries threw: ' + err.message.slice(0, 50);
    row.ms = Date.now() - t0;
    rows.push(row); fails++;
    continue;
  }
  row.ms = Date.now() - t0;
  row.errors = r.errors['Hostile'] || 0;

  if (row.ms > TIME_BUDGET_MS) {
    row.verdict = 'FAIL';
    row.note = `took ${(row.ms / 1000).toFixed(1)}s for ${GAMES} games — ladder stalls`;
    fails++;
  }

  // 3: every stored sample must re-simulate to the same winner
  for (const s of r.samples) {
    const rep = replayMatch(s);
    if (rep.winnerName !== s.winnerName) {
      row.verdict = 'FAIL';
      row.note = `replay mismatch on game ${s.g}: stored ${s.winnerName}, replayed ${rep.winnerName}`;
      fails++;
      break;
    }
  }

  // 4: sanity on the games themselves — a corrupted engine shows up as
  // impossible outcomes (nobody won, or a winner who never played)
  const total = r.winsByName['Hostile'] + r.winsByName['House'];
  if (total !== GAMES) {
    row.verdict = 'FAIL';
    row.note = `${total}/${GAMES} games produced a winner`;
    fails++;
  }

  rows.push(row);
}

// ------------------------------------------------------------ report
const pad = (s, n) => String(s).padEnd(n);
console.log('\n  hostile bot                              submit            errors    ms   verdict');
console.log('  ' + '-'.repeat(92));
for (const r of rows) {
  console.log(`  ${pad(r.name, 40)} ${pad(r.check, 18)} ${String(r.errors).padStart(6)} ${String(r.ms).padStart(5)}   ${r.verdict}`
    + (r.why ? `\n      ↳ says: "${r.why}"` : '')
    + (r.note ? `\n      ↳ ${r.note}` : ''));
}
console.log('\n  ' + (fails === 0
  ? `all ${rows.length} specimens contained — the ladder survived every one`
  : `${fails} FAILURE(S) out of ${rows.length} — see notes above`) + '\n');

process.exit(fails === 0 ? 0 : 1);
