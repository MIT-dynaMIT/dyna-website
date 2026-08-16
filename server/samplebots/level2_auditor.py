# LEVEL 2 — GREG FROM ACCOUNTING
#
# Greg never lies. Greg also never forgets. Every claim you make goes in
# the spreadsheet, and false filings get penalized.
#
# STRATEGIES USED (5):
#   1. Honest economy on real odds. Tax only with a real Duke; Foreign Aid
#      only while a Duke block is unlikely; coup at 7.
#   2. COUNT THE CARDS. Coups name the most likely card, not a guess.
#   3. CHALLENGE ONLY THE IMPOSSIBLE. If every copy of a claimed role is
#      already visible, the claim is a certain lie — challenging is free.
#   4. THE AUDIT. An assassination is a 3-coin penalty notice: filed only
#      when the named card is probably there AND a real Contessa probably
#      is not. If a Contessa appears anyway, Greg usually challenges it —
#      a bluffed Contessa then costs TWO cards. Lying to an auditor is
#      expensive.
#   5. Never spend a block on a shot that already misses.
#
# DELIBERATELY DOES NOT KNOW (this is what Level 3 adds):
#   - how to bluff, and when a bluff can be disproved
#   - how to read one opponent's habits over a long series
#   - that always naming the same card on a tie makes you predictable
#   - that a doubled pair is armour against called shots

def your_turn(state):
    call = best_coup_call(state)
    if state.my_coins >= 7:
        return coup(call)
    # the audit: if the named card is probably there and a Contessa
    # probably is not, 3 coins buys a very expensive lie
    if state.my_coins >= 3 and "assassin" in state.my_cards:
        if prob_opponent_has(state, call) >= 0.55 and prob_opponent_has(state, "contessa") <= 0.55:
            return assassinate(call, 0.95)
    if "duke" in state.my_cards:
        return tax()
    if "ambassador" in state.my_cards and chance(0.25):
        return exchange()
    if prob_opponent_has(state, "duke") >= 0.5:
        return income()
    return foreign_aid()

def respond(state, action):
    if action.claimed_role != None:
        if unseen_copies(state, action.claimed_role) == 0:
            return challenge()
    if action.type == "foreign_aid" and "duke" in state.my_cards:
        return block("duke")
    return allow()

def when_assassinated(state, action):
    # the shot misses by itself — save the Contessa claim
    if not (action.call in state.my_cards):
        return allow()
    if "contessa" in state.my_cards:
        return block_contessa()
    return allow()

def choose_card_to_lose(state):
    return reveal(claimed_card(state))

def choose_exchange(state, pool):
    return strongest_cards(pool, ["duke", "assassin", "contessa", "ambassador"], state.my_num_cards)
