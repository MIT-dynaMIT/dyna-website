# Victor bot #1 (ex-Hybrid) — archived 2026-08-15 when the ladder moved to the three graded house bots.
# Exchange-dodger: income/FA economy, ambassador dodge when coup-threatened, rationed dodging, is_safe keeps.

def dodge_order():
    return ["ambassador", "contessa", "duke", "assassin"]

def is_safe(state):
    for card in state.my_cards:
        if card != "ambassador" and card != "contessa":
            return False
    return True

def your_turn(state):
    call = best_coup_call(state)
    p_hit = prob_opponent_has(state, call)
    if state.my_coins >= 10:
        return coup(call)
    if state.my_coins >= 7 and p_hit >= 0.5:
        return coup(call)
    if state.opponent.coins >= 6 and not is_safe(state) and state.my_coins < 7:
        return exchange()
    if "assassin" in state.my_cards and state.my_coins >= 3 and p_hit >= 0.7:
        return assassinate(call, 0.35)
    if "duke" in state.my_cards:
        return tax()
    if "duke" in state.opponent.claims:
        return income()
    return foreign_aid()

def respond(state, action):
    if action.claimed_role != None and unseen_copies(state, action.claimed_role) == 0:
        return challenge()
    if action.type == "foreign_aid" and "duke" in state.my_cards:
        return block("duke")
    return allow()

def when_assassinated(state, action):
    if not (action.call in state.my_cards):
        return allow()
    if "contessa" in state.my_cards:
        return block_contessa()
    if state.my_lives <= 2 or chance(0.5):
        return block_contessa()
    return allow()

def choose_card_to_lose(state):
    return reveal(claimed_card(state))

def choose_exchange(state, pool):
    if state.opponent.coins >= 6:
        return strongest_cards(pool, dodge_order(), state.my_num_cards)
    return strongest_cards(pool, ["duke", "contessa", "assassin", "ambassador"], state.my_num_cards)
