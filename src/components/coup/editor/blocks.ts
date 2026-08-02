/**
 * Blockly wiring for the dynaCOUP bot editor.
 *
 * Everything the visual editor needs lives here: the custom Coup blocks, the
 * Python generators that turn them into the bot language (see server/botlang.js
 * for the exact subset), a dark court-intrigue theme, the toolbox, and the
 * starter workspace new students begin from.
 *
 * CRITICAL invariant: every generator here must emit code the botlang parser
 * accepts — no imports, lambdas, f-strings, tuples, slicing, comprehensions or
 * keyword args. We override the few standard-block generators that would
 * otherwise reach for the `random`/`math` modules, and the toolbox only offers
 * standard blocks whose default output already conforms.
 */
import * as Blockly from 'blockly/core';
import { pythonGenerator, Order } from 'blockly/python';
import * as En from 'blockly/msg/en';
import 'blockly/blocks';

type Gen = typeof pythonGenerator;

const ROLE_OPTIONS: [string, string][] = [
  ['Duke', 'duke'],
  ['Assassin', 'assassin'],
  ['Captain', 'captain'],
  ['Ambassador', 'ambassador'],
  ['Contessa', 'contessa'],
];

// fallback power ranking when a strongest-cards ORDER socket is left empty
const DEFAULT_ORDER = '["duke", "contessa", "captain", "assassin", "ambassador"]';

// numeric opponent stats for opponent_with_most / _least (label → prop)
const OPP_STAT_OPTIONS: [string, string][] = [
  ['coins', 'coins'],
  ['cards', 'num_cards'],
  ['roles claimed', 'claims'],
  ['cards lost', 'cards_lost'],
  ['challenges made', 'challenges_made'],
  ['successful challenges', 'successful_challenges'],
  ['times caught bluffing', 'times_caught_bluffing'],
  ['attacks on me', 'attacked_me'],
  ['ladder challenge success', 'scrim_challenge_success'],
  ['ladder bluff rate', 'scrim_bluff_rate'],
  ['ladder win rate', 'scrim_win_rate'],
];

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
    message0: 'when I can react to %1',
    args0: [{ type: 'field_label', name: 'L', text: 'someone’s move' }],
    message1: 'do %1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    colour: C_EVENT,
    tooltip: 'Someone did something you may challenge or block. Use "action" to inspect it.',
    hat: 'cap',
  },
  {
    type: 'coup_when_assassinated',
    message0: 'when I am assassinated 🗡',
    message1: 'do %1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    colour: C_EVENT,
    tooltip: 'Block with a Contessa, or reveal a card to give up.',
    hat: 'cap',
  },
  {
    type: 'coup_choose_lose',
    message0: 'when I must lose a card 💀',
    message1: 'do %1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    colour: C_EVENT,
    tooltip: 'Pick which of your cards to flip face-up.',
    hat: 'cap',
  },
  {
    type: 'coup_choose_exchange',
    message0: 'when I exchange, from the pool %1',
    args0: [{ type: 'field_label', name: 'L', text: '(advanced)' }],
    message1: 'do %1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    colour: C_EVENT,
    tooltip: 'Ambassador exchange: return a list of role names to keep.',
    hat: 'cap',
  },

  // ---- actions (terminate a turn) -----------------------------------
  { type: 'coup_income', message0: 'take Income (+1) 💰', previousStatement: null, colour: C_ACTION, tooltip: 'Safe +1 coin. Nobody can stop it.' },
  { type: 'coup_foreign_aid', message0: 'take Foreign Aid (+2) 💰💰', previousStatement: null, colour: C_ACTION, tooltip: '+2 coins, unless someone claims a Duke to block it.' },
  { type: 'coup_tax', message0: 'claim Duke → Tax (+3) 👑', previousStatement: null, colour: C_ACTION, tooltip: 'Duke gets +3. A bluff can be challenged.' },
  { type: 'coup_exchange', message0: 'claim Ambassador → Exchange ⚜', previousStatement: null, colour: C_ACTION, tooltip: 'Swap cards with the deck.' },
  {
    type: 'coup_steal', message0: 'claim Captain → Steal from %1',
    args0: [{ type: 'input_value', name: 'TARGET' }],
    previousStatement: null, inputsInline: true, colour: C_ACTION,
    tooltip: 'Take up to 2 coins from a player. Blockable by Captain/Ambassador.',
  },
  {
    type: 'coup_coup', message0: 'Coup (pay 7) 💥 %1',
    args0: [{ type: 'input_value', name: 'TARGET' }],
    previousStatement: null, inputsInline: true, colour: C_ACTION,
    tooltip: 'Costs 7 coins. Unstoppable — knocks out a card.',
  },
  {
    type: 'coup_assassinate',
    message0: 'claim Assassin → Assassinate 🗡 %1',
    args0: [{ type: 'input_value', name: 'TARGET' }],
    message1: 'if they block with Contessa, challenge with chance %1',
    args1: [{ type: 'field_number', name: 'P', value: 0.3, min: 0, max: 1, precision: 0.05 }],
    previousStatement: null, inputsInline: true, colour: C_ACTION,
    tooltip: 'Costs 3 coins. Blockable by Contessa — set how often you call their bluff.',
  },

  // ---- responses ----------------------------------------------------
  { type: 'coup_allow', message0: 'allow it ✔', previousStatement: null, colour: C_RESPONSE, tooltip: 'Let the move happen.' },
  { type: 'coup_challenge', message0: 'challenge! ✋', previousStatement: null, colour: C_RESPONSE, tooltip: 'Call their bluff — someone loses a card.' },
  {
    type: 'coup_block', message0: 'block by claiming %1',
    args0: [{ type: 'field_dropdown', name: 'ROLE', options: ROLE_OPTIONS }],
    previousStatement: null, colour: C_RESPONSE,
    tooltip: 'Claim a role to stop the action (e.g. Duke blocks Foreign Aid).',
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
    tooltip: 'Ambassador exchange: keeps exactly as many cards as you have lives (2 if you have 2), strongest by your ranking. Leave "from" empty to use the whole exchange pool. If the source list has fewer cards than you need, it keeps what it can and the game fills the rest.',
  },

  // ---- power ordering (value blocks) -------------------------------
  {
    type: 'coup_power_order',
    message0: 'card power order: 1st %1 2nd %2 3rd %3 4th %4 5th %5',
    args0: [
      { type: 'field_dropdown', name: 'R1', options: ROLE_OPTIONS },
      { type: 'field_dropdown', name: 'R2', options: ROLE_OPTIONS },
      { type: 'field_dropdown', name: 'R3', options: ROLE_OPTIONS },
      { type: 'field_dropdown', name: 'R4', options: ROLE_OPTIONS },
      { type: 'field_dropdown', name: 'R5', options: ROLE_OPTIONS },
    ],
    output: 'Array', inputsInline: true, colour: C_INFO,
    tooltip: 'Your personal ranking of the 5 roles, strongest first. Plug it into the strongest-cards blocks.',
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
  { type: 'coup_claimed_card', message0: 'a card I have claimed', output: 'String', colour: C_INFO, tooltip: 'A card whose role you already told everyone about. Giving THIS one up keeps your secret card secret.' },
  { type: 'coup_unclaimed_card', message0: 'a card I have NOT claimed', output: 'String', colour: C_INFO, tooltip: 'A card nobody knows about. Give this up to keep your public claims backed by a real card.' },
  { type: 'coup_pool', message0: 'the exchange pool', output: 'Array', colour: C_INFO, tooltip: 'The cards offered to you in an Ambassador exchange (only inside the exchange hat).' },
  {
    type: 'coup_cards_in', message0: 'cards in %1 also in %2',
    args0: [{ type: 'input_value', name: 'A' }, { type: 'input_value', name: 'B' }],
    output: 'Array', inputsInline: true, colour: C_INFO, tooltip: 'The role names from the first list that also appear in the second.',
  },
  {
    type: 'coup_cards_not_in', message0: 'cards in %1 NOT in %2',
    args0: [{ type: 'input_value', name: 'A' }, { type: 'input_value', name: 'B' }],
    output: 'Array', inputsInline: true, colour: C_INFO, tooltip: 'The role names from the first list that are missing from the second — e.g. exchange for cards nobody suspects.',
  },
  {
    type: 'coup_reveal', message0: 'give up card %1',
    args0: [{ type: 'input_value', name: 'ROLE' }],
    previousStatement: null, inputsInline: true, colour: C_RESPONSE,
    tooltip: 'Flip one of your cards face-up (lose it).',
  },

  // ---- this move (inspect the action being reacted to) -------------
  { type: 'coup_action_actor', message0: 'who made this move', output: 'Player', colour: C_MOVE, tooltip: 'The player who made the move you are reacting to. Only meaningful inside "when I can react" / "when I am assassinated".' },
  { type: 'coup_action_target', message0: 'the target of this move', output: 'Player', colour: C_MOVE, tooltip: 'Who the move is aimed at (may be nobody). Reaction hats only.' },
  {
    type: 'coup_action_is', message0: 'this move is %1',
    args0: [{
      type: 'field_dropdown', name: 'TYPE', options: [
        ['Income', 'income'], ['Foreign Aid', 'foreign_aid'], ['Tax', 'tax'],
        ['Steal', 'steal'], ['Assassinate', 'assassinate'], ['Exchange', 'exchange'], ['Coup', 'coup'],
      ],
    }],
    output: 'Boolean', colour: C_MOVE, tooltip: 'True if the move you are reacting to is that kind. Reaction hats only.',
  },
  { type: 'coup_action_claimed_role', message0: 'the role they claim', output: 'String', colour: C_MOVE, tooltip: 'The role the mover is claiming, e.g. "duke". Reaction hats only.' },
  { type: 'coup_action_is_block', message0: 'this is a block', output: 'Boolean', colour: C_MOVE, tooltip: 'True if the move you are reacting to is someone blocking. Reaction hats only.' },
  { type: 'coup_action_blocker', message0: 'who is blocking', output: 'Player', colour: C_MOVE, tooltip: 'The player doing the blocking (when this is a block). Reaction hats only.' },
  { type: 'coup_action_targets_me', message0: 'the move targets me', output: 'Boolean', colour: C_MOVE, tooltip: 'True if this move is aimed at you. Reaction hats only.' },
  { type: 'coup_action_already_claimed', message0: 'they already claimed this role before ✓', output: 'Boolean', colour: C_MOVE, tooltip: 'True if this player claimed this same role earlier in the game. A consistent story is more believable; a brand-new claim is more likely a bluff.' },
  { type: 'coup_claimed_role_impossible', message0: 'the role they claim is impossible now', output: 'Boolean', colour: C_MOVE, tooltip: 'True when all 3 copies of the claimed role are already face-up — a guaranteed bluff. Free challenge!' },

  // ---- game info (values) ------------------------------------------
  {
    type: 'coup_state_field', message0: '%1',
    args0: [{
      type: 'field_dropdown', name: 'FIELD', options: [
        ['my coins', 'my_coins'],
        ['my name', 'my_name'],
        ['my number of cards', 'my_num_cards'],
        ['players still alive', 'num_alive'],
        ['cards left in deck', 'deck_count'],
        ['turn number', 'turn_number'],
      ],
    }],
    output: null, colour: C_INFO, tooltip: 'A fact about the current game.',
  },
  {
    type: 'coup_player_pick', message0: '%1',
    args0: [{
      type: 'field_dropdown', name: 'FIELD', options: [
        ['the richest player', 'richest_player'],
        ['the strongest player', 'strongest_player'],
        ['the weakest player', 'weakest_player'],
      ],
    }],
    output: 'Player', colour: C_INFO, tooltip: 'A player picked out by the game.',
  },
  { type: 'coup_random_opponent', message0: 'a random opponent 🎲', output: 'Player', colour: C_INFO, tooltip: 'One of the players who are still in (not you).' },
  {
    type: 'coup_revealed_count', message0: 'how many %1 are face-up',
    args0: [{ type: 'field_dropdown', name: 'ROLE', options: ROLE_OPTIONS }],
    output: 'Number', colour: C_INFO, tooltip: 'How many copies of that role have been revealed (0–3). Three exist of each.',
  },
  {
    type: 'coup_role_impossible', message0: '%1 is impossible now',
    args0: [{ type: 'field_dropdown', name: 'ROLE', options: ROLE_OPTIONS }],
    output: 'Boolean', colour: C_INFO, tooltip: 'True when all 3 copies of that role are face-up — nobody can truthfully claim it anymore.',
  },
  {
    type: 'coup_opp_most', message0: 'the opponent with the most %1',
    args0: [{ type: 'field_dropdown', name: 'STAT', options: OPP_STAT_OPTIONS }],
    output: 'Player', colour: C_INFO, tooltip: 'The opponent who leads that stat (or nobody). Safe to use as a target; if in doubt, compare != None.',
  },
  {
    type: 'coup_opp_least', message0: 'the opponent with the least %1',
    args0: [{ type: 'field_dropdown', name: 'STAT', options: OPP_STAT_OPTIONS }],
    output: 'Player', colour: C_INFO, tooltip: 'The opponent lowest in that stat (or nobody). Safe to use as a target; if in doubt, compare != None.',
  },
  { type: 'coup_opponents', message0: 'list of my opponents', output: 'Array', colour: C_INFO, tooltip: 'Everyone still alive except you.' },
  { type: 'coup_my_cards', message0: 'my cards (list)', output: 'Array', colour: C_INFO, tooltip: 'Your own face-down role cards, as a list.' },
  { type: 'coup_my_claims', message0: 'roles I have claimed (list)', output: 'Array', colour: C_INFO, tooltip: 'Every role you have claimed so far this game.' },
  {
    type: 'coup_player_prop', message0: '%1 of %2',
    args0: [
      {
        type: 'field_dropdown', name: 'PROP', options: [
          ['name', 'name'],
          ['coins', 'coins'],
          ['number of cards', 'num_cards'],
          ['cards lost', 'cards_lost'],
          ['is alive', 'alive'],
          ['is me', 'is_me'],
          ['claimed roles', 'claims'],
          ['challenges made', 'challenges_made'],
          ['successful challenges', 'successful_challenges'],
          ['times caught bluffing', 'times_caught_bluffing'],
          ['has attacked me', 'attacked_me'],
          ['ladder challenge success', 'scrim_challenge_success'],
          ['ladder bluff rate', 'scrim_bluff_rate'],
          ['ladder win rate', 'scrim_win_rate'],
        ],
      },
      { type: 'input_value', name: 'PLAYER' },
    ],
    output: null, inputsInline: true, colour: C_INFO, tooltip: 'Read a detail about a player.',
  },
  {
    type: 'coup_has_role', message0: 'I have a %1',
    args0: [{ type: 'field_dropdown', name: 'ROLE', options: ROLE_OPTIONS }],
    output: 'Boolean', colour: C_INFO, tooltip: 'True if that role is one of your face-down cards.',
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
    args0: [{ type: 'field_number', name: 'P', value: 0.5, min: 0, max: 1, precision: 0.05 }],
    output: 'Boolean', colour: C_CHANCE, tooltip: 'True with the given probability.',
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

  // actions
  forBlock['coup_income'] = () => 'return income()\n';
  forBlock['coup_foreign_aid'] = () => 'return foreign_aid()\n';
  forBlock['coup_tax'] = () => 'return tax()\n';
  forBlock['coup_exchange'] = () => 'return exchange()\n';
  forBlock['coup_steal'] = (block, gen) =>
    `return steal(${gen.valueToCode(block, 'TARGET', Order.NONE) || 'state.richest_player'})\n`;
  forBlock['coup_coup'] = (block, gen) =>
    `return coup(${gen.valueToCode(block, 'TARGET', Order.NONE) || 'state.strongest_player'})\n`;
  forBlock['coup_assassinate'] = (block, gen) => {
    const target = gen.valueToCode(block, 'TARGET', Order.NONE) || 'state.weakest_player';
    const p = Number(block.getFieldValue('P'));
    return `return assassinate(${target}, ${p})\n`;
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
    const roles = ['R1', 'R2', 'R3', 'R4', 'R5'].map((f) => `"${block.getFieldValue(f)}"`);
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
  forBlock['coup_player_pick'] = (block) => [`state.${block.getFieldValue('FIELD')}`, Order.MEMBER];
  forBlock['coup_random_opponent'] = () => ['choice(state.opponents)', Order.FUNCTION_CALL];
  forBlock['coup_opponents'] = () => ['state.opponents', Order.MEMBER];
  forBlock['coup_my_cards'] = () => ['state.my_cards', Order.MEMBER];
  forBlock['coup_my_claims'] = () => ['state.my_claims', Order.MEMBER];

  // this move (the action passed to respond / when_assassinated)
  forBlock['coup_action_actor'] = () => ['action.actor', Order.MEMBER];
  forBlock['coup_action_target'] = () => ['action.target', Order.MEMBER];
  forBlock['coup_action_is'] = (block) => [`(action.type == "${block.getFieldValue('TYPE')}")`, Order.ATOMIC];
  forBlock['coup_action_claimed_role'] = () => ['action.claimed_role', Order.MEMBER];
  forBlock['coup_action_is_block'] = () => ['action.is_block', Order.MEMBER];
  forBlock['coup_action_blocker'] = () => ['action.blocker', Order.MEMBER];
  forBlock['coup_action_targets_me'] = () => ['(action.target != None and action.target.is_me)', Order.ATOMIC];
  forBlock['coup_action_already_claimed'] = () => ['action.already_claimed', Order.MEMBER];
  forBlock['coup_claimed_role_impossible'] = () =>
    ['(action.claimed_role != None and state.revealed_roles[action.claimed_role] >= 3)', Order.ATOMIC];

  // smart reads
  forBlock['coup_revealed_count'] = (block) => [`state.revealed_roles["${block.getFieldValue('ROLE')}"]`, Order.MEMBER];
  forBlock['coup_role_impossible'] = (block) => [`(state.revealed_roles["${block.getFieldValue('ROLE')}"] >= 3)`, Order.ATOMIC];
  forBlock['coup_opp_most'] = (block) => [`opponent_with_most(state, "${block.getFieldValue('STAT')}")`, Order.FUNCTION_CALL];
  forBlock['coup_opp_least'] = (block) => [`opponent_with_least(state, "${block.getFieldValue('STAT')}")`, Order.FUNCTION_CALL];
  forBlock['coup_player_prop'] = (block, gen) => {
    const player = gen.valueToCode(block, 'PLAYER', Order.MEMBER) || 'state.richest_player';
    return [`${player}.${block.getFieldValue('PROP')}`, Order.MEMBER];
  };
  forBlock['coup_has_role'] = (block) => [`("${block.getFieldValue('ROLE')}" in state.my_cards)`, Order.ATOMIC];
  forBlock['coup_player_claimed'] = (block, gen) => {
    const player = gen.valueToCode(block, 'PLAYER', Order.MEMBER) || 'state.richest_player';
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
  forBlock['coup_chance'] = (block) => [`chance(${Number(block.getFieldValue('P'))})`, Order.FUNCTION_CALL];
  forBlock['coup_random'] = () => ['random()', Order.FUNCTION_CALL];
  forBlock['coup_random_int'] = (block) =>
    [`random_int(${Number(block.getFieldValue('A'))}, ${Number(block.getFieldValue('B'))})`, Order.FUNCTION_CALL];
  forBlock['coup_random_choice'] = (block, gen) =>
    [`choice(${gen.valueToCode(block, 'LIST', Order.NONE) || 'state.opponents'})`, Order.FUNCTION_CALL];
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
  const playerShadow = (field: string) => ({
    shadow: { type: 'coup_player_pick', fields: { FIELD: field } },
  });
  // a fresh power-order block with a sensible default ranking
  const powerOrder = () => ({
    block: { type: 'coup_power_order', fields: { R1: 'duke', R2: 'contessa', R3: 'captain', R4: 'assassin', R5: 'ambassador' } },
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
          { kind: 'block', type: 'coup_steal', inputs: { TARGET: playerShadow('richest_player') } },
          { kind: 'block', type: 'coup_coup', inputs: { TARGET: playerShadow('strongest_player') } },
          { kind: 'block', type: 'coup_assassinate', inputs: { TARGET: playerShadow('weakest_player') } },
        ],
      },
      {
        kind: 'category', name: 'Responses', categorystyle: 'responses_cat',
        contents: [
          { kind: 'block', type: 'coup_allow' },
          { kind: 'block', type: 'coup_challenge' },
          { kind: 'block', type: 'coup_block' },
          { kind: 'block', type: 'coup_block_contessa' },
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
          // exchange keeps are usually 2 cards — start the list at 2 sockets
          { kind: 'block', type: 'coup_keep', inputs: { LIST: { block: { type: 'lists_create_with', extraState: { itemCount: 2 } } } } },
          { kind: 'block', type: 'coup_keep_strongest', inputs: { ORDER: powerOrder() } },
          { kind: 'block', type: 'coup_power_order', fields: { R1: 'duke', R2: 'contessa', R3: 'captain', R4: 'assassin', R5: 'ambassador' } },
          // give up a card whose role I already claimed — keeps my hidden card hidden
          { kind: 'block', type: 'coup_reveal', inputs: { ROLE: { block: { type: 'coup_claimed_card' } } } },
          { kind: 'block', type: 'coup_claimed_card' },
          { kind: 'block', type: 'coup_unclaimed_card' },
          // exchange for cards nobody suspects: keep the strongest of the pool
          // cards not among my claims — always returns exactly my_num_cards
          { kind: 'block', type: 'coup_keep_strongest', inputs: { FROM: { block: { type: 'coup_cards_not_in', inputs: { A: { block: { type: 'coup_pool' } }, B: { block: { type: 'coup_my_claims' } } } } }, ORDER: powerOrder() } },
          { kind: 'block', type: 'coup_pool' },
          { kind: 'block', type: 'coup_cards_in', inputs: { A: { block: { type: 'coup_my_cards' } }, B: { block: { type: 'coup_my_claims' } } } },
          { kind: 'block', type: 'coup_cards_not_in', inputs: { A: { block: { type: 'coup_pool' } }, B: { block: { type: 'coup_my_claims' } } } },
        ],
      },
      {
        kind: 'category', name: 'This Move', categorystyle: 'move_cat',
        contents: [
          { kind: 'label', text: 'Use these inside "when I can react" / "when I am assassinated"' },
          { kind: 'block', type: 'coup_action_is' },
          { kind: 'block', type: 'coup_action_targets_me' },
          { kind: 'block', type: 'coup_action_actor' },
          { kind: 'block', type: 'coup_action_target' },
          { kind: 'block', type: 'coup_action_claimed_role' },
          { kind: 'block', type: 'coup_action_is_block' },
          { kind: 'block', type: 'coup_action_blocker' },
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
          // shows kids that "This Move" players chain into "[property] of [player]"
          { kind: 'block', type: 'coup_player_prop', fields: { PROP: 'scrim_bluff_rate' }, inputs: { PLAYER: { block: { type: 'coup_action_actor' } } } },
          { kind: 'block', type: 'coup_player_claimed', fields: { ROLE: 'contessa' }, inputs: { PLAYER: { block: { type: 'coup_action_actor' } } } },
        ],
      },
      {
        kind: 'category', name: 'Game Info', categorystyle: 'info_cat',
        contents: [
          { kind: 'block', type: 'coup_state_field' },
          { kind: 'block', type: 'coup_has_role' },
          { kind: 'block', type: 'coup_player_pick' },
          { kind: 'block', type: 'coup_opp_most' },
          { kind: 'block', type: 'coup_opp_least' },
          { kind: 'block', type: 'coup_random_opponent' },
          { kind: 'block', type: 'coup_revealed_count' },
          { kind: 'block', type: 'coup_role_impossible' },
          { kind: 'block', type: 'coup_opponents' },
          { kind: 'block', type: 'coup_my_cards' },
          { kind: 'block', type: 'coup_my_claims' },
          { kind: 'block', type: 'coup_sorted_strongest', inputs: { LIST: { block: { type: 'coup_my_cards' } }, ORDER: powerOrder() } },
          { kind: 'block', type: 'coup_strongest_n', inputs: { LIST: { block: { type: 'coup_my_cards' } }, ORDER: powerOrder() } },
          { kind: 'block', type: 'coup_power_order', fields: { R1: 'duke', R2: 'contessa', R3: 'captain', R4: 'assassin', R5: 'ambassador' } },
          { kind: 'block', type: 'coup_player_prop', inputs: { PLAYER: playerShadow('richest_player') } },
          { kind: 'block', type: 'coup_player_claimed', inputs: { PLAYER: playerShadow('richest_player') } },
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
          { kind: 'block', type: 'coup_chance' },
          { kind: 'block', type: 'coup_random' },
          { kind: 'block', type: 'coup_random_int' },
          { kind: 'block', type: 'coup_random_choice', inputs: { LIST: { block: { type: 'coup_opponents' } } } },
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

/** Generate bot-language Python for the whole workspace. */
export function generatePython(workspace: Blockly.Workspace): string {
  ensureBlocklySetup();
  const code = pythonGenerator.workspaceToCode(workspace);
  return code.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// ---------------------------------------------------------------- starter
export const STARTER_PYTHON = `def your_turn(state):
    if state.my_coins >= 7:
        return coup(state.strongest_player)
    if "duke" in state.my_cards:
        return tax()
    return income()

def respond(state, action):
    return allow()

def when_assassinated(state, action):
    return block_contessa()

def choose_card_to_lose(state):
    return reveal(state.my_cards[0])
`;

/**
 * The block layout every new/empty slot starts from — the same honest strategy
 * as STARTER_PYTHON, expressed as a Blockly serialization document.
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
                  DO0: {
                    block: {
                      type: 'coup_coup',
                      inputs: { TARGET: { block: { type: 'coup_player_pick', fields: { FIELD: 'strongest_player' } } } },
                    },
                  },
                },
                next: {
                  block: {
                    type: 'controls_if',
                    inputs: {
                      IF0: { block: { type: 'coup_has_role', fields: { ROLE: 'duke' } } },
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
          type: 'coup_when_respond', x: 420, y: 40,
          inputs: { DO: { block: { type: 'coup_allow' } } },
        },
        {
          type: 'coup_when_assassinated', x: 420, y: 200,
          inputs: { DO: { block: { type: 'coup_block_contessa' } } },
        },
        {
          type: 'coup_choose_lose', x: 420, y: 340,
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
