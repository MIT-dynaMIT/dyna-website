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
# THE CATCH, and it is the important part: memory lasts the whole MATCHUP, not
# one game. Set `panicked` in game 1 and it is still True in game 2, so without
# help the Child would panic once in a hundred games instead of once per game.
#
# That is what new_game() is for. Write it and the game calls it for you at the
# start of every game, before anybody moves. Do not try to do this by hand with
# an "is it a new game?" check inside your_turn — whoever moves first decides
# whether your_turn or respond runs first, so a check in only one of them
# silently never fires in half your games.
#
# Try changing it:
#   - panic at 3 lives instead of 2. Too early?
#   - let it panic twice a game. Is a second fresh hand worth another turn?
#   - empty out new_game() and watch it panic once per HUNDRED games
#   - keep something across games ON PURPOSE by leaving it out of new_game()

panicked = False
taxes_they_took = 0


def new_game(state):
    # The game calls this for you ONCE at the start of every game, before
    # anybody moves. Wipe whatever you count per game here. Anything you want
    # to keep for the WHOLE matchup — how often they challenge, say — just
    # leave it out of this function and it survives.
    panicked = False
    taxes_they_took = 0


def your_turn(state):
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
