# THE CHILD — a bot that panics exactly once a game
#
# This one exists to show off BOT MEMORY. Anything you set up here at the top,
# outside every function, is REMEMBERED — from turn to turn, and from game to
# game. It only starts over when a new opponent sits down.
#
# The trick is `panicked`. It starts False, and the first time the Child is
# down to two lives it throws its whole hand back and takes a fresh one — then
# sets `panicked` to True so it will not do it again.
#
# Without memory you cannot write "the FIRST time". state.my_lives tells you
# that you are on two lives RIGHT NOW; it cannot tell you whether you have
# already done something about it. That is what a variable up here is for.
#
# THE CATCH, and it is the important part: memory lasts the whole matchup, not
# one game. Set `panicked` in game 1 and it is still True in game 2, so the
# Child would panic once in a hundred games instead of once per game. That is
# almost never what you want. `new_game()` below fixes it by watching
# state.series.game and wiping the slate whenever a fresh game starts.
#
# Try changing it:
#   - panic at 3 lives instead of 2. Too early?
#   - let it panic twice a game. Is a second fresh hand worth another turn?
#   - delete the new_game() calls and watch it panic once per HUNDRED games
#   - keep something across games ON PURPOSE — how often they challenge, say —
#     by leaving it out of new_game()

panicked = False
taxes_they_took = 0
game_now = 0


def new_game(state):
    # Has a fresh game started since we last looked? state.series.game counts
    # 1, 2, 3... through the matchup, so when it changes, forget this game's
    # notes. Anything you want to keep for the WHOLE matchup, leave out.
    if state.series.game != game_now:
        game_now = state.series.game
        panicked = False
        taxes_they_took = 0
    return 0


def your_turn(state):
    new_game(state)

    # at 10 coins the rules make you coup, so there is nothing to decide
    if state.my_coins >= 10:
        return coup(best_coup_call(state))

    # ---- THE PANIC: once a game, and only once ----
    # Two lives left means half the family is in the graveyard and everything
    # still in hand has been seen or guessed at. A fresh hand costs one turn
    # and buys a clean slate.
    if state.my_lives <= 2 and not panicked:
        panicked = True          # remembered — not again until the next game
        return exchange()

    if state.my_coins >= 7:
        return coup(best_coup_call(state))

    if "duke" in state.my_cards:
        return tax()
    # they keep claiming the Duke, so Foreign Aid is walking into a block
    if taxes_they_took >= 2:
        return income()
    return foreign_aid()


def respond(state, action):
    new_game(state)
    # count how often they claim the Duke this game
    if action.type == "tax":
        taxes_they_took = taxes_they_took + 1
    if action.type == "foreign_aid" and "duke" in state.my_cards:
        return block("duke")
    return allow()


def when_assassinated(state, action):
    # a name that is not in my hand misses on its own — do not waste a block
    if not (action.call in state.my_cards):
        return allow()
    if "contessa" in state.my_cards:
        return block_contessa()
    return allow()


def choose_card_to_lose(state):
    return reveal(state.my_cards[0])
