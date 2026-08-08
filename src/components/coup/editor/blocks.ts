/**
 * Blockly wiring for the dynaCOUP bot editor — HEADS-UP "Ultimate" variant.
 *
 * Two players, four lives each, dead cards to a public graveyard, and
 * "Call the Coup": coup() and assassinate() NAME a character — name wrong and
 * the attack misses. There is exactly one opponent (state.opponent), so the
 * old multi-player pickers are gone. The dynaMIT rules drop the Captain: four
 * roles, a 12-card deck, and no steal action.
 *
 * Everything the editor needs lives here: the custom Coup blocks, the Python
 * generators that turn them into the bot language (see server/botlang.js for
 * the exact subset), a dark court-intrigue theme, the toolbox, and the starter
 * workspace new students begin from.
 *
 * CRITICAL invariant: every generator here must emit code the botlang parser
 * accepts — no imports, lambdas, f-strings, tuples, slicing, comprehensions or
 * keyword args, and NEVER a player object where a role string is expected
 * (coup/assassinate take role strings). We override the few standard-block
 * generators that would otherwise reach for random/math.
 */
import * as Blockly from 'blockly/core';
import { pythonGenerator, Order } from 'blockly/python';
import * as En from 'blockly/msg/en';
import 'blockly/blocks';

type Gen = typeof pythonGenerator;

const ROLE_OPTIONS: [string, string][] = [
  ['Duke', 'duke'],
  ['Assassin', 'assassin'],
  ['Ambassador', 'ambassador'],
  ['Contessa', 'contessa'],
];

// fallback power ranking when a strongest-cards ORDER socket is left empty
const DEFAULT_ORDER = '["duke", "contessa", "assassin", "ambassador"]';

// ---------------------------------------------------------------- colours
const C_EVENT = '#b0812f';
const C_ACTION = '#2a6f9e';
const C_RESPONSE = '#2f8a57';
const C_INFO = '#6f5e93';
const C_CHANCE = '#b06a2a';
const C_MOVE = '#a4506b';

// ---------------------------------------------------------------- blocks
const BLOCKS: Record<string, unknown>[] = [
  // ---- hat / event blocks (one per bot function) --------------------
  {
    type: 'coup_when_turn',
    message0: "when it's my turn ⚔",
    message1: 'do %1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    colour: C_EVENT,
    tooltip: 'Runs on your turn. End it by returning an action.',
    hat: 'cap',
  },
  {
    type: 'coup_when_respond',
    message0: 'when my opponent makes a move %1',
    args0: [{ type: 'field_label', name: 'L', text: 'I can challenge/block' }],
    message1: 'do %1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    colour: C_EVENT,
    tooltip: 'Your opponent did something you may challenge or block. Use "This Move" blocks to inspect it.',
    hat: 'cap',
  },
  {
    type: 'coup_when_assassinated',
    message0: 'when my opponent assassinates me 🗡',
    message1: 'do %1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    colour: C_EVENT,
    tooltip: 'They named a card. If they did NOT name one you hold it misses anyway — so allow() (dodge) is often right. Otherwise block with Contessa or reveal a card.',
    hat: 'cap',
  },
  {
    type: 'coup_choose_lose',
    message0: 'when I must lose a card 💀',
    message1: 'do %1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    colour: C_EVENT,
    tooltip: 'Pick which of your cards to flip face-up into your graveyard.',
    hat: 'cap',
  },
  {
    type: 'coup_choose_exchange',
    message0: 'when I exchange, from the pool %1',
    args0: [{ type: 'field_label', name: 'L', text: '(advanced)' }],
    message1: 'do %1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    colour: C_EVENT,
    tooltip: 'Ambassador exchange: return the list of role names to keep (exactly your card count).',
    hat: 'cap',
  },

  // ---- actions (terminate a turn) -----------------------------------
  { type: 'coup_income', message0: 'take Income (+1) 💰', previousStatement: null, colour: C_ACTION, tooltip: 'Safe +1 coin. Nobody can stop it.' },
  { type: 'coup_foreign_aid', message0: 'take Foreign Aid (+2) 💰💰', previousStatement: null, colour: C_ACTION, tooltip: '+2 coins, unless your opponent claims a Duke to block it.' },
  { type: 'coup_tax', message0: 'claim Duke → Tax (+3) 👑', previousStatement: null, colour: C_ACTION, tooltip: 'Duke gets +3. A bluff can be challenged.' },
  { type: 'coup_exchange', message0: 'claim Ambassador → Exchange ⚜', previousStatement: null, colour: C_ACTION, tooltip: 'Swap cards with the deck to fix your hand.' },
  {
    type: 'coup_coup', message0: 'Coup! (pay 7) 💥 call their %1',
    args0: [{ type: 'input_value', name: 'ROLE' }],
    previousStatement: null, inputsInline: true, colour: C_ACTION,
    tooltip: 'Costs 7 coins. Name the card they hold — if the call is wrong it MISSES: they show their hand, it returns to the deck, and they are dealt a fresh random hand. Empty socket = the engine calls your best guess.',
  },
  {
    type: 'coup_assassinate',
    message0: 'Assassinate! (pay 3) 🗡 call their %1',
    args0: [{ type: 'input_value', name: 'ROLE' }],
    message1: 'if they block with Contessa, challenge with chance %1',
    args1: [{ type: 'field_number', name: 'P', value: 0.35, min: 0, max: 1, precision: 0.05 }],
    previousStatement: null, inputsInline: true, colour: C_ACTION,
    tooltip: 'Costs 3 coins. Name the card they hold — a wrong name MISSES: they show their hand, it returns to the deck, and they are dealt a fresh random hand. Set how often you challenge a Contessa block. Empty socket = your best guess.',
  },

  // ---- responses ----------------------------------------------------
  { type: 'coup_allow', message0: 'allow it ✔', previousStatement: null, colour: C_RESPONSE, tooltip: 'Let the move happen (in when-assassinated this is a dodge — legal and often best).' },
  { type: 'coup_challenge', message0: 'challenge! ✋', previousStatement: null, colour: C_RESPONSE, tooltip: 'Call their bluff — the loser flips a card.' },
  {
    type: 'coup_block', message0: 'block by claiming %1',
    args0: [{ type: 'field_dropdown', name: 'ROLE', options: ROLE_OPTIONS }],
    previousStatement: null, colour: C_RESPONSE,
    tooltip: 'Claim a role to stop your opponent — in the dynaMIT rules the Duke blocks Foreign Aid.',
  },
  { type: 'coup_block_contessa', message0: 'block with Contessa ❦', previousStatement: null, colour: C_RESPONSE, tooltip: 'Survive an assassination by claiming Contessa.' },
  {
    type: 'coup_keep', message0: 'keep these cards %1',
    args0: [{ type: 'input_value', name: 'LIST' }],
    previousStatement: null, inputsInline: true, colour: C_RESPONSE,
    tooltip: 'For an exchange: return the list of role names you want to keep.',
  },
  {
    type: 'coup_keep_strongest', message0: 'keep the strongest cards from %1 using %2',
    args0: [{ type: 'input_value', name: 'FROM' }, { type: 'input_value', name: 'ORDER' }],
    previousStatement: null, inputsInline: true, colour: C_RESPONSE,
    tooltip: 'Exchange: keeps exactly as many cards as you have, strongest by your ranking. Leave "from" empty to use the whole pool. If the source has fewer than you need, it keeps what it can and the game fills the rest.',
  },
  {
    type: 'coup_reveal', message0: 'give up card %1',
    args0: [{ type: 'input_value', name: 'ROLE' }],
    previousStatement: null, inputsInline: true, colour: C_RESPONSE,
    tooltip: 'Flip one of your cards face-up into your graveyard (lose it).',
  },
  {
    type: 'coup_return', message0: 'return %1',
    args0: [{ type: 'input_value', name: 'VALUE' }],
    previousStatement: null, inputsInline: true, colour: C_RESPONSE,
    tooltip: 'Return a value from a function (use in your own helper functions, or to return True/False).',
  },

  // ---- power ordering (value blocks) -------------------------------
  {
    type: 'coup_power_order',
    message0: 'card power order: 1st %1 2nd %2 3rd %3 4th %4',
    args0: [
      { type: 'field_dropdown', name: 'R1', options: ROLE_OPTIONS },
      { type: 'field_dropdown', name: 'R2', options: ROLE_OPTIONS },
      { type: 'field_dropdown', name: 'R3', options: ROLE_OPTIONS },
      { type: 'field_dropdown', name: 'R4', options: ROLE_OPTIONS },
    ],
    output: 'Array', inputsInline: true, colour: C_INFO,
    tooltip: 'Your personal ranking of the 4 roles, strongest first. Plug it into the strongest-cards blocks.',
  },
  {
    type: 'coup_strongest_n', message0: 'the strongest %1 of %2 using %3',
    args0: [
      { type: 'field_number', name: 'N', value: 2, min: 0, precision: 1 },
      { type: 'input_value', name: 'LIST' },
      { type: 'input_value', name: 'ORDER' },
    ],
    output: 'Array', inputsInline: true, colour: C_INFO,
    tooltip: 'Sort a list of role names by your ranking and take the strongest N.',
  },
  {
    type: 'coup_sorted_strongest', message0: 'sorted strongest-first %1 using %2',
    args0: [
      { type: 'input_value', name: 'LIST' },
      { type: 'input_value', name: 'ORDER' },
    ],
    output: 'Array', inputsInline: true, colour: C_INFO,
    tooltip: 'Strongest first — so the last item is your weakest card. Great for choose_card_to_lose: reveal the last one.',
  },

  // ---- claim-aware card choices ------------------------------------
  { type: 'coup_claimed_card', message0: 'a card I have claimed', output: 'String', colour: C_INFO, tooltip: 'A card whose role you already told your opponent about. Giving THIS one up keeps your secret card secret.' },
  { type: 'coup_unclaimed_card', message0: 'a card I have NOT claimed', output: 'String', colour: C_INFO, tooltip: 'A card your opponent knows nothing about. Give this up to keep your public claims backed by a real card.' },
  { type: 'coup_pool', message0: 'the exchange pool', output: 'Array', colour: C_INFO, tooltip: 'The cards offered to you in an Ambassador exchange (only inside the exchange hat).' },
  {
    type: 'coup_cards_in', message0: 'cards in %1 also in %2',
    args0: [{ type: 'input_value', name: 'A' }, { type: 'input_value', name: 'B' }],
    output: 'Array', inputsInline: true, colour: C_INFO, tooltip: 'The role names from the first list that also appear in the second.',
  },
  {
    type: 'coup_cards_not_in', message0: 'cards in %1 NOT in %2',
    args0: [{ type: 'input_value', name: 'A' }, { type: 'input_value', name: 'B' }],
    output: 'Array', inputsInline: true, colour: C_INFO, tooltip: 'The role names from the first list that are missing from the second — e.g. exchange for cards your opponent does not expect.',
  },

  // ---- this move (inspect your opponent's move) --------------------
  // Heads-up: every person is me or my opponent, so there are no actor/target/
  // blocker blocks — read the mover from "my opponent" (Game Info).
  { type: 'coup_action_call', message0: 'the role they called', output: 'String', colour: C_MOVE, tooltip: 'The character your opponent named when they couped or assassinated you. If it is not a card you hold, the attack misses!' },
  {
    type: 'coup_action_is', message0: 'this move is %1',
    args0: [{
      type: 'field_dropdown', name: 'TYPE', options: [
        ['Income', 'income'], ['Foreign Aid', 'foreign_aid'], ['Tax', 'tax'],
        ['Assassinate', 'assassinate'], ['Exchange', 'exchange'], ['Coup', 'coup'],
      ],
    }],
    output: 'Boolean', colour: C_MOVE, tooltip: 'True if your opponent’s move is that kind. Reaction hats only.',
  },
  { type: 'coup_action_claimed_role', message0: 'the role they claim', output: 'String', colour: C_MOVE, tooltip: 'The role your opponent is claiming, e.g. "duke". Reaction hats only.' },
  { type: 'coup_action_is_block', message0: 'this is a block', output: 'Boolean', colour: C_MOVE, tooltip: 'True if your opponent’s move is a block. Reaction hats only.' },
  { type: 'coup_action_already_claimed', message0: 'they already claimed this role before ✓', output: 'Boolean', colour: C_MOVE, tooltip: 'True if your opponent claimed this same role earlier in the game. A consistent story is more believable; a brand-new claim is more likely a bluff.' },
  { type: 'coup_claimed_role_impossible', message0: 'the role they claim is impossible now', output: 'Boolean', colour: C_MOVE, tooltip: 'True when all 3 copies of the claimed role are already face-up (deck + graveyards) — a guaranteed bluff. Free challenge!' },

  // ---- game info (values) ------------------------------------------
  {
    type: 'coup_state_field', message0: '%1',
    args0: [{
      type: 'field_dropdown', name: 'FIELD', options: [
        ['my coins', 'my_coins'],
        ['my lives', 'my_lives'],
        ['my name', 'my_name'],
        ['my number of cards', 'my_num_cards'],
        ['cards left in deck', 'deck_count'],
        ['turn number', 'turn_number'],
      ],
    }],
    output: null, colour: C_INFO, tooltip: 'A fact about the current game.',
  },
  { type: 'coup_opponent', message0: 'my opponent', output: 'Player', colour: C_INFO, tooltip: 'Your one rival across the table. Plug into "[property] of [player]".' },
  { type: 'coup_my_lives', message0: 'my lives', output: 'Number', colour: C_INFO, tooltip: 'How many lives you have left (you start with 4).' },
  { type: 'coup_my_graveyard', message0: 'my dead cards (list)', output: 'Array', colour: C_INFO, tooltip: 'The roles you have already lost, face-up for all to see.' },
  { type: 'coup_opp_graveyard', message0: "opponent's dead cards (list)", output: 'Array', colour: C_INFO, tooltip: "The roles your opponent has lost so far — great for card-counting." },
  {
    type: 'coup_prob_opp_has', message0: 'chance opponent has %1',
    args0: [{ type: 'input_value', name: 'ROLE' }],
    output: 'Number', inputsInline: true, colour: C_INFO, tooltip: 'The probability (0–1) that your opponent is holding this role, from card-counting + their claims. The card-counting workhorse.',
  },
  { type: 'coup_best_guess', message0: 'my best guess at their card', output: 'String', colour: C_INFO, tooltip: 'The single role your opponent most likely holds — perfect to feed into Coup or Assassinate.' },
  {
    type: 'coup_unseen', message0: 'copies of %1 I have not seen',
    args0: [{ type: 'input_value', name: 'ROLE' }],
    output: 'Number', inputsInline: true, colour: C_INFO, tooltip: 'How many copies of that role could still be in the deck or your opponent’s hand (3 minus what is face-up and in your hand).',
  },
  { type: 'coup_history', message0: 'the game history (list)', output: 'Array', colour: C_INFO, tooltip: 'Every event so far, oldest first. Loop over it with a for-each; each item has fields like event, player, action.' },
  {
    type: 'coup_attr', message0: 'field %1 of %2',
    args0: [{ type: 'field_input', name: 'NAME', text: 'event' }, { type: 'input_value', name: 'OBJ' }],
    output: null, inputsInline: true, colour: C_INFO, tooltip: 'Read any named field of a value (advanced) — e.g. the "event" of a history item.',
  },
  {
    type: 'coup_revealed_count', message0: 'how many %1 are face-up',
    args0: [{ type: 'field_dropdown', name: 'ROLE', options: ROLE_OPTIONS }],
    output: 'Number', colour: C_INFO, tooltip: 'How many copies of that role are face-up in the graveyards (0–3). Three exist of each.',
  },
  {
    type: 'coup_role_impossible', message0: '%1 is impossible now',
    args0: [{ type: 'field_dropdown', name: 'ROLE', options: ROLE_OPTIONS }],
    output: 'Boolean', colour: C_INFO, tooltip: 'True when all 3 copies of that role are face-up — nobody can truthfully claim it anymore.',
  },
  { type: 'coup_my_cards', message0: 'my cards (list)', output: 'Array', colour: C_INFO, tooltip: 'Your own face-down role cards, as a list.' },
  { type: 'coup_my_claims', message0: 'roles I have claimed (list)', output: 'Array', colour: C_INFO, tooltip: 'Every role you have claimed so far this game.' },
  {
    type: 'coup_player_prop', message0: '%1 of %2',
    args0: [
      {
        type: 'field_dropdown', name: 'PROP', options: [
          ['name', 'name'],
          ['coins', 'coins'],
          ['lives', 'lives'],
          ['number of cards', 'num_cards'],
          ['dead cards', 'graveyard'],
          ['cards lost', 'cards_lost'],
          ['is me', 'is_me'],
          ['claimed roles', 'claims'],
          ['challenges made', 'challenges_made'],
          ['successful challenges', 'successful_challenges'],
          ['times caught bluffing', 'times_caught_bluffing'],
          ['ladder challenge success', 'scrim_challenge_success'],
          ['ladder bluff rate', 'scrim_bluff_rate'],
          ['ladder win rate', 'scrim_win_rate'],
        ],
      },
      { type: 'input_value', name: 'PLAYER' },
    ],
    output: null, inputsInline: true, colour: C_INFO, tooltip: 'Read a detail about a player (usually your opponent).',
  },
  {
    type: 'coup_has_role', message0: 'I have a %1',
    args0: [{ type: 'field_dropdown', name: 'ROLE', options: ROLE_OPTIONS }],
    output: 'Boolean', colour: C_INFO, tooltip: 'True if that role is one of your face-down cards.',
  },
  {
    type: 'coup_i_have', message0: 'I hold the card %1',
    args0: [{ type: 'input_value', name: 'ROLE' }],
    output: 'Boolean', inputsInline: true, colour: C_INFO, tooltip: 'True if that role (from a socket — e.g. the role they called) is in your hand.',
  },
  {
    type: 'coup_player_claimed', message0: '%1 has claimed %2',
    args0: [
      { type: 'input_value', name: 'PLAYER' },
      { type: 'field_dropdown', name: 'ROLE', options: ROLE_OPTIONS },
    ],
    output: 'Boolean', inputsInline: true, colour: C_INFO, tooltip: 'True if that player has claimed the role this game.',
  },
  {
    type: 'coup_role', message0: '%1',
    args0: [{ type: 'field_dropdown', name: 'ROLE', options: ROLE_OPTIONS }],
    output: 'String', colour: C_INFO, tooltip: 'A role name.',
  },
  {
    type: 'coup_my_card', message0: 'my card #%1',
    args0: [{ type: 'field_number', name: 'IDX', value: 0, min: 0, precision: 1 }],
    output: 'String', colour: C_INFO, tooltip: 'One of your own cards by position (0 = first).',
  },

  // ---- chance -------------------------------------------------------
  {
    type: 'coup_chance_do',
    message0: 'with probability %1',
    args0: [{ type: 'field_number', name: 'P', value: 0.5, min: 0, max: 1, precision: 0.05 }],
    message1: 'do %1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    message2: 'otherwise %1',
    args2: [{ type: 'input_statement', name: 'ELSE' }],
    previousStatement: null, nextStatement: null, colour: C_CHANCE,
    tooltip: 'Flip a weighted coin: run the first branch with probability p, else the second.',
  },
  {
    type: 'coup_chance', message0: 'chance of %1',
    args0: [{ type: 'input_value', name: 'P' }],
    output: 'Boolean', inputsInline: true, colour: C_CHANCE, tooltip: 'True with the given probability (a number 0–1, or any expression).',
  },
  { type: 'coup_random', message0: 'random number 0…1 🎲', output: 'Number', colour: C_CHANCE, tooltip: 'A random decimal from 0 up to 1.' },
  {
    type: 'coup_random_int', message0: 'random whole number from %1 to %2',
    args0: [
      { type: 'field_number', name: 'A', value: 1, precision: 1 },
      { type: 'field_number', name: 'B', value: 6, precision: 1 },
    ],
    output: 'Number', inputsInline: true, colour: C_CHANCE, tooltip: 'A random integer between the two values (inclusive).',
  },
  {
    type: 'coup_random_choice', message0: 'random item of %1',
    args0: [{ type: 'input_value', name: 'LIST' }],
    output: null, colour: C_CHANCE, tooltip: 'Pick one item from a list at random.',
  },
  {
    type: 'coup_first_of', message0: 'first item of %1',
    args0: [{ type: 'input_value', name: 'LIST' }],
    output: null, colour: C_INFO, tooltip: 'The item at position 0.',
  },
  {
    type: 'coup_last_of', message0: 'last item of %1',
    args0: [{ type: 'input_value', name: 'LIST' }],
    output: null, colour: C_INFO, tooltip: 'The final item in a list.',
  },
];

// ---------------------------------------------------------------- generators
type FB = (block: Blockly.Block, gen: Gen) => [string, Order] | string | null;
const forBlock = pythonGenerator.forBlock as unknown as Record<string, FB>;

function hatGen(header: string): FB {
  return (block, gen) => {
    const body = gen.statementToCode(block, 'DO');
    return `${header}\n${body || gen.INDENT + 'pass\n'}`;
  };
}

function registerGenerators() {
  pythonGenerator.INDENT = '    ';

  // hats -> top-level defs
  forBlock['coup_when_turn'] = hatGen('def your_turn(state):');
  forBlock['coup_when_respond'] = hatGen('def respond(state, action):');
  forBlock['coup_when_assassinated'] = hatGen('def when_assassinated(state, action):');
  forBlock['coup_choose_lose'] = hatGen('def choose_card_to_lose(state):');
  forBlock['coup_choose_exchange'] = hatGen('def choose_exchange(state, pool):');

  // actions (Call-the-Coup: coup/assassinate take role strings, not players)
  forBlock['coup_income'] = () => 'return income()\n';
  forBlock['coup_foreign_aid'] = () => 'return foreign_aid()\n';
  forBlock['coup_tax'] = () => 'return tax()\n';
  forBlock['coup_exchange'] = () => 'return exchange()\n';
  forBlock['coup_coup'] = (block, gen) =>
    `return coup(${gen.valueToCode(block, 'ROLE', Order.NONE) || 'best_coup_call(state)'})\n`;
  forBlock['coup_assassinate'] = (block, gen) => {
    const call = gen.valueToCode(block, 'ROLE', Order.NONE) || 'best_coup_call(state)';
    const p = Number(block.getFieldValue('P'));
    return `return assassinate(${call}, ${p})\n`;
  };

  // responses
  forBlock['coup_allow'] = () => 'return allow()\n';
  forBlock['coup_challenge'] = () => 'return challenge()\n';
  forBlock['coup_block'] = (block) => `return block("${block.getFieldValue('ROLE')}")\n`;
  forBlock['coup_block_contessa'] = () => 'return block_contessa()\n';
  forBlock['coup_reveal'] = (block, gen) =>
    `return reveal(${gen.valueToCode(block, 'ROLE', Order.NONE) || 'state.my_cards[0]'})\n`;
  forBlock['coup_keep'] = (block, gen) =>
    `return ${gen.valueToCode(block, 'LIST', Order.NONE) || 'pool'}\n`;
  forBlock['coup_keep_strongest'] = (block, gen) => {
    const from = gen.valueToCode(block, 'FROM', Order.NONE) || 'pool';
    const order = gen.valueToCode(block, 'ORDER', Order.NONE) || DEFAULT_ORDER;
    return `return strongest_cards(${from}, ${order}, state.my_num_cards)\n`;
  };
  forBlock['coup_power_order'] = (block) => {
    const roles = ['R1', 'R2', 'R3', 'R4'].map((f) => `"${block.getFieldValue(f)}"`);
    return [`[${roles.join(', ')}]`, Order.ATOMIC];
  };
  forBlock['coup_strongest_n'] = (block, gen) => {
    const n = Number(block.getFieldValue('N')) || 0;
    const list = gen.valueToCode(block, 'LIST', Order.NONE) || 'state.my_cards';
    const order = gen.valueToCode(block, 'ORDER', Order.NONE) || DEFAULT_ORDER;
    return [`strongest_cards(${list}, ${order}, ${n})`, Order.FUNCTION_CALL];
  };
  forBlock['coup_sorted_strongest'] = (block, gen) => {
    const list = gen.valueToCode(block, 'LIST', Order.NONE) || 'state.my_cards';
    const order = gen.valueToCode(block, 'ORDER', Order.NONE) || DEFAULT_ORDER;
    return [`strongest_cards(${list}, ${order})`, Order.FUNCTION_CALL];
  };

  // claim-aware card choices
  forBlock['coup_claimed_card'] = () => ['claimed_card(state)', Order.FUNCTION_CALL];
  forBlock['coup_unclaimed_card'] = () => ['unclaimed_card(state)', Order.FUNCTION_CALL];
  forBlock['coup_pool'] = () => ['pool', Order.ATOMIC];
  forBlock['coup_cards_in'] = (block, gen) => {
    const a = gen.valueToCode(block, 'A', Order.NONE) || 'state.my_cards';
    const b = gen.valueToCode(block, 'B', Order.NONE) || 'state.my_claims';
    return [`cards_in(${a}, ${b})`, Order.FUNCTION_CALL];
  };
  forBlock['coup_cards_not_in'] = (block, gen) => {
    const a = gen.valueToCode(block, 'A', Order.NONE) || 'state.my_cards';
    const b = gen.valueToCode(block, 'B', Order.NONE) || 'state.my_claims';
    return [`cards_not_in(${a}, ${b})`, Order.FUNCTION_CALL];
  };

  // game info
  forBlock['coup_state_field'] = (block) => [`state.${block.getFieldValue('FIELD')}`, Order.MEMBER];
  forBlock['coup_opponent'] = () => ['state.opponent', Order.MEMBER];
  forBlock['coup_my_lives'] = () => ['state.my_lives', Order.MEMBER];
  forBlock['coup_my_graveyard'] = () => ['state.my_graveyard', Order.MEMBER];
  forBlock['coup_opp_graveyard'] = () => ['state.opponent.graveyard', Order.MEMBER];
  forBlock['coup_prob_opp_has'] = (block, gen) => [`prob_opponent_has(state, ${gen.valueToCode(block, 'ROLE', Order.NONE) || '"duke"'})`, Order.FUNCTION_CALL];
  forBlock['coup_best_guess'] = () => ['best_coup_call(state)', Order.FUNCTION_CALL];
  forBlock['coup_unseen'] = (block, gen) => [`unseen_copies(state, ${gen.valueToCode(block, 'ROLE', Order.NONE) || '"duke"'})`, Order.FUNCTION_CALL];
  forBlock['coup_history'] = () => ['state.history', Order.MEMBER];
  forBlock['coup_attr'] = (block, gen) => [`${gen.valueToCode(block, 'OBJ', Order.MEMBER) || 'state'}.${block.getFieldValue('NAME')}`, Order.MEMBER];
  forBlock['coup_return'] = (block, gen) => {
    const v = gen.valueToCode(block, 'VALUE', Order.NONE);
    return v ? `return ${v}\n` : 'return\n';
  };
  forBlock['coup_my_cards'] = () => ['state.my_cards', Order.MEMBER];
  forBlock['coup_my_claims'] = () => ['state.my_claims', Order.MEMBER];

  // this move (the action passed to respond / when_assassinated)
  forBlock['coup_action_call'] = () => ['action.call', Order.MEMBER];
  forBlock['coup_action_is'] = (block) => [`(action.type == "${block.getFieldValue('TYPE')}")`, Order.ATOMIC];
  forBlock['coup_action_claimed_role'] = () => ['action.claimed_role', Order.MEMBER];
  forBlock['coup_action_is_block'] = () => ['action.is_block', Order.MEMBER];
  forBlock['coup_action_already_claimed'] = () => ['action.already_claimed', Order.MEMBER];
  forBlock['coup_claimed_role_impossible'] = () =>
    ['(action.claimed_role != None and state.revealed_roles[action.claimed_role] >= 3)', Order.ATOMIC];

  // smart reads
  forBlock['coup_revealed_count'] = (block) => [`state.revealed_roles["${block.getFieldValue('ROLE')}"]`, Order.MEMBER];
  forBlock['coup_role_impossible'] = (block) => [`(state.revealed_roles["${block.getFieldValue('ROLE')}"] >= 3)`, Order.ATOMIC];
  forBlock['coup_player_prop'] = (block, gen) => {
    const player = gen.valueToCode(block, 'PLAYER', Order.MEMBER) || 'state.opponent';
    return [`${player}.${block.getFieldValue('PROP')}`, Order.MEMBER];
  };
  forBlock['coup_has_role'] = (block) => [`("${block.getFieldValue('ROLE')}" in state.my_cards)`, Order.ATOMIC];
  forBlock['coup_i_have'] = (block, gen) =>
    [`(${gen.valueToCode(block, 'ROLE', Order.NONE) || '"duke"'} in state.my_cards)`, Order.ATOMIC];
  forBlock['coup_player_claimed'] = (block, gen) => {
    const player = gen.valueToCode(block, 'PLAYER', Order.MEMBER) || 'state.opponent';
    return [`("${block.getFieldValue('ROLE')}" in ${player}.claims)`, Order.ATOMIC];
  };
  forBlock['coup_role'] = (block) => [`"${block.getFieldValue('ROLE')}"`, Order.ATOMIC];
  forBlock['coup_my_card'] = (block) => {
    const idx = Number(block.getFieldValue('IDX')) || 0;
    return [`state.my_cards[${idx}]`, Order.MEMBER];
  };

  // chance / randomness
  forBlock['coup_chance_do'] = (block, gen) => {
    const p = Number(block.getFieldValue('P'));
    const doCode = gen.statementToCode(block, 'DO') || gen.INDENT + 'pass\n';
    const elseCode = gen.statementToCode(block, 'ELSE');
    let code = `if chance(${p}):\n${doCode}`;
    if (elseCode.trim().length) code += `else:\n${elseCode}`;
    return code;
  };
  forBlock['coup_chance'] = (block, gen) => [`chance(${gen.valueToCode(block, 'P', Order.NONE) || '0.5'})`, Order.FUNCTION_CALL];
  forBlock['coup_random'] = () => ['random()', Order.FUNCTION_CALL];
  forBlock['coup_random_int'] = (block) =>
    [`random_int(${Number(block.getFieldValue('A'))}, ${Number(block.getFieldValue('B'))})`, Order.FUNCTION_CALL];
  forBlock['coup_random_choice'] = (block, gen) =>
    [`choice(${gen.valueToCode(block, 'LIST', Order.NONE) || 'state.my_cards'})`, Order.FUNCTION_CALL];
  forBlock['coup_first_of'] = (block, gen) =>
    [`${gen.valueToCode(block, 'LIST', Order.MEMBER) || 'state.my_cards'}[0]`, Order.MEMBER];
  forBlock['coup_last_of'] = (block, gen) =>
    [`${gen.valueToCode(block, 'LIST', Order.MEMBER) || 'state.my_cards'}[-1]`, Order.MEMBER];

  // --- overrides so standard blocks stay inside the language subset ---
  // (defaults would import the random / math modules)
  forBlock['math_random_int'] = (block, gen) => {
    const a = gen.valueToCode(block, 'FROM', Order.NONE) || '1';
    const b = gen.valueToCode(block, 'TO', Order.NONE) || '6';
    return [`random_int(${a}, ${b})`, Order.FUNCTION_CALL];
  };
  forBlock['math_random_float'] = () => ['random()', Order.FUNCTION_CALL];
  forBlock['math_round'] = (block, gen) => {
    const op = block.getFieldValue('OP');
    const arg = gen.valueToCode(block, 'NUM', Order.NONE) || '0';
    if (op === 'ROUNDDOWN') return [`floor(${arg})`, Order.FUNCTION_CALL];
    if (op === 'ROUNDUP') return [`-floor(-(${arg}))`, Order.UNARY_SIGN];
    return [`round(${arg})`, Order.FUNCTION_CALL];
  };
}

// ---------------------------------------------------------------- theme
let theme: Blockly.Theme | null = null;
function getTheme(): Blockly.Theme {
  if (theme) return theme;
  theme = Blockly.Theme.defineTheme('coupDark', {
    name: 'coupDark',
    base: Blockly.Themes.Classic,
    fontStyle: { family: 'Georgia, serif', size: 12 },
    componentStyles: {
      workspaceBackgroundColour: '#161d24',
      toolboxBackgroundColour: '#1c242b',
      toolboxForegroundColour: '#e9ddbf',
      flyoutBackgroundColour: '#12181e',
      flyoutForegroundColour: '#9aa5ad',
      flyoutOpacity: 1,
      scrollbarColour: '#2e3a44',
      scrollbarOpacity: 0.6,
      insertionMarkerColour: '#c9a84c',
      insertionMarkerOpacity: 0.5,
      cursorColour: '#c9a84c',
      selectedGlowColour: '#c9a84c',
    },
    categoryStyles: {
      events_cat: { colour: C_EVENT },
      actions_cat: { colour: C_ACTION },
      responses_cat: { colour: C_RESPONSE },
      move_cat: { colour: C_MOVE },
      info_cat: { colour: C_INFO },
      chance_cat: { colour: C_CHANCE },
      logic_category: { colour: '#5b80a5' },
      loop_category: { colour: '#5ba55b' },
      math_category: { colour: '#5b67a5' },
      list_category: { colour: '#745ba5' },
      text_category: { colour: '#a5745b' },
      variable_category: { colour: '#a55b99' },
      procedure_category: { colour: '#995ba5' },
    },
    blockStyles: {},
  });
  return theme;
}

// ---------------------------------------------------------------- toolbox
export function makeToolbox(): Blockly.utils.toolbox.ToolboxDefinition {
  const oppShadow = () => ({ shadow: { type: 'coup_opponent' } });
  const roleShadow = (role: string) => ({ shadow: { type: 'coup_role', fields: { ROLE: role } } });
  const bestGuess = () => ({ block: { type: 'coup_best_guess' } });
  // a fresh power-order block with a sensible default ranking
  const powerOrder = () => ({
    block: { type: 'coup_power_order', fields: { R1: 'duke', R2: 'contessa', R3: 'assassin', R4: 'ambassador' } },
  });
  const toolbox = {
    kind: 'categoryToolbox',
    contents: [
      {
        kind: 'category', name: 'My Turn / Events', categorystyle: 'events_cat',
        contents: [
          { kind: 'block', type: 'coup_when_turn' },
          { kind: 'block', type: 'coup_when_respond' },
          { kind: 'block', type: 'coup_when_assassinated' },
          { kind: 'block', type: 'coup_choose_lose' },
          { kind: 'block', type: 'coup_choose_exchange' },
        ],
      },
      {
        kind: 'category', name: 'Actions', categorystyle: 'actions_cat',
        contents: [
          { kind: 'block', type: 'coup_income' },
          { kind: 'block', type: 'coup_foreign_aid' },
          { kind: 'block', type: 'coup_tax' },
          { kind: 'block', type: 'coup_exchange' },
          { kind: 'block', type: 'coup_coup', inputs: { ROLE: roleShadow('duke') } },
          // Coup calling my best guess at their card
          { kind: 'block', type: 'coup_coup', inputs: { ROLE: bestGuess() } },
          { kind: 'block', type: 'coup_assassinate', inputs: { ROLE: roleShadow('assassin') } },
          // Assassinate calling my best guess
          { kind: 'block', type: 'coup_assassinate', inputs: { ROLE: bestGuess() } },
        ],
      },
      {
        kind: 'category', name: 'Responses', categorystyle: 'responses_cat',
        contents: [
          { kind: 'block', type: 'coup_allow' },
          { kind: 'block', type: 'coup_challenge' },
          { kind: 'block', type: 'coup_block' },
          { kind: 'block', type: 'coup_block_contessa' },
          // dodge: if they named a card I don't hold, just allow it (it misses)
          {
            kind: 'block', type: 'controls_if',
            inputs: {
              IF0: { block: { type: 'logic_negate', inputs: { BOOL: { block: { type: 'coup_i_have', inputs: { ROLE: { block: { type: 'coup_action_call' } } } } } } } },
              DO0: { block: { type: 'coup_allow' } },
            },
          },
          { kind: 'block', type: 'coup_reveal', inputs: { ROLE: { shadow: { type: 'coup_my_card', fields: { IDX: 0 } } } } },
          // reveal my weakest card: last of (my cards sorted strongest-first)
          {
            kind: 'block', type: 'coup_reveal',
            inputs: {
              ROLE: {
                block: {
                  type: 'coup_last_of',
                  inputs: { LIST: { block: { type: 'coup_sorted_strongest', inputs: { LIST: { block: { type: 'coup_my_cards' } }, ORDER: powerOrder() } } } },
                },
              },
            },
          },
          // give up a card whose role I already claimed — keeps my hidden card hidden
          { kind: 'block', type: 'coup_reveal', inputs: { ROLE: { block: { type: 'coup_claimed_card' } } } },
          { kind: 'block', type: 'coup_claimed_card' },
          { kind: 'block', type: 'coup_unclaimed_card' },
          { kind: 'block', type: 'coup_return', inputs: { VALUE: { block: { type: 'logic_boolean', fields: { BOOL: 'TRUE' } } } } },
          // exchange keeps are usually your card count — start the list at 2 sockets
          { kind: 'block', type: 'coup_keep', inputs: { LIST: { block: { type: 'lists_create_with', extraState: { itemCount: 2 } } } } },
          { kind: 'block', type: 'coup_keep_strongest', inputs: { ORDER: powerOrder() } },
          // exchange for cards nobody suspects: keep strongest of pool cards not among my claims
          { kind: 'block', type: 'coup_keep_strongest', inputs: { FROM: { block: { type: 'coup_cards_not_in', inputs: { A: { block: { type: 'coup_pool' } }, B: { block: { type: 'coup_my_claims' } } } } }, ORDER: powerOrder() } },
          { kind: 'block', type: 'coup_power_order', fields: { R1: 'duke', R2: 'contessa', R3: 'assassin', R4: 'ambassador' } },
          { kind: 'block', type: 'coup_pool' },
          { kind: 'block', type: 'coup_cards_in', inputs: { A: { block: { type: 'coup_my_cards' } }, B: { block: { type: 'coup_my_claims' } } } },
          { kind: 'block', type: 'coup_cards_not_in', inputs: { A: { block: { type: 'coup_pool' } }, B: { block: { type: 'coup_my_claims' } } } },
        ],
      },
      {
        kind: 'category', name: 'This Move', categorystyle: 'move_cat',
        contents: [
          { kind: 'label', text: 'Use these inside "when my opponent makes a move" / "when I am assassinated"' },
          { kind: 'block', type: 'coup_action_call' },
          { kind: 'block', type: 'coup_action_is' },
          { kind: 'block', type: 'coup_action_claimed_role' },
          { kind: 'block', type: 'coup_action_is_block' },
          { kind: 'block', type: 'coup_action_already_claimed' },
          { kind: 'block', type: 'coup_claimed_role_impossible' },
          // ready-made: call an impossible claim's bluff instantly
          {
            kind: 'block', type: 'controls_if',
            inputs: {
              IF0: { block: { type: 'coup_claimed_role_impossible' } },
              DO0: { block: { type: 'coup_challenge' } },
            },
          },
          // do I hold the card they just called?
          { kind: 'block', type: 'coup_i_have', inputs: { ROLE: { block: { type: 'coup_action_call' } } } },
          // read the mover — in heads-up that's always "my opponent"
          { kind: 'block', type: 'coup_player_prop', fields: { PROP: 'scrim_bluff_rate' }, inputs: { PLAYER: { block: { type: 'coup_opponent' } } } },
          { kind: 'block', type: 'coup_player_claimed', fields: { ROLE: 'contessa' }, inputs: { PLAYER: { block: { type: 'coup_opponent' } } } },
        ],
      },
      {
        kind: 'category', name: 'Game Info', categorystyle: 'info_cat',
        contents: [
          { kind: 'block', type: 'coup_state_field' },
          { kind: 'block', type: 'coup_my_lives' },
          { kind: 'block', type: 'coup_has_role' },
          { kind: 'block', type: 'coup_i_have', inputs: { ROLE: roleShadow('duke') } },
          { kind: 'block', type: 'coup_opponent' },
          { kind: 'block', type: 'coup_player_prop', fields: { PROP: 'coins' }, inputs: { PLAYER: oppShadow() } },
          { kind: 'block', type: 'coup_player_claimed', inputs: { PLAYER: oppShadow() } },
          // the card-counting workhorses
          { kind: 'block', type: 'coup_prob_opp_has', inputs: { ROLE: roleShadow('duke') } },
          { kind: 'block', type: 'coup_best_guess' },
          { kind: 'block', type: 'coup_unseen', inputs: { ROLE: roleShadow('duke') } },
          { kind: 'block', type: 'coup_revealed_count' },
          { kind: 'block', type: 'coup_role_impossible' },
          // graveyards
          { kind: 'block', type: 'coup_my_graveyard' },
          { kind: 'block', type: 'coup_opp_graveyard' },
          { kind: 'block', type: 'coup_history' },
          { kind: 'block', type: 'coup_attr', inputs: { OBJ: { block: { type: 'coup_opponent' } } } },
          // my hand / claims
          { kind: 'block', type: 'coup_my_cards' },
          { kind: 'block', type: 'coup_my_claims' },
          { kind: 'block', type: 'coup_sorted_strongest', inputs: { LIST: { block: { type: 'coup_my_cards' } }, ORDER: powerOrder() } },
          { kind: 'block', type: 'coup_strongest_n', inputs: { LIST: { block: { type: 'coup_my_cards' } }, ORDER: powerOrder() } },
          { kind: 'block', type: 'coup_power_order', fields: { R1: 'duke', R2: 'contessa', R3: 'assassin', R4: 'ambassador' } },
          { kind: 'block', type: 'coup_role' },
          { kind: 'block', type: 'coup_my_card' },
          { kind: 'block', type: 'coup_first_of' },
          { kind: 'block', type: 'coup_last_of' },
        ],
      },
      {
        kind: 'category', name: 'Chance', categorystyle: 'chance_cat',
        contents: [
          { kind: 'block', type: 'coup_chance_do' },
          { kind: 'block', type: 'coup_chance', inputs: { P: { shadow: { type: 'math_number', fields: { NUM: 0.5 } } } } },
          { kind: 'block', type: 'coup_random' },
          { kind: 'block', type: 'coup_random_int' },
          { kind: 'block', type: 'coup_random_choice', inputs: { LIST: { block: { type: 'coup_my_cards' } } } },
        ],
      },
      { kind: 'sep' },
      {
        kind: 'category', name: 'Logic', categorystyle: 'logic_category',
        contents: [
          { kind: 'block', type: 'controls_if' },
          { kind: 'block', type: 'logic_compare', fields: { OP: 'EQ' } },
          { kind: 'block', type: 'logic_operation', fields: { OP: 'AND' } },
          { kind: 'block', type: 'logic_negate' },
          { kind: 'block', type: 'logic_boolean' },
          { kind: 'block', type: 'logic_null' },
          {
            kind: 'block', type: 'logic_ternary',
            inputs: {
              THEN: { block: { type: 'coup_role', fields: { ROLE: 'duke' } } },
              ELSE: { block: { type: 'coup_role', fields: { ROLE: 'assassin' } } },
            },
          },
        ],
      },
      {
        kind: 'category', name: 'Math', categorystyle: 'math_category',
        contents: [
          { kind: 'block', type: 'math_number', fields: { NUM: 0 } },
          {
            kind: 'block', type: 'math_arithmetic', fields: { OP: 'ADD' },
            inputs: {
              A: { shadow: { type: 'math_number', fields: { NUM: 1 } } },
              B: { shadow: { type: 'math_number', fields: { NUM: 1 } } },
            },
          },
          {
            kind: 'block', type: 'math_modulo',
            inputs: {
              DIVIDEND: { shadow: { type: 'math_number', fields: { NUM: 10 } } },
              DIVISOR: { shadow: { type: 'math_number', fields: { NUM: 2 } } },
            },
          },
          { kind: 'block', type: 'math_round', inputs: { NUM: { shadow: { type: 'math_number', fields: { NUM: 3.1 } } } } },
        ],
      },
      {
        kind: 'category', name: 'Loops', categorystyle: 'loop_category',
        contents: [
          { kind: 'block', type: 'controls_repeat_ext', inputs: { TIMES: { shadow: { type: 'math_number', fields: { NUM: 3 } } } } },
          { kind: 'block', type: 'controls_whileUntil' },
          { kind: 'block', type: 'controls_forEach' },
          { kind: 'block', type: 'controls_flow_statements' },
        ],
      },
      {
        kind: 'category', name: 'Lists', categorystyle: 'list_category',
        contents: [
          { kind: 'block', type: 'lists_create_with' },
          { kind: 'block', type: 'lists_length' },
          { kind: 'block', type: 'lists_isEmpty' },
          { kind: 'block', type: 'coup_my_cards' },
          { kind: 'block', type: 'coup_first_of', inputs: { LIST: { block: { type: 'coup_my_cards' } } } },
          { kind: 'block', type: 'coup_last_of', inputs: { LIST: { block: { type: 'coup_my_cards' } } } },
        ],
      },
      {
        kind: 'category', name: 'Text', categorystyle: 'text_category',
        contents: [
          { kind: 'block', type: 'text' },
          { kind: 'block', type: 'text_print', inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: 'hi' } } } } },
        ],
      },
      { kind: 'category', name: 'Variables', categorystyle: 'variable_category', custom: 'VARIABLE' },
      { kind: 'category', name: 'Functions', categorystyle: 'procedure_category', custom: 'PROCEDURE' },
    ],
  };
  return toolbox as unknown as Blockly.utils.toolbox.ToolboxDefinition;
}

// ---------------------------------------------------------------- setup + gen
let registered = false;
export function ensureBlocklySetup() {
  if (registered) return;
  // We import from 'blockly/core', so English messages aren't auto-loaded —
  // load them before any block init reads Blockly.Msg.
  Blockly.setLocale(En as unknown as { [key: string]: string });
  Blockly.defineBlocksWithJsonArray(BLOCKS);
  registerGenerators();
  registered = true;
}

export function coupTheme(): Blockly.Theme {
  return getTheme();
}

// canonical top-block order: the five hats first, then procedures / others
const HAT_ORDER = [
  'coup_when_turn', 'coup_when_respond', 'coup_when_assassinated',
  'coup_choose_lose', 'coup_choose_exchange',
];

/** True if any two top-level blocks' bounding boxes overlap. */
function topBlocksOverlap(blocks: Blockly.BlockSvg[]): boolean {
  const rects = blocks.map((b) => b.getBoundingRectangle());
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], c = rects[j];
      if (a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom) return true;
    }
  }
  return false;
}

/**
 * Lay top-level blocks out in tidy columns so they never overlap. `force`
 * always re-lays out (use after a decompile); otherwise it only acts when an
 * overlap is detected (so a kid's own tidy arrangement is left alone). Moves
 * are event-suppressed so this never marks the workspace dirty. Call after
 * svgResize so getHeightWidth measurements are real.
 */
export function tidyWorkspace(ws: Blockly.WorkspaceSvg, force = false): void {
  const tops = ws.getTopBlocks(false) as Blockly.BlockSvg[];
  if (tops.length < 1) return;
  if (!force && !topBlocksOverlap(tops)) return;

  const rank = (b: Blockly.BlockSvg) => {
    const i = HAT_ORDER.indexOf(b.type);
    return i < 0 ? HAT_ORDER.length : i;
  };
  const sorted = [...tops].sort((a, b) => rank(a) - rank(b));

  Blockly.Events.disable();
  try {
    const GAP_Y = 28, GAP_X = 56, COL_MAX = 720, X0 = 20, Y0 = 20;
    let colX = X0, y = Y0, colWidth = 0;
    for (const b of sorted) {
      const hw = b.getHeightWidth();
      if (y > Y0 && y + hw.height > COL_MAX) { colX += colWidth + GAP_X; y = Y0; colWidth = 0; }
      const xy = b.getRelativeToSurfaceXY();
      b.moveBy(colX - xy.x, y - xy.y);
      y += hw.height + GAP_Y;
      colWidth = Math.max(colWidth, hw.width);
    }
  } finally {
    Blockly.Events.enable();
  }
}

/** Generate bot-language Python for the whole workspace. */
export function generatePython(workspace: Blockly.Workspace): string {
  ensureBlocklySetup();
  let code = pythonGenerator.workspaceToCode(workspace);
  // Blockly's Python generator treats every block variable as a global: it
  // seeds top-level `x = None` lines and adds `global x` inside functions.
  // botlang has neither and forbids both (top level = defs only), so the
  // variables kids/decompiled bots use are already plain function locals —
  // drop the injected lines.
  code = code.replace(/^[A-Za-z_]\w* = None *$/gm, '').replace(/^[ \t]*global .*$/gm, '');
  return code.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// ---------------------------------------------------------------- starter
export const STARTER_PYTHON = `# ================= MY COUP BOT =================
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
`;

// small serialization helpers for the starter layout
const iHave = (role: string) => ({ block: { type: 'coup_has_role', fields: { ROLE: role } } });
const actionIs = (t: string) => ({ block: { type: 'coup_action_is', fields: { TYPE: t } } });
const andOf = (a: object, b: object) => ({ block: { type: 'logic_operation', fields: { OP: 'AND' }, inputs: { A: a, B: b } } });

/**
 * The block layout every new/empty slot starts from — the heads-up scaffold,
 * identical in logic to STARTER_PYTHON.
 */
export function starterWorkspaceJson(): object {
  return {
    blocks: {
      languageVersion: 0,
      blocks: [
        {
          type: 'coup_when_turn', x: 40, y: 40,
          inputs: {
            DO: {
              block: {
                type: 'controls_if',
                inputs: {
                  IF0: {
                    block: {
                      type: 'logic_compare', fields: { OP: 'GTE' },
                      inputs: {
                        A: { block: { type: 'coup_state_field', fields: { FIELD: 'my_coins' } } },
                        B: { shadow: { type: 'math_number', fields: { NUM: 7 } } },
                      },
                    },
                  },
                  DO0: { block: { type: 'coup_coup', inputs: { ROLE: { block: { type: 'coup_best_guess' } } } } },
                },
                next: {
                  block: {
                    type: 'controls_if',
                    inputs: {
                      IF0: iHave('duke'),
                      DO0: { block: { type: 'coup_tax' } },
                    },
                    next: { block: { type: 'coup_income' } },
                  },
                },
              },
            },
          },
        },
        {
          type: 'coup_when_respond', x: 560, y: 40,
          inputs: {
            DO: {
              block: {
                type: 'controls_if',
                inputs: {
                  IF0: andOf(actionIs('foreign_aid'), iHave('duke')),
                  DO0: { block: { type: 'coup_block', fields: { ROLE: 'duke' } } },
                },
                next: { block: { type: 'coup_allow' } },
              },
            },
          },
        },
        {
          type: 'coup_when_assassinated', x: 560, y: 330,
          inputs: {
            DO: {
              block: {
                type: 'controls_if',
                inputs: {
                  IF0: { block: { type: 'logic_negate', inputs: { BOOL: { block: { type: 'coup_i_have', inputs: { ROLE: { block: { type: 'coup_action_call' } } } } } } } },
                  DO0: { block: { type: 'coup_allow' } },
                },
                next: {
                  block: {
                    type: 'controls_if',
                    inputs: {
                      IF0: iHave('contessa'),
                      DO0: { block: { type: 'coup_block_contessa' } },
                    },
                    next: { block: { type: 'coup_block_contessa' } },
                  },
                },
              },
            },
          },
        },
        {
          type: 'coup_choose_lose', x: 40, y: 500,
          inputs: {
            DO: {
              block: {
                type: 'coup_reveal',
                inputs: { ROLE: { block: { type: 'coup_my_card', fields: { IDX: 0 } } } },
              },
            },
          },
        },
      ],
    },
  };
}
