# LEVEL 1 — THE APPRENTICE
#
# The whole bot is ONE idea: play honestly and buy a coup when you can afford
# one. Every line here is correct Coup — it simply does not know very much yet.
#
# STRATEGIES USED (1):
#   1. Honest economy. Claim the Duke only when I really hold one, otherwise
#      take the safe +1, and spend 7 on a coup the moment I have it.
#
# DELIBERATELY DOES NOT KNOW (this is what Level 2 adds):
#   - which character to name (it always guesses "duke")
#   - how to count the cards nobody has seen
#   - when a claim is impossible and should be challenged
#   - that a coup naming a card you do not hold misses all by itself

def your_turn(state):
    # 10+ coins and the rules force a coup, so this must come first
    if state.my_coins >= 7:
        return coup("duke")
    if "duke" in state.my_cards:
        return tax()
    return income()

def respond(state, action):
    # trusting: never challenges, and only blocks with a card it truly holds
    if action.type == "foreign_aid" and "duke" in state.my_cards:
        return block("duke")
    return allow()

def when_assassinated(state, action):
    if "contessa" in state.my_cards:
        return block_contessa()
    return allow()

def choose_card_to_lose(state):
    return reveal(state.my_cards[0])
