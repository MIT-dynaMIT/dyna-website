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

const HONEST_PLUS = S(`
    # plays honest, dodges misses, bluffs only the Contessa when it matters
    def your_turn(state):
        if state.my_coins >= 7:
            return coup(best_coup_call(state))
        if "assassin" in state.my_cards and state.my_coins >= 3:
            if prob_opponent_has(state, best_coup_call(state)) > 0.5:
                return assassinate(best_coup_call(state), 0.25)
        if "duke" in state.my_cards:
            return tax()
        return foreign_aid()

    def respond(state, action):
        if action.claimed_role != None and state.revealed_roles[action.claimed_role] >= 3:
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
`);

const BOTS = [
  { username: 'hank', displayName: 'Honest Hank', botName: 'HankBot', source: HONEST_PLUS },
  {
    username: 'charlie', displayName: 'Challenge Charlie', botName: 'LieDetector',
    source: S(`
    # Charlie calls out anything that smells — and anything impossible.
    def suspicion(state, who, role):
        s = who.scrim_bluff_rate + who.times_caught_bluffing * 0.15
        s = s + len(who.claims) * 0.1
        if role != None and unseen_copies(state, role) == 0:
            s = 5
        return s

    def your_turn(state):
        if state.my_coins >= 7:
            return coup(best_coup_call(state))
        if "duke" in state.my_cards:
            return tax()
        return foreign_aid()

    def respond(state, action):
        if action.claimed_role != None:
            if chance(suspicion(state, state.opponent, action.claimed_role)):
                return challenge()
        return allow()

    def when_assassinated(state, action):
        if not (action.call in state.my_cards):
            return allow()
        if "contessa" in state.my_cards or state.my_lives <= 2:
            return block_contessa()
        return allow()
    `),
  },
  {
    username: 'tina', displayName: 'Turtle Tina', botName: 'ShellBot',
    source: S(`
    # Tina blocks everything and outlasts you.
    def your_turn(state):
        if state.my_coins >= 7:
            return coup(best_coup_call(state))
        return income()

    def respond(state, action):
        if action.type == "foreign_aid" and "duke" in state.my_cards:
            return block("duke")
        return allow()

    def when_assassinated(state, action):
        if not (action.call in state.my_cards):
            return allow()
        return block_contessa()
    `),
  },
  {
    username: 'daisy', displayName: 'Duke Daisy', botName: 'TaxMachine',
    source: S(`
    # Daisy claims Duke forever, real or not.
    def your_turn(state):
        if state.my_coins >= 7:
            return coup(best_coup_call(state))
        return tax()

    def respond(state, action):
        if action.type == "foreign_aid":
            return block("duke")
        return allow()

    def when_assassinated(state, action):
        if not (action.call in state.my_cards):
            return allow()
        if "contessa" in state.my_cards:
            return block_contessa()
        return reveal(state.my_cards[-1])

    def choose_card_to_lose(state):
        for card in state.my_cards:
            if card != "duke":
                return reveal(card)
        return reveal(state.my_cards[0])
    `),
  },
  {
    username: 'randy', displayName: 'Random Randy', botName: 'ChaosBot',
    source: S(`
    # Randy rolls dice for everything, including his coup calls.
    def your_turn(state):
        roles = ["duke", "assassin", "ambassador", "contessa"]
        if state.my_coins >= 10:
            return coup(choice(roles))
        r = random()
        if state.my_coins >= 7 and r < 0.5:
            return coup(choice(roles))
        if r < 0.25:
            return income()
        if r < 0.5:
            return foreign_aid()
        if r < 0.7:
            return tax()
        if state.my_coins >= 3 and r < 0.85:
            return assassinate(choice(roles), 0.5)
        return foreign_aid()

    def respond(state, action):
        if chance(0.15):
            return challenge()
        return allow()

    def when_assassinated(state, action):
        if chance(0.7):
            return block_contessa()
        return allow()
    `),
  },
  {
    username: 'barry', displayName: 'Bluff Barry', botName: 'SmoothTalker',
    source: S(`
    # Barry claims whatever pays best — then launders his reputation.
    def your_turn(state):
        if state.my_coins >= 7:
            return coup(best_coup_call(state))
        if len(state.my_claims) >= 2 and chance(0.35):
            return exchange()
        return tax()

    def respond(state, action):
        if action.type == "foreign_aid" and chance(0.5):
            return block("duke")
        return allow()

    def when_assassinated(state, action):
        if not (action.call in state.my_cards):
            return allow()
        return block_contessa()
    `),
  },
  {
    username: 'carl', displayName: 'Coup Carl', botName: 'SevenCoins',
    source: S(`
    # Carl saves up and hammers the most likely card, over and over.
    def your_turn(state):
        if state.my_coins >= 7:
            return coup(best_coup_call(state))
        return foreign_aid()

    def respond(state, action):
        return allow()

    def when_assassinated(state, action):
        if not (action.call in state.my_cards):
            return allow()
        return block_contessa()
    `),
  },
  {
    username: 'ava', displayName: 'Assassin Ava', botName: 'NightBlade',
    source: S(`
    # Ava trades 3 coins for lives as fast as possible.
    def your_turn(state):
        if state.my_coins >= 10:
            return coup(best_coup_call(state))
        if state.my_coins >= 3:
            return assassinate(best_coup_call(state), 0.6)
        if "duke" in state.my_cards:
            return tax()
        return foreign_aid()

    def respond(state, action):
        if action.is_block and action.claimed_role == "contessa" and chance(0.3):
            return challenge()
        return allow()

    def when_assassinated(state, action):
        if not (action.call in state.my_cards):
            return allow()
        return block_contessa()
    `),
  },
  {
    username: 'mia', displayName: 'Math Mia', botName: 'Calculatron',
    source: S(`
    # Mia only fires when the numbers say so.
    def your_turn(state):
        call = best_coup_call(state)
        p_hit = prob_opponent_has(state, call)
        if state.my_coins >= 10:
            return coup(call)
        if state.my_coins >= 7 and p_hit > 0.55:
            return coup(call)
        if "assassin" in state.my_cards and state.my_coins >= 3 and p_hit > 0.6:
            return assassinate(call, 0.35)
        if "duke" in state.my_cards:
            return tax()
        return foreign_aid()

    def respond(state, action):
        if action.claimed_role != None:
            if unseen_copies(state, action.claimed_role) == 0:
                return challenge()
            if state.opponent.scrim_bluff_rate * 2 + state.opponent.times_caught_bluffing * 0.2 > 0.8:
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
    `),
  },
  {
    username: 'sam', displayName: 'Shy Sam', botName: 'Wallflower',
    source: S(`
    # Sam quietly builds a fortune and strikes late.
    def your_turn(state):
        if state.my_coins >= 8:
            return coup(best_coup_call(state))
        if state.turn_number < 6:
            return income()
        return foreign_aid()

    def respond(state, action):
        return allow()

    def when_assassinated(state, action):
        if not (action.call in state.my_cards):
            return allow()
        if "contessa" in state.my_cards:
            return block_contessa()
        return allow()
    `),
  },
  {
    username: 'wes', displayName: 'Wildcard Wes', botName: 'CoinFlip',
    source: S(`
    # Wes mixes honest play with spicy gambles.
    def your_turn(state):
        if state.my_coins >= 7:
            return coup(best_coup_call(state))
        if "duke" in state.my_cards or chance(0.25):
            return tax()
        if "ambassador" in state.my_cards and chance(0.4):
            return exchange()
        if state.my_coins >= 3 and chance(0.4):
            return assassinate(best_coup_call(state), 0.35)
        return foreign_aid()

    def respond(state, action):
        if action.claimed_role != None and chance(0.12):
            return challenge()
        return allow()

    def when_assassinated(state, action):
        if not (action.call in state.my_cards):
            return allow()
        return block_contessa()
    `),
  },
  {
    username: 'greta', displayName: 'Grudge Greta', botName: 'PaybackTime',
    source: S(`
    # Greta answers blood with blood.
    def they_attacked_me(state):
        for h in state.history:
            if h.event == "action" and h.player == state.opponent.name:
                if h.action == "assassinate" or h.action == "coup":
                    return True
        return False

    def your_turn(state):
        if state.my_coins >= 7:
            return coup(best_coup_call(state))
        if they_attacked_me(state) and state.my_coins >= 3:
            return assassinate(best_coup_call(state), 0.4)
        if "duke" in state.my_cards:
            return tax()
        return foreign_aid()

    def respond(state, action):
        if action.claimed_role != None and state.revealed_roles[action.claimed_role] >= 3:
            return challenge()
        return allow()

    def when_assassinated(state, action):
        if not (action.call in state.my_cards):
            return allow()
        return block_contessa()
    `),
  },
];

/**
 * THE_EQUILIBRIST — the tuned near-equilibrium champion. Found by coordinate
 * ascent (best response vs a self-play mirror) over 9 strategy parameters,
 * ~50k headless games; the search converged (no parameter change in round 2)
 * and the result beats four hand-built exploiters (always-challenge,
 * max-bluffer, contessa-hunter, stonewall) and averages ~82% vs the sample
 * personalities. Re-tuned for the dynaMIT rules (no Captain, four lives,
 * missed calls re-deal): with only four roles a call hits ~53% blind, so
 * coups turn aggressive — 7+ coins at P(hit) ≥ 0.35; assassinate only at
 * P(hit) ≥ 0.85 with a 35% Contessa-block challenge; 15% tax bluff (100%
 * vs proven non-challengers); challenges nearly OFF (suspicion > 1.05 —
 * four-role claims are usually true); ALWAYS fake the Contessa. ~83% vs
 * the field, beats all four exploiters.
 */
const THE_EQUILIBRIST = S(`
    # The Equilibrist — the house champion. Beat it if you can.
    def suspicion(state, who, role):
        if unseen_copies(state, role) == 0:
            return 9
        s = who.scrim_bluff_rate * 1.2 + who.times_caught_bluffing * 0.2
        s = s + len(who.claims) * 0.1
        s = s + (1 - prob_opponent_has(state, role)) * 0.5
        return s

    def your_turn(state):
        call = best_coup_call(state)
        p_hit = prob_opponent_has(state, call)
        if state.my_coins >= 10:
            return coup(call)
        if state.my_coins >= 7 and p_hit >= 0.35:
            return coup(call)
        if "assassin" in state.my_cards and state.my_coins >= 3 and p_hit >= 0.85:
            return assassinate(call, 0.35)
        if "duke" in state.my_cards:
            return tax()
        if "ambassador" in state.my_cards and not ("duke" in state.my_cards) and chance(0.3):
            return exchange()
        # exploit a proven non-challenger with shameless Duke claims,
        # and stop feeding Foreign Aid into a standing Duke block
        if state.turn_number >= 6 and state.opponent.challenges_made == 0:
            return tax()
        if chance(0.15):
            return tax()
        if "duke" in state.opponent.claims and not ("duke" in state.my_cards):
            return income()
        return foreign_aid()

    def respond(state, action):
        if action.claimed_role != None:
            if suspicion(state, state.opponent, action.claimed_role) > 1.05:
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
`);

// house bots pad the pool and give the kids someone to beat
const HOUSE = [
  { name: 'The Equilibrist', source: THE_EQUILIBRIST },
  { name: 'The Marchesa', source: HONEST_PLUS },
  {
    name: 'The Auditor',
    source: S(`
    def your_turn(state):
        if state.my_coins >= 7:
            return coup(best_coup_call(state))
        if "duke" in state.my_cards:
            return tax()
        return income()

    def respond(state, action):
        if action.claimed_role != None and chance(0.25):
            return challenge()
        return allow()

    def when_assassinated(state, action):
        if not (action.call in state.my_cards):
            return allow()
        return block_contessa()
    `),
  },
  {
    name: 'The Hybrid',
    // Victor's design experiment, validated at ~83% vs the field (champion-
    // class): real economy + the Ambassador dodge, but the
    // dodge is RATIONED — only while in coup danger, not yet safe, and below
    // coup range. Defense is a resource you spend, not a stance you hold.
    source: S(`
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
    `),
  },
  {
    name: 'The Dodger',
    // pure defense: near-uncoupable (callers hit ~3%), but it pays every
    // turn for safety and goes broke — survival is not victory (~40%)
    source: S(`
    def order():
        return ["ambassador", "contessa", "duke", "assassin"]

    def is_safe(state):
        for card in state.my_cards:
            if card != "ambassador" and card != "contessa":
                return False
        return True

    def your_turn(state):
        if state.my_coins >= 10:
            return coup(best_coup_call(state))
        if state.opponent.coins >= 6 and not is_safe(state):
            return exchange()
        if not ("duke" in state.opponent.claims):
            return foreign_aid()
        return income()

    def respond(state, action):
        return allow()

    def when_assassinated(state, action):
        if not (action.call in state.my_cards):
            return allow()
        if "contessa" in state.my_cards:
            return block_contessa()
        return allow()

    def choose_card_to_lose(state):
        return reveal(strongest_cards(state.my_cards, order())[-1])

    def choose_exchange(state, pool):
        return strongest_cards(pool, order(), state.my_num_cards)
    `),
  },
  {
    name: 'The Banker',
    // pure economy: income/foreign aid only, coups only when forced at 10+.
    // Rich but defenseless (~33%) — money without a game plan loses the race
    source: S(`
    def your_turn(state):
        if state.my_coins >= 10:
            return coup(best_coup_call(state))
        if "duke" in state.opponent.claims:
            return income()
        return foreign_aid()

    def respond(state, action):
        return allow()

    def when_assassinated(state, action):
        if not (action.call in state.my_cards):
            return allow()
        if "contessa" in state.my_cards:
            return block_contessa()
        return allow()
    `),
  },
];

module.exports = { BOTS, HOUSE, THE_SCAFFOLD, HONEST_PLUS, THE_EQUILIBRIST };
