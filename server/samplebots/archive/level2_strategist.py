# LEVEL 2 — THE STRATEGIST
#
# Everything the Apprentice does, plus the four ideas that come from actually
# reading the table. It still never tells a lie and never studies its
# opponent — it just plays the cards correctly.
#
# STRATEGIES USED (5):
#   1. Honest economy                                    (from Level 1)
#   2. COUNT THE CARDS. Name the character most likely to be in their hand
#      instead of guessing, using the copies nobody has seen yet.
#   3. CHALLENGE ONLY THE IMPOSSIBLE. If every copy of the claimed role is
#      already in my hand or face-up in a graveyard, the claim is a certain
#      lie and challenging is free. Otherwise never challenge: a role sits in
#      a 2-card hand about 53% of the time, so a hunch is a losing bet.
#   4. DO NOT PAY FOR A BLOCK YOU DO NOT NEED. A coup or assassination that
#      names a card I do not hold misses on its own, so blocking would spend
#      a Contessa claim to stop something that was never going to land.
#   5. INCOME vs FOREIGN AID ON THE REAL ODDS. Foreign Aid pays 2 * P(no Duke
#      block); once a block is better than even, the guaranteed +1 is worth more.
#
# DELIBERATELY DOES NOT KNOW (this is what Level 3 adds):
#   - how to bluff safely, and when a bluff can be disproved
#   - how to read one opponent over a long series
#   - that always naming the same role on a tie makes you predictable
#   - that a pair is armour, because only one name can hit a doubled hand

def your_turn(state):
    call = best_coup_call(state)
    if state.my_coins >= 7:
        return coup(call)
    if "duke" in state.my_cards:
        return tax()
    if "ambassador" in state.my_cards and chance(0.3):
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
