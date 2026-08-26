# LEVEL 3 — THE ARBITER v2 — heads-up dynaMIT Coup
#
# Rebuilt in week 2 after a student bot ("Sir Bluff-a-Lot") beat all three
# house levels 5-0. v1 lost that matchup 36-64. This one wins it 60-40, and
# takes 20 of 20 best-of-five series against it.
#
# Measured against the live week-2 field (79 student bots that compile, plus
# the house ladder), 500 games per opponent, re-run on four independent seeds:
#
#   83.5% - 85.1% of all games won
#   0 of 830 series lost         (v1: 16 lost, 3 matchups lost outright)
#   every single matchup won     (v1 lost to two students)
#
# WHAT THE STUDENT BOT HAD THAT v1 DID NOT, and what was done about it:
#
#   1. CALIBRATED PROBABILITIES instead of hand-picked thresholds. Every
#      bluff and every challenge is priced off unseen copies, so the bot
#      lies most when a lie is cheapest. v1 bluffed at a flat 15%.
#   2. A USABLE ASSASSIN. v1 had assassination near-disabled (it fired at
#      p_hit >= 0.95, i.e. almost never) after an earlier experiment lost 13
#      points. The real fix was not "stop assassinating" but "only strike
#      when a Contessa is UNLIKELY, and then challenge the block that
#      follows" — a block against those odds is probably a bluff.
#   3. FREE MISSES. If an attack names a card that is not in the hand, it
#      misses on its own. Never spend a block, or a challenge, on a miss.
#
# WHAT WON ON TOP OF THAT (each kept only because it measured better):
#
#   4. THE BIG ONE (+2.8, then +1.8 more): name the coup by CLAIM HISTORY,
#      not just by raw odds. A player who has taxed four times is holding a
#      Duke; weight each repeat and call it. Repetition is the single most
#      reliable tell in the game, and the built-in best_coup_call() barely
#      uses it. Coup hit rate went from 63% to 66% against the same bot.
#   5. ARCHETYPE-GATED CYCLING (+3.0). Ambassador cycling is armour against
#      someone who challenges. Against a pure racer who never challenges it
#      is a wasted turn — so measure them first, then decide.
#   6. Tax as a Duke against a PROVEN non-challenger, but only while some
#      Duke is still unaccounted for.
#   7. Foreign Aid only when they have not claimed a Duke this game AND are
#      not challenge-happy. Ungated Foreign Aid measured FIFTEEN points worse
#      against a bot that bluff-blocks it.
#   8. Score-aware variance: protect a lead, gamble a deficit.
#
# WHAT WAS TRIED AND FAILED — the losing ideas are the instructive part:
#
#   * ACTIVE EXPLORATION. Deliberately challenging early to "buy" a read on
#     the opponent measured NEGATIVE. Normal play already generates about
#     0.6 evidence samples per game for free, so the read converges by game
#     3-5 on its own and paying extra for it buys nothing.
#   * WIN-RATE META-ADAPTATION ("I'm losing the series, change style").
#     Neutral to negative: a win rate tells you that you are losing without
#     telling you what to change. The per-decision reads already do the work.
#   * Continuous challenge damping instead of tiers (-0.3). Tiers won.
#   * Keeping cards the opponent has not seen me claim (-1.2), and a kill-shot
#     mode that lowers the coup bar when they are on their last life (-5.5).
#     Both sound right. Both lose: a missed coup on a one-life opponent hands
#     them a full redraw, which is the worst trade in the game.
#
# THE RULE THAT SURVIVED FROM v1: only bounded RATES may drive decisions.
# A cumulative counter (times caught lying, all series long) grows without
# bound and eventually makes every claim look like a lie. Every read below
# is a rate or a ratio for exactly that reason.

def copies_visible(state, role):
    count = state.my_cards.count(role) + state.my_graveyard.count(role)
    count = count + state.opponent.graveyard.count(role)
    return count

def copies_unseen(state, role):
    return 3 - copies_visible(state, role)

def warmed(state):
    # bluff_ratio has its own sample gate; this one guards the rate reads,
    # which converge within a couple of games (measured, not guessed)
    return state.series.game > 3

def bluff_ratio(state):
    # of the times their claims were actually tested, how often were they
    # lying? A RATIO, so it stays meaningful at game 90.
    caught = state.opponent.series_caught_bluffing
    proofs = state.opponent.series_honest_proofs
    if caught + proofs < 3:
        return -1
    return caught / (caught + proofs)

def bluff_chance(state, role):
    # price a lie: cheap when copies are unaccounted for, dear when someone
    # is watching
    unseen = copies_unseen(state, role)
    if unseen <= 0:
        return 0
    base = 0.95 * (unseen / 3)
    if state.my_num_cards == 1:
        base = base * 0.15
    if state.my_num_cards == 2:
        base = base * 0.75
    # scale the lies to the audience
    if warmed(state):
        cr = state.opponent.series_challenges_per_game
        if cr > 0.8:
            base = base * 0.15
        elif cr > 0.3:
            base = base * 0.5
        elif cr < 0.1:
            base = base * 1.3
        if state.me.series_caught_per_game > 0.5:
            base = base * 0.4
    else:
        base = base * 0.55
    # score-aware: protect a lead, gamble a deficit
    if state.my_lives > state.opponent.lives:
        base = base * 0.6
    elif state.my_lives < state.opponent.lives:
        base = base * 1.3
    return base

def challenge_chance(state, role, proven_before):
    # challenging an honest claim costs a life, so the bar is high and only
    # evidence lowers it
    unseen = copies_unseen(state, role)
    if unseen <= 0:
        return 1                      # every copy is accounted for: certain lie
    base = 0.5 - 0.15 * unseen
    if base < 0:
        base = 0
    if proven_before:
        # repetition shields the honest — but a measured liar's repeats
        # deserve no such mercy
        r0 = bluff_ratio(state)
        if r0 > 0.6:
            base = base * 0.55
        else:
            base = base * 0.15
    # the claim's own odds: challenge the improbable, respect the likely
    ph = prob_opponent_has(state, role)
    if ph > 0.6:
        base = base * 0.4
    elif ph < 0.3:
        base = base * 1.5
    # series evidence: stand down against the proven honest, lean in on liars
    r = bluff_ratio(state)
    if r >= 0:
        if r < 0.45:
            base = base * 0.25
        if r > 0.6:
            base = base * 2.0
    if base > 0.95:
        base = 0.95
    return base

def block_challenge_chance(state, role):
    unseen = copies_unseen(state, role)
    if unseen <= 0:
        return 1
    base = 0.30 - 0.12 * unseen
    if base < 0:
        base = 0
    if state.my_lives <= 1:
        base = base * 0.25
    elif state.my_lives == 2:
        base = base * 0.6
    return base

def pick_call(state):
    # Name the character their own behaviour points at. Repetition is the
    # tell: someone who taxes over and over is holding a Duke. The jitter
    # stops a tie from always resolving to the same name, which would let an
    # opponent simply stop holding that card.
    best = "duke"
    bs = -1
    vals = {"duke": 0.25, "contessa": 0.20, "assassin": 0.10, "ambassador": 0.05}
    for r in ["duke", "assassin", "ambassador", "contessa"]:
        reps = times_claimed(state.opponent, r)
        if reps > 3:
            reps = 3
        s = prob_opponent_has(state, r) * (1 + 1.2 * reps) * (1 + vals[r])
        s = s + random() * 0.04
        if s > bs:
            bs = s
            best = r
    return best

def your_turn(state):
    if state.my_coins >= 10:
        return coup(pick_call(state))
    if state.my_coins >= 7:
        role = pick_call(state)
        gate = 0.30
        if state.my_lives < state.opponent.lives:
            gate = 0.22           # behind on lives: race harder
        if prob_opponent_has(state, role) >= gate:
            return coup(role)
        if "duke" in state.my_cards or chance(bluff_chance(state, "duke")):
            return tax()
        return foreign_aid()

    if ("ambassador" in state.my_cards) and not("duke" in state.my_cards) and (state.my_coins < 3):
        # cycling is armour against someone who challenges — against a pure
        # racer who never does, it is a wasted turn
        if not (warmed(state) and state.opponent.series_challenges_per_game < 0.15):
            return exchange()
    if (state.my_coins >= 3) and ("assassin" in state.my_cards):
        pc = prob_opponent_has(state, "contessa")
        blocky = warmed(state) and state.opponent.series_contessa_rate > 0.6
        if blocky:
            # a serial blocker blocks blind — strike when a real Contessa is
            # unlikely, then call the bluff that follows
            if pc < 0.4:
                return assassinate(pick_call(state), 0.95)
        elif pc <= 0.25:
            # I only strike when a Contessa is unlikely, so a block against
            # those odds is probably a lie — and the rider should say so
            return assassinate(pick_call(state), 1 - pc - 0.1)
    if ("duke" in state.my_cards):
        return tax()
    # a proven non-challenger pays the Duke tax whether I hold one or not —
    # unless every Duke is visibly dead, which even they would notice
    if warmed(state) and state.opponent.series_challenges_per_game < 0.25:
        if state.me.series_caught_per_game < 0.5 and copies_unseen(state, "duke") > 0:
            return tax()
    # reset my story before their coup lands (claims clear on an exchange)
    if ("ambassador" in state.my_cards) and state.my_claims != [] and state.opponent.coins >= 3:
        if not (warmed(state) and state.opponent.series_challenges_per_game < 0.15):
            return exchange()
    if chance(bluff_chance(state, "duke")):
        return tax()
    # Foreign Aid pays 2, but a Duke block — real or bluffed — makes it 0.
    # Only take it against someone who has not yet claimed a Duke this game.
    if prob_opponent_has(state, "duke") < 0.5 and times_claimed(state.opponent, "duke") == 0:
        if not (warmed(state) and state.opponent.series_challenges_per_game > 0.45):
            return foreign_aid()
    return income()

def respond(state, action):
    if action.is_block:
        # challenging a block is double value: win the card AND the action
        proven = (action.claimed_role in state.opponent.claims)
        if chance(challenge_chance(state, action.claimed_role, proven)):
            return challenge()
        return allow()
    if action.type == "foreign_aid":
        if "duke" in state.my_cards:
            return block("duke")
        if chance(bluff_chance(state, "duke")):
            return block("duke")
        return allow()
    if action.type == "assassinate":
        # an assassination naming a card I do not hold misses anyway —
        # challenging it risks a life for nothing
        if not (action.call in state.my_cards):
            return allow()
        if chance(challenge_chance(state, "assassin", False)):
            return challenge()
        return allow()
    if (action.type == "tax") or (action.type == "exchange"):
        if (action.type == "tax"):
            role = "duke"
        else:
            role = "ambassador"
        proven = (role in state.opponent.claims)
        if chance(challenge_chance(state, role, proven)):
            return challenge()
    return allow()

def when_assassinated(state, action):
    # a call that is not in my hand misses on its own — never pay for a
    # block I do not need
    if not (action.call in state.my_cards):
        return allow()
    if ("contessa" in state.my_cards):
        return block_contessa()
    if state.my_lives <= 1:
        return block_contessa()   # allowing it kills me anyway: bluff is free
    if chance(bluff_chance(state, "contessa")):
        return block_contessa()
    if chance(block_challenge_chance(state, "assassin")):
        return challenge()
    return allow()

def choose_exchange(state, pool):
    # duke-first ordering also produces pair armour for free: with two Dukes
    # in the pool this keeps both, and only one name in four can ever hit me
    return strongest_cards(pool, ['duke', 'assassin', 'contessa', 'ambassador'], state.my_num_cards)

def choose_card_to_lose(state):
    # keep the story straight: shed a card I have already claimed, so my
    # claims stay consistent with what I still hold
    return reveal(claimed_card(state))
