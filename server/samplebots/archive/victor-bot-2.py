# Victor bot #2 (ex-Equilibrist) — archived 2026-08-15 when the ladder moved to the three graded house bots.
# Adaptive series bot: Nash-ish base, explore-then-exploit on per-game rate stats, under-the-radar bluff caps.

# Victor bot #2 — plays the equilibrium, then punishes your mistakes.
def suspicion(state, who, role):
    if unseen_copies(state, role) == 0:
        return 9
    s = who.series_caught_per_game * 1.5 + who.times_caught_bluffing * 0.2
    s = s + len(who.claims) * 0.1
    s = s + (1 - prob_opponent_has(state, role)) * 0.5
    reps = times_claimed(who, role)
    if reps > 1:
        s = s + (reps - 1) * 0.05
    return s

def warmed(state):
    # explore first: trust series reads only after 20 games of evidence
    return state.series.game > 20

def your_turn(state):
    call = best_coup_call(state)
    p_hit = prob_opponent_has(state, call)
    opp = state.opponent
    if state.my_coins >= 10:
        return coup(call)
    if state.my_coins >= 8 and p_hit >= 0.35:
        return coup(call)
    a_chal = 0.35
    if warmed(state) and opp.series_contessa_rate > 0.6:
        a_chal = 0.7
    if "assassin" in state.my_cards and state.my_coins >= 3 and p_hit >= 0.85:
        return assassinate(call, a_chal)
    if "duke" in state.my_cards:
        return tax()
    if "ambassador" in state.my_cards and not ("duke" in state.my_cards) and chance(0.3):
        return exchange()
    # EXPLOIT a proven non-challenger: free tax — but stay under the
    # radar (cap repeats per game) and stop if I keep getting caught
    if warmed(state) and opp.series_challenges_per_game < 0.25:
        if state.me.series_caught_bluffing < 3 and times_claimed(state.me, "duke") < 5:
            return tax()
    # RESPECT an over-challenger: never bluff, quiet money only
    if warmed(state) and opp.series_challenges_per_game > 2.2:
        if "duke" in opp.claims and not ("duke" in state.my_cards):
            return income()
        return foreign_aid()
    if state.turn_number >= 6 and opp.challenges_made == 0:
        return tax()
    if chance(0.15):
        return tax()
    if "duke" in opp.claims and not ("duke" in state.my_cards):
        return income()
    return foreign_aid()

def respond(state, action):
    if action.claimed_role != None:
        th = 1.0
        if warmed(state) and state.opponent.series_caught_per_game >= 0.15:
            th = th - 0.3
        if suspicion(state, state.opponent, action.claimed_role) > th:
            return challenge()
    if action.type == "foreign_aid" and "duke" in state.my_cards:
        return block("duke")
    return allow()

def when_assassinated(state, action):
    if not (action.call in state.my_cards):
        return allow()
    return block_contessa()

def choose_card_to_lose(state):
    return reveal(claimed_card(state))
