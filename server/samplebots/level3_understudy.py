# LEVEL 3 — THE UNDERSTUDY
#
# Andrew's apprentice. Knows three things Megan does not, and is still missing
# the three that make Andrew the final boss.
#
# WHAT IT LEARNED FROM ANDREW (this is the step up from Level 2):
#   1. IT LIES. Megan never bluffs, so once you know that, every claim she
#      makes is free information. The Understudy taxes without a Duke — but at
#      a flat rate, not a priced one.
#   2. IT PUNISHES A BLUFFED BLOCK. Foreign Aid gets blocked with a Duke it
#      may not have, and an assassination it did not want to eat gets a
#      Contessa claim challenged.
#   3. IT KEEPS ITS STORY STRAIGHT. Cards it has already claimed are the ones
#      it gives up, so its claims stay consistent with its hand.
#
# WHAT IT STILL DOES NOT KNOW (this is what Level 4 adds):
#   - HOW TO PRICE A LIE. It bluffs at a flat 30% whatever the table looks
#      like. Andrew bluffs most when copies are unaccounted for and clams up
#      against someone who challenges — that difference is most of the gap.
#   - WHO IT IS PLAYING. It never looks at series stats, so it treats a
#      trigger-happy challenger exactly like someone who has never challenged
#      once in ninety games. Andrew measures you for three games and then
#      plays the person, not the position.
#   - WHEN TO SHUT UP. It has no idea it has been caught. Andrew stops lying
#      after three catches; the Understudy will happily be caught nine times
#      claiming the same Duke.
#   - WHEN TO CHANGE THE SUBJECT. Exchanging wipes every claim it has made,
#      which is the one move that makes a repeated lie survivable. It only
#      bothers one time in five. Raising that single number is worth about ten
#      points against a bot that counts your claims — find it and you have
#      found most of the gap to Level 4.
#
# Beat it by being the kind of opponent it cannot model: challenge it early
# and often, and it will keep walking into you.

def your_turn(state):
    call = best_coup_call(state)
    if state.my_coins >= 10:
        return coup(call)
    if state.my_coins >= 7:
        # a called coup is only worth 7 coins if the name is likely to land
        if prob_opponent_has(state, call) >= 0.35:
            return coup(call)
    # the audit, inherited from Megan: strike when a Contessa is unlikely,
    # then challenge the block that turns up anyway
    if state.my_coins >= 3 and "assassin" in state.my_cards:
        pc = prob_opponent_has(state, "contessa")
        if pc <= 0.45:
            return assassinate(call, 0.8)
    if "duke" in state.my_cards:
        return tax()
    if "ambassador" in state.my_cards and state.my_claims != [] and chance(0.2):
        # Wipe the record before anyone tests it — but only sometimes, because
        # it does not really understand WHY this matters. Exchanging clears
        # every claim it has made; against someone who punishes a repeated
        # claim, that is the difference between a story and a confession.
        return exchange()
    # COMMIT TO THE STORY. An honest Duke taxes every single turn, so claiming
    # one and then quietly stopping is its own tell. Having already said it,
    # keep saying it. This comes AFTER the exchange above on purpose: changing
    # the subject is better than doubling down, when it can manage it.
    if "duke" in state.my_claims:
        return tax()
    # THE LIE — flat 30%, and only while a Duke is still unaccounted for.
    # Andrew would price this off how much is unseen and who is watching.
    if unseen_copies(state, "duke") > 0 and chance(0.3):
        return tax()
    if prob_opponent_has(state, "duke") < 0.45 and times_claimed(state.opponent, "duke") == 0:
        return foreign_aid()
    return income()

def respond(state, action):
    if action.claimed_role != None:
        # a claim nobody can possibly hold is a free card
        if unseen_copies(state, action.claimed_role) <= 0:
            return challenge()
        # challenging a BLOCK is double value: the card and the action
        if action.is_block and chance(0.35):
            return challenge()
    if action.type == "foreign_aid":
        if "duke" in state.my_cards:
            return block("duke")
        if unseen_copies(state, "duke") > 0 and chance(0.3):
            return block("duke")
    return allow()

def when_assassinated(state, action):
    # a name that is not in my hand misses on its own — never pay for that
    if not (action.call in state.my_cards):
        return allow()
    if "contessa" in state.my_cards:
        return block_contessa()
    if state.my_lives <= 1:
        return block_contessa()
    if unseen_copies(state, "contessa") > 0 and chance(0.45):
        return block_contessa()
    return allow()

def choose_card_to_lose(state):
    return reveal(claimed_card(state))

def choose_exchange(state, pool):
    return strongest_cards(pool, ["duke", "assassin", "contessa", "ambassador"], state.my_num_cards)
