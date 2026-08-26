/**
 * Sample students + bots for HEADS-UP Ultimate Coup, written in botlang.
 * Doubles as an end-to-end exercise of the interpreter + the new call/math
 * vocabulary. THE_SCAFFOLD is the commented starter kids begin from.
 */
'use strict';

const S = (s) => s.replace(/^\n/, '').replace(/^    /gm, '');

// ------------------------------------------------------------ kid scaffold
const THE_SCAFFOLD = S(`
    # ================= MY COUP BOT =================
    # your_turn runs on your turn. Return exactly ONE action:
    #   income() foreign_aid() tax() exchange()
    #   coup(role)              <- CALL the coup: name the card you think they have!
    #   assassinate(role, p)    <- name a card; p = chance you challenge a Contessa block
    # Useful math: prob_opponent_has(state, "duke")  best_coup_call(state)

    def your_turn(state):
        # at 10+ coins you MUST coup. 7+ is usually worth it anyway.
        if state.my_coins >= 7:
            return coup(best_coup_call(state))
        # play your real cards
        if "duke" in state.my_cards:
            return tax()
        # otherwise: quiet money
        return income()

    def respond(state, action):
        # your opponent did something. challenge() / block(role) / allow()
        if action.type == "foreign_aid" and "duke" in state.my_cards:
            return block("duke")
        return allow()

    def when_assassinated(state, action):
        # they named action.call — if that card is NOT in your hand, it will
        # MISS all by itself. Don't waste a block on a miss!
        if not (action.call in state.my_cards):
            return allow()
        if "contessa" in state.my_cards:
            return block_contessa()
        # no contessa... bluff one anyway? change this and see what happens!
        return block_contessa()

    def choose_card_to_lose(state):
        return reveal(state.my_cards[0])
`);

// ------------------------------------------------------------ house bots
// The three graded house bots — Victor's other-session baselines. They live
// as real .py files next to this module so they can be diffed and tuned like
// any student bot. Victor bot #1 and #2 are retired to ./archive/.
const fs = require('node:fs');
const path = require('node:path');
const py = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

const HOUSE = [
  // level 1 IS the starter scaffold — beat yourself before anyone else
  // (Victor V2 — the dodge — is retired to ./archive/)
  { name: 'Victor', source: THE_SCAFFOLD },
  { name: 'Megan',  source: py('level2_auditor.py') },
  // measured to sit between them: beats Megan 56-61%, loses to Andrew 56-62%
  // across four independent 400-game seeds
  { name: 'Nishita', source: py('level3_understudy.py') },
  // Andrew is back to THE ARBITER v1 — the build Dom Dang beat. v2 (the
  // rebuild that went 0-for-830 against the field) is in ./archive/ as
  // arbiter_v2_ultimate.py if the boss ever needs its teeth back.
  { name: 'Andrew', source: py('arbiter_v1.py') },
];

module.exports = { HOUSE, THE_SCAFFOLD };
