# LEVEL 2 — VICTOR V2
#
# Victor saw what the campers were building and took a weekend to practice.
# This is still recognizably the starter bot — same bones — but with the
# four upgrades a sharp student makes first. Beatable with real thought;
# never a pushover.
#
# UPGRADES OVER V1 (the starter):
#   0. THE DODGE — his own old bot's signature move, remembered.
#   1. Smarter money: Foreign Aid when a Duke block is unlikely.
#   2. No blind Contessa bluff: block a would-hit shot only with the real
#      card (or a rare gamble); never waste a block on a miss.
#   3. Free challenges: call claims that are impossible from card counting.
#   4. Tidier discards: give up the card he's already claimed, so his
#      story stays straight.
#
# STILL MISSING (what Megan and Andrew add):
#   - the assassination "audit" (Megan)
#   - reading one opponent's habits, jittered calls, pair armour (Andrew)

def your_turn(state):
    if state.my_coins >= 7:
        return coup(best_coup_call(state))
    # THE DODGE (his old bot's trick): they can coup next turn and my
    # hand still matches my claims — shuffle it out from under their
    # best guess. Exchanging resets my claims, so he never dodge-locks.
    if state.opponent.coins >= 7 and "ambassador" in state.my_cards:
        if len(cards_in(state.my_cards, state.me.claims)) > 0:
            return exchange()
    if "duke" in state.my_cards:
        return tax()
    if "ambassador" in state.my_cards and chance(0.2):
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
    # a shot naming a card I don't hold misses by itself
    if not (action.call in state.my_cards):
        return allow()
    if "contessa" in state.my_cards:
        return block_contessa()
    # the old always-bluff cost V1 dearly — now it's a rare gamble
    if chance(0.25):
        return block_contessa()
    return allow()

def choose_card_to_lose(state):
    return reveal(claimed_card(state))

def choose_exchange(state, pool):
    return strongest_cards(pool, ["ambassador", "contessa", "duke", "assassin"], state.my_num_cards)
