/**
 * Sample students + their bots, written in botlang (the same language the
 * block editor generates). Used by seed.js to fill the camp with life, and
 * doubling as an end-to-end exercise of the interpreter + block vocabulary.
 */
'use strict';

const S = (s) => s.replace(/^\n/, '').replace(/^    /gm, '');

const HONEST_HANK = S(`
    # Honest Hank: plays what he holds, bluffs only the Contessa.
    def your_turn(state):
        if state.my_coins >= 7:
            return coup(state.strongest_player)
        if "assassin" in state.my_cards and state.my_coins >= 3:
            return assassinate(state.strongest_player, 0)
        if "duke" in state.my_cards:
            return tax()
        if "captain" in state.my_cards and state.richest_player.coins >= 2:
            return steal(state.richest_player)
        return income()

    def respond(state, action):
        if action.type == "steal":
            if "captain" in state.my_cards:
                return block("captain")
            if "ambassador" in state.my_cards:
                return block("ambassador")
        if action.type == "foreign_aid" and "duke" in state.my_cards:
            return block("duke")
        return allow()

    def when_assassinated(state, action):
        return block_contessa()
`);

const BOTS = [
  {
    username: 'hank', displayName: 'Honest Hank', botName: 'HankBot',
    source: HONEST_HANK,
  },
  {
    username: 'charlie', displayName: 'Challenge Charlie', botName: 'LieDetector',
    source: S(`
    # Charlie calls out anyone whose story smells.
    def suspicion(state, player, role):
        s = player.scrim_bluff_rate
        s = s + len(player.claims) * 0.12
        s = s + player.times_caught_bluffing * 0.15
        if role == "contessa":
            s = s + 0.1
        return s

    def your_turn(state):
        if state.my_coins >= 7:
            return coup(state.richest_player)
        if "duke" in state.my_cards:
            return tax()
        if "assassin" in state.my_cards and state.my_coins >= 3:
            return assassinate(state.strongest_player, 0.6)
        return foreign_aid()

    def respond(state, action):
        who = action.actor
        if action.is_block:
            who = action.blocker
        if action.claimed_role != None and not who.is_me:
            if chance(suspicion(state, who, action.claimed_role)):
                return challenge()
        return allow()

    def when_assassinated(state, action):
        if "contessa" in state.my_cards or state.my_num_cards == 1:
            return block_contessa()
        return reveal(state.my_cards[0])
    `),
  },
  {
    username: 'tina', displayName: 'Turtle Tina', botName: 'ShellBot',
    source: S(`
    # Tina hides in her shell and blocks everything.
    def your_turn(state):
        if state.my_coins >= 7:
            return coup(state.strongest_player)
        return income()

    def respond(state, action):
        if action.type == "steal":
            return block("captain")
        if action.type == "foreign_aid" and "duke" in state.my_cards:
            return block("duke")
        return allow()

    def when_assassinated(state, action):
        return block_contessa()
    `),
  },
  {
    username: 'daisy', displayName: 'Duke Daisy', botName: 'TaxMachine',
    source: S(`
    # Daisy claims Duke every single turn, whether she has it or not.
    def your_turn(state):
        if state.my_coins >= 7:
            return coup(state.richest_player)
        return tax()

    def respond(state, action):
        if action.type == "foreign_aid":
            return block("duke")
        return allow()

    def when_assassinated(state, action):
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
    # Randy rolls dice for everything.
    def your_turn(state):
        if state.my_coins >= 10:
            return coup(state.strongest_player)
        r = random()
        if state.my_coins >= 7 and r < 0.5:
            return coup(choice(state.opponents))
        if r < 0.25:
            return income()
        if r < 0.5:
            return foreign_aid()
        if r < 0.7:
            return tax()
        if state.my_coins >= 3 and r < 0.85:
            return assassinate(choice(state.opponents), 0.5)
        return steal(choice(state.opponents))

    def respond(state, action):
        if chance(0.15):
            return challenge()
        return allow()

    def when_assassinated(state, action):
        if chance(0.7):
            return block_contessa()
        return reveal(state.my_cards[0])
    `),
  },
  {
    username: 'barry', displayName: 'Bluff Barry', botName: 'SmoothTalker',
    source: S(`
    # Barry claims whatever is most convenient right now.
    def your_turn(state):
        if state.my_coins >= 7:
            return coup(state.strongest_player)
        target = state.richest_player
        if target.coins >= 2 and chance(0.6):
            return steal(target)
        return tax()

    def respond(state, action):
        if action.type == "steal":
            return block("captain")
        if action.type == "foreign_aid" and chance(0.5):
            return block("duke")
        return allow()

    def when_assassinated(state, action):
        return block_contessa()
    `),
  },
  {
    username: 'carl', displayName: 'Coup Carl', botName: 'SevenCoins',
    source: S(`
    # Carl saves up and knocks people out, nothing fancy.
    def pick_target(state):
        best = state.opponents[0]
        for p in state.opponents:
            if p.num_cards > best.num_cards:
                best = p
            if p.num_cards == best.num_cards and p.coins > best.coins:
                best = p
        return best

    def your_turn(state):
        if state.my_coins >= 7:
            return coup(pick_target(state))
        return foreign_aid()

    def respond(state, action):
        return allow()

    def when_assassinated(state, action):
        return block_contessa()
    `),
  },
  {
    username: 'ava', displayName: 'Assassin Ava', botName: 'NightBlade',
    source: S(`
    # Ava rushes assassinations and calls Contessa bluffs hard.
    def your_turn(state):
        if state.my_coins >= 10:
            return coup(state.strongest_player)
        if state.my_coins >= 3:
            return assassinate(state.strongest_player, 0.7)
        if "duke" in state.my_cards:
            return tax()
        return foreign_aid()

    def respond(state, action):
        if action.is_block and action.claimed_role == "contessa" and chance(0.3):
            return challenge()
        return allow()

    def when_assassinated(state, action):
        return block_contessa()
    `),
  },
  {
    username: 'mia', displayName: 'Math Mia', botName: 'Calculatron',
    source: S(`
    # Mia reads the scrim stats like a quant.
    def bluffiness(player):
        score = player.scrim_bluff_rate * 2
        score = score + player.times_caught_bluffing * 0.2
        score = score - player.scrim_challenge_success * 0.5
        return score

    def your_turn(state):
        if state.my_coins >= 7:
            best = state.opponents[0]
            for p in state.opponents:
                if p.scrim_win_rate > best.scrim_win_rate:
                    best = p
            return coup(best)
        if "duke" in state.my_cards:
            return tax()
        if "assassin" in state.my_cards and state.my_coins >= 3:
            return assassinate(state.strongest_player, 0.4)
        if "captain" in state.my_cards and state.richest_player.coins >= 2:
            return steal(state.richest_player)
        return foreign_aid()

    def respond(state, action):
        who = action.actor
        if action.is_block:
            who = action.blocker
        if action.claimed_role != None and not who.is_me:
            threshold = 0.75
            if state.my_num_cards == 2 and who.num_cards == 1:
                threshold = 0.55
            if bluffiness(who) > threshold:
                return challenge()
        if action.type == "steal" and "captain" in state.my_cards:
            return block("captain")
        if action.type == "foreign_aid" and "duke" in state.my_cards:
            return block("duke")
        return allow()

    def when_assassinated(state, action):
        return block_contessa()
    `),
  },
  {
    username: 'sam', displayName: 'Shy Sam', botName: 'Wallflower',
    source: S(`
    # Sam keeps his head down and quietly builds a fortune.
    def your_turn(state):
        if state.my_coins >= 7:
            return coup(state.weakest_player)
        if state.turn_number < 6:
            return income()
        return foreign_aid()

    def respond(state, action):
        return allow()

    def when_assassinated(state, action):
        if "contessa" in state.my_cards:
            return block_contessa()
        return reveal(state.my_cards[0])
    `),
  },
  {
    username: 'wes', displayName: 'Wildcard Wes', botName: 'CoinFlip',
    source: S(`
    # Wes mixes honest play with spicy gambles.
    def your_turn(state):
        if state.my_coins >= 7:
            if chance(0.8):
                return coup(state.strongest_player)
            return coup(choice(state.opponents))
        if "duke" in state.my_cards or chance(0.25):
            return tax()
        if "ambassador" in state.my_cards and chance(0.5):
            return exchange()
        if state.my_coins >= 3 and chance(0.4):
            return assassinate(state.richest_player, 0.35)
        return foreign_aid()

    def respond(state, action):
        who = action.actor
        if action.is_block:
            who = action.blocker
        if action.claimed_role != None and not who.is_me and chance(0.12):
            return challenge()
        if action.type == "steal" and chance(0.65):
            return block("captain")
        return allow()

    def when_assassinated(state, action):
        return block_contessa()
    `),
  },
  {
    username: 'greta', displayName: 'Grudge Greta', botName: 'PaybackTime',
    source: S(`
    # Greta never forgets who attacked her.
    def enemy(state):
        worst = None
        most = 0
        for p in state.opponents:
            if p.attacked_me > most:
                most = p.attacked_me
                worst = p
        if worst == None:
            return state.strongest_player
        return worst

    def your_turn(state):
        if state.my_coins >= 7:
            return coup(enemy(state))
        if "assassin" in state.my_cards and state.my_coins >= 3:
            return assassinate(enemy(state), 0.3)
        if "duke" in state.my_cards:
            return tax()
        if "captain" in state.my_cards:
            target = enemy(state)
            if target.coins >= 1:
                return steal(target)
        return foreign_aid()

    def respond(state, action):
        who = action.actor
        if action.is_block:
            who = action.blocker
        if who != None and not who.is_me and who.attacked_me >= 2 and action.claimed_role != None:
            if chance(0.35):
                return challenge()
        if action.type == "steal" and "captain" in state.my_cards:
            return block("captain")
        return allow()

    def when_assassinated(state, action):
        return block_contessa()
    `),
  },
];

// house bots pad the pool when fewer than 5 students have submitted
const HOUSE = [
  { name: 'The Marchesa', source: HONEST_HANK },
  {
    name: 'The Auditor',
    source: S(`
    def your_turn(state):
        if state.my_coins >= 7:
            return coup(state.strongest_player)
        if "duke" in state.my_cards:
            return tax()
        return income()

    def respond(state, action):
        who = action.actor
        if action.is_block:
            who = action.blocker
        if action.claimed_role != None and not who.is_me and chance(0.25):
            return challenge()
        return allow()

    def when_assassinated(state, action):
        return block_contessa()
    `),
  },
];

module.exports = { BOTS, HOUSE, HONEST_HANK };
