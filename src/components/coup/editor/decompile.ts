/**
 * botlang AST → Blockly workspace decompiler.
 *
 * The inverse of the generators in blocks.ts: given the AST the server's
 * /parse endpoint returns for a piece of hand-written botlang, build the
 * equivalent Blockly workspace so the Blocks view AGREES with the code.
 *
 * We construct blocks with the live Blockly API on a headless workspace and let
 * Blockly serialize them (handles variables, procedure params, if/elseif/else
 * mutations correctly), rather than hand-writing serialization JSON.
 *
 * Anything with no faithful block mapping throws DecompileError(line, reason);
 * the editor then falls back to the peek-stash flow.
 */
import * as Blockly from 'blockly/core';
import { ensureBlocklySetup } from './blocks';

export class DecompileError extends Error {
  line?: number;
  constructor(message: string, line?: number) {
    super(message);
    this.name = 'DecompileError';
    this.line = line;
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Node = any;
type WS = Blockly.Workspace;
interface Ctx { ws: WS; procs: Map<string, string[]>; }

const HATS: Record<string, string> = {
  your_turn: 'coup_when_turn',
  respond: 'coup_when_respond',
  when_assassinated: 'coup_when_assassinated',
  choose_card_to_lose: 'coup_choose_lose',
  choose_exchange: 'coup_choose_exchange',
};

// return <call> where the call is one of these maps to a dedicated action/response block
const NO_ARG: Record<string, string> = {
  income: 'coup_income', foreign_aid: 'coup_foreign_aid', tax: 'coup_tax',
  exchange: 'coup_exchange',
  allow: 'coup_allow', challenge: 'coup_challenge', block_contessa: 'coup_block_contessa',
};

// the dynaMIT rules use four roles — no Captain, so no steal action either
const ROLES = ['duke', 'assassin', 'ambassador', 'contessa'];
const NO_CAPTAIN = 'there is no Captain in the dynaMIT rules';
const ACTION_TYPES = new Set(['income', 'foreign_aid', 'tax', 'exchange', 'assassinate', 'coup']);

/** Check a role-name string literal, with a friendly error for the old Captain. */
function roleLiteral(v: string, where: string, line?: number): string {
  if (ROLES.includes(v)) return v;
  if (v === 'captain') throw new DecompileError(`${where} names the Captain — ${NO_CAPTAIN}`, line);
  throw new DecompileError(`"${v}" is not a character — ${where} needs duke, assassin, ambassador or contessa`, line);
}

const PLAYER_PROPS = new Set([
  'name', 'coins', 'lives', 'num_cards', 'graveyard', 'cards_lost', 'is_me', 'claims',
  'challenges_made', 'successful_challenges', 'times_caught_bluffing',
  'scrim_challenge_success', 'scrim_bluff_rate', 'scrim_win_rate',
]);

const STATE_FIELD = new Set(['my_coins', 'my_name', 'my_num_cards', 'deck_count', 'turn_number', 'my_lives']);

const CMP_OP: Record<string, string> = { '==': 'EQ', '!=': 'NEQ', '<': 'LT', '<=': 'LTE', '>': 'GT', '>=': 'GTE' };
const ARITH_OP: Record<string, string> = { '+': 'ADD', '-': 'MINUS', '*': 'MULTIPLY', '/': 'DIVIDE', '**': 'POWER' };

// -------------------------------------------------- small AST predicates
const isName = (e: Node, v: string) => e && e.k === 'name' && e.v === v;
const isAttrOf = (e: Node, objName: string, attr: string) =>
  e && e.k === 'attr' && e.name === attr && isName(e.obj, objName);
const isNone = (e: Node) => e && e.k === 'num' && e.v === null;

// -------------------------------------------------- entry point
export function astToWorkspaceJson(ast: { fns: Record<string, Node> }): object {
  ensureBlocklySetup();
  const ws = new Blockly.Workspace();
  try {
    const procs = new Map<string, string[]>();
    for (const name of Object.keys(ast.fns)) {
      if (!HATS[name]) procs.set(name, ast.fns[name].params || []);
    }
    const ctx: Ctx = { ws, procs };
    let y = 20;
    for (const name of Object.keys(ast.fns)) {
      const def = ast.fns[name];
      const top = HATS[name] ? buildHat(ctx, name, def) : buildProc(ctx, def);
      top.moveBy(20, y);
      y += 40 * (countStmts(def.body) + 3);
    }
    return Blockly.serialization.workspaces.save(ws);
  } finally {
    ws.dispose();
  }
}

function countStmts(stmts: Node[]): number {
  let n = 0;
  for (const s of stmts) { n += 1; if (s.body) n += countStmts(s.body); if (Array.isArray(s.alt)) n += countStmts(s.alt); }
  return n;
}

// -------------------------------------------------- helpers to build blocks
function nb(ctx: Ctx, type: string): Blockly.Block {
  const b = ctx.ws.newBlock(type);
  return b;
}
function connectValue(parent: Blockly.Block, input: string, child: Blockly.Block, line?: number) {
  const conn = parent.getInput(input)?.connection;
  if (!conn || !child.outputConnection) throw new DecompileError(`internal: cannot wire ${input}`, line);
  conn.connect(child.outputConnection);
}
function variable(ctx: Ctx, name: string): Blockly.IVariableModel<Blockly.IVariableState> {
  const map = ctx.ws.getVariableMap();
  return map.getVariable(name) || map.createVariable(name);
}
function varGet(ctx: Ctx, name: string): Blockly.Block {
  const b = nb(ctx, 'variables_get');
  b.setFieldValue(variable(ctx, name).getId(), 'VAR');
  return b;
}

/** Connect a list of statements onto a statement input's connection. */
function attachBody(ctx: Ctx, conn: Blockly.Connection | null, stmts: Node[]) {
  let cur = conn;
  for (const st of stmts) {
    const b = buildStmt(ctx, st);
    if (!cur) throw new DecompileError('code after a return is not supported in blocks', st.line);
    if (!b.previousConnection) throw new DecompileError('internal: statement block has no previous connection', st.line);
    cur.connect(b.previousConnection);
    cur = b.nextConnection;
  }
}

// -------------------------------------------------- top-level
function buildHat(ctx: Ctx, name: string, def: Node): Blockly.Block {
  const b = nb(ctx, HATS[name]);
  attachBody(ctx, b.getInput('DO')!.connection, def.body);
  return b;
}
function buildProc(ctx: Ctx, def: Node): Blockly.Block {
  const b = nb(ctx, 'procedures_defreturn') as Blockly.Block & { loadExtraState?: (s: unknown) => void };
  b.setFieldValue(def.name, 'NAME');
  const params = (def.params || []).map((p: string) => ({ name: p, id: variable(ctx, p).getId() }));
  b.loadExtraState?.({ params, hasStatements: true });
  attachBody(ctx, b.getInput('STACK')!.connection, def.body);
  return b;
}

// -------------------------------------------------- statements
function buildStmt(ctx: Ctx, st: Node): Blockly.Block {
  switch (st.k) {
    case 'return': return buildReturn(ctx, st);
    case 'if': return buildIf(ctx, st);
    case 'assign': return buildAssign(ctx, st);
    case 'while': {
      const b = nb(ctx, 'controls_whileUntil');
      b.setFieldValue('WHILE', 'MODE');
      connectValue(b, 'BOOL', buildExpr(ctx, st.cond), st.line);
      attachBody(ctx, b.getInput('DO')!.connection, st.body);
      return b;
    }
    case 'for': {
      const b = nb(ctx, 'controls_forEach');
      b.setFieldValue(variable(ctx, st.v).getId(), 'VAR');
      connectValue(b, 'LIST', buildExpr(ctx, st.iter), st.line);
      attachBody(ctx, b.getInput('DO')!.connection, st.body);
      return b;
    }
    case 'break': { const b = nb(ctx, 'controls_flow_statements'); b.setFieldValue('BREAK', 'FLOW'); return b; }
    case 'continue': { const b = nb(ctx, 'controls_flow_statements'); b.setFieldValue('CONTINUE', 'FLOW'); return b; }
    case 'pass': throw new DecompileError('a bare "pass" has no block', st.line);
    case 'expr': throw new DecompileError('a bare expression statement has no block — only returns, assignments, and control flow map to blocks', st.line);
    case 'def': throw new DecompileError('functions defined inside functions are not supported in blocks', st.line);
    default: throw new DecompileError(`can't turn "${st.k}" into a block`, st.line);
  }
}

function buildReturn(ctx: Ctx, st: Node): Blockly.Block {
  const val = st.val;
  if (val && val.k === 'call' && val.fn.k === 'name') {
    const fn = val.fn.v as string;
    if (NO_ARG[fn] || fn === 'coup' || fn === 'assassinate' || fn === 'block' || fn === 'reveal') {
      return buildActionResponse(ctx, val);
    }
    // return strongest_cards(from, order, state.my_num_cards) is the exchange
    // "keep the strongest cards" block, not a plain value return
    if (fn === 'strongest_cards' && val.args.length === 3 && isAttrOf(val.args[2], 'state', 'my_num_cards')) {
      const b = nb(ctx, 'coup_keep_strongest');
      connectValue(b, 'FROM', buildExpr(ctx, val.args[0]), val.line);
      connectValue(b, 'ORDER', buildExpr(ctx, val.args[1]), val.line);
      return b;
    }
  }
  const b = nb(ctx, 'coup_return');
  if (val) connectValue(b, 'VALUE', buildExpr(ctx, val), st.line);
  return b;
}

function buildActionResponse(ctx: Ctx, call: Node): Blockly.Block {
  const fn = call.fn.v as string;
  const args = call.args as Node[];
  if (NO_ARG[fn]) {
    if (args.length) throw new DecompileError(`${fn}() takes no arguments here`, call.line);
    return nb(ctx, NO_ARG[fn]);
  }
  if (fn === 'coup') {
    const b = nb(ctx, 'coup_coup');
    connectValue(b, 'ROLE', buildCallArg(ctx, args[0], 'the coup call', call.line), call.line);
    return b;
  }
  if (fn === 'assassinate') {
    const b = nb(ctx, 'coup_assassinate');
    connectValue(b, 'ROLE', buildCallArg(ctx, args[0], 'the assassinate call', call.line), call.line);
    const p = args[1];
    if (!p || p.k !== 'num' || typeof p.v !== 'number') throw new DecompileError('assassinate needs a number for the challenge chance', call.line);
    b.setFieldValue(p.v, 'P');
    return b;
  }
  if (fn === 'block') {
    const r = args[0];
    if (!r || r.k !== 'str') throw new DecompileError('block() needs a role name', call.line);
    const b = nb(ctx, 'coup_block');
    b.setFieldValue(roleLiteral(r.v, 'block()', call.line), 'ROLE');
    return b;
  }
  // reveal
  const b = nb(ctx, 'coup_reveal');
  connectValue(b, 'ROLE', buildCallArg(ctx, args[0], 'reveal()', call.line), call.line);
  return b;
}

/** A role argument: any expression, but a string literal must name a real role. */
function buildCallArg(ctx: Ctx, arg: Node, where: string, line?: number): Blockly.Block {
  if (!arg) throw new DecompileError(`${where} needs a character to name`, line);
  if (arg.k === 'str') roleLiteral(arg.v, where, arg.line ?? line);
  return buildExpr(ctx, arg);
}

function buildIf(ctx: Ctx, node: Node): Blockly.Block {
  const clauses: { cond: Node; body: Node[] }[] = [{ cond: node.cond, body: node.body }];
  let cur = node;
  let elseBody: Node[] | null = null;
  // elif chains parse as alt:[ifNode]; a plain else is alt: Stmt[]
  for (;;) {
    if (Array.isArray(cur.alt) && cur.alt.length === 1 && cur.alt[0].k === 'if') {
      cur = cur.alt[0];
      clauses.push({ cond: cur.cond, body: cur.body });
    } else if (Array.isArray(cur.alt)) {
      elseBody = cur.alt;
      break;
    } else {
      break;
    }
  }
  const b = nb(ctx, 'controls_if') as Blockly.Block & { loadExtraState?: (s: unknown) => void };
  const elseIfCount = clauses.length - 1;
  if (elseIfCount > 0 || elseBody) b.loadExtraState?.({ elseIfCount, hasElse: !!elseBody });
  clauses.forEach((c, i) => {
    connectValue(b, `IF${i}`, buildExpr(ctx, c.cond), node.line);
    attachBody(ctx, b.getInput(`DO${i}`)!.connection, c.body);
  });
  if (elseBody) attachBody(ctx, b.getInput('ELSE')!.connection, elseBody);
  return b;
}

function buildAssign(ctx: Ctx, st: Node): Blockly.Block {
  if (st.target.k !== 'name') throw new DecompileError('only assigning to a simple variable maps to a block', st.line);
  const b = nb(ctx, 'variables_set');
  b.setFieldValue(variable(ctx, st.target.v).getId(), 'VAR');
  let valExpr = st.val;
  if (st.op !== '=') {
    const op = st.op[0]; // += -> +
    valExpr = { k: 'bin', op, l: { k: 'name', v: st.target.v }, r: st.val, line: st.line };
  }
  connectValue(b, 'VALUE', buildExpr(ctx, valExpr), st.line);
  return b;
}

// -------------------------------------------------- expressions
function buildExpr(ctx: Ctx, e: Node): Blockly.Block {
  switch (e.k) {
    case 'num': return buildNum(ctx, e);
    case 'str': { const b = nb(ctx, 'text'); b.setFieldValue(e.v, 'TEXT'); return b; }
    case 'name': return buildNameExpr(ctx, e);
    case 'list': {
      const b = nb(ctx, 'lists_create_with') as Blockly.Block & { loadExtraState?: (s: unknown) => void };
      b.loadExtraState?.({ itemCount: e.items.length });
      e.items.forEach((it: Node, i: number) => connectValue(b, `ADD${i}`, buildExpr(ctx, it), e.line));
      return b;
    }
    case 'attr': return buildAttr(ctx, e);
    case 'index': return buildIndex(ctx, e);
    case 'call': return buildCall(ctx, e);
    case 'cmp': return buildCmp(ctx, e);
    case 'in': return buildIn(ctx, e);
    case 'and': return buildAnd(ctx, e);
    case 'or': return binBool(ctx, 'OR', e.l, e.r, e.line);
    case 'not': { const b = nb(ctx, 'logic_negate'); connectValue(b, 'BOOL', buildExpr(ctx, e.v), e.line); return b; }
    case 'neg': throw new DecompileError('a negative value here has no block (only [-1] indexing is supported)', e.line);
    case 'ternary': {
      const b = nb(ctx, 'logic_ternary');
      connectValue(b, 'IF', buildExpr(ctx, e.cond), e.line);
      connectValue(b, 'THEN', buildExpr(ctx, e.a), e.line);
      connectValue(b, 'ELSE', buildExpr(ctx, e.b), e.line);
      return b;
    }
    case 'bin': return buildBin(ctx, e);
    case 'dict': throw new DecompileError('dictionaries { } are not supported in blocks', e.line);
    default: throw new DecompileError(`can't turn a "${e.k}" expression into a block`, e.line);
  }
}

function buildNum(ctx: Ctx, e: Node): Blockly.Block {
  if (e.v === true || e.v === false) { const b = nb(ctx, 'logic_boolean'); b.setFieldValue(e.v ? 'TRUE' : 'FALSE', 'BOOL'); return b; }
  if (e.v === null) return nb(ctx, 'logic_null');
  const b = nb(ctx, 'math_number');
  b.setFieldValue(String(e.v), 'NUM');
  return b;
}

function buildNameExpr(ctx: Ctx, e: Node): Blockly.Block {
  if (e.v === 'pool') return nb(ctx, 'coup_pool');
  return varGet(ctx, e.v);
}

function field(ctx: Ctx, type: string, fields: Record<string, string>): Blockly.Block {
  const b = nb(ctx, type);
  for (const [k, v] of Object.entries(fields)) b.setFieldValue(v, k);
  return b;
}

function playerProp(ctx: Ctx, prop: string, player: Blockly.Block): Blockly.Block {
  const b = nb(ctx, 'coup_player_prop');
  b.setFieldValue(prop, 'PROP');
  connectValue(b, 'PLAYER', player);
  return b;
}

function buildAttr(ctx: Ctx, e: Node): Blockly.Block {
  const { obj, name } = e;
  if (isName(obj, 'state')) {
    if (STATE_FIELD.has(name)) return field(ctx, 'coup_state_field', { FIELD: name });
    if (name === 'my_cards') return nb(ctx, 'coup_my_cards');
    if (name === 'my_claims') return nb(ctx, 'coup_my_claims');
    if (name === 'my_graveyard') return nb(ctx, 'coup_my_graveyard');
    if (name === 'opponent') return nb(ctx, 'coup_opponent');
    if (name === 'history') return nb(ctx, 'coup_history');
    return attrFallback(ctx, e);
  }
  if (isName(obj, 'action')) {
    if (name === 'actor' || name === 'target' || name === 'blocker') {
      throw new DecompileError(`in heads-up there is no action.${name} — use the "my opponent" block instead`, e.line);
    }
    const map: Record<string, string> = {
      call: 'coup_action_call', claimed_role: 'coup_action_claimed_role', is_block: 'coup_action_is_block',
      already_claimed: 'coup_action_already_claimed',
    };
    if (map[name]) return nb(ctx, map[name]);
    return attrFallback(ctx, e);
  }
  if (isAttrOf(obj, 'state', 'opponent')) {
    if (name === 'graveyard') return nb(ctx, 'coup_opp_graveyard');
    return playerProp(ctx, name, nb(ctx, 'coup_opponent'));
  }
  if (PLAYER_PROPS.has(name)) return playerProp(ctx, name, buildExpr(ctx, obj));
  return attrFallback(ctx, e);
}

function attrFallback(ctx: Ctx, e: Node): Blockly.Block {
  const b = nb(ctx, 'coup_attr');
  b.setFieldValue(e.name, 'NAME');
  // state.<x> where state has no bare block → treat state as a plain variable read
  const objBlock = isName(e.obj, 'state') ? varGet(ctx, 'state') : buildExpr(ctx, e.obj);
  connectValue(b, 'OBJ', objBlock, e.line);
  return b;
}

function buildIndex(ctx: Ctx, e: Node): Blockly.Block {
  const idx = e.idx;
  if (idx.k === 'num' && idx.v === 0) { const b = nb(ctx, 'coup_first_of'); connectValue(b, 'LIST', buildExpr(ctx, e.obj), e.line); return b; }
  if (idx.k === 'neg' && idx.v && idx.v.k === 'num' && idx.v.v === 1) { const b = nb(ctx, 'coup_last_of'); connectValue(b, 'LIST', buildExpr(ctx, e.obj), e.line); return b; }
  if (idx.k === 'num' && Number.isInteger(idx.v) && idx.v > 0 && isAttrOf(e.obj, 'state', 'my_cards')) {
    return field(ctx, 'coup_my_card', { IDX: String(idx.v) });
  }
  throw new DecompileError('only [0], [-1], and "first/last item of" indexing map to blocks', e.line);
}

function buildCall(ctx: Ctx, e: Node): Blockly.Block {
  if (e.fn.k !== 'name') throw new DecompileError('only calls to named functions are supported', e.line);
  const fn = e.fn.v as string;
  const a = e.args as Node[];
  switch (fn) {
    case 'best_coup_call': return nb(ctx, 'coup_best_guess');
    case 'claimed_card': return nb(ctx, 'coup_claimed_card');
    case 'unclaimed_card': return nb(ctx, 'coup_unclaimed_card');
    case 'random': return nb(ctx, 'coup_random');
    case 'prob_opponent_has': { const b = nb(ctx, 'coup_prob_opp_has'); connectValue(b, 'ROLE', buildExpr(ctx, a[1]), e.line); return b; }
    case 'unseen_copies': { const b = nb(ctx, 'coup_unseen'); connectValue(b, 'ROLE', buildExpr(ctx, a[1]), e.line); return b; }
    case 'chance': { const b = nb(ctx, 'coup_chance'); connectValue(b, 'P', buildExpr(ctx, a[0]), e.line); return b; }
    case 'choice': { const b = nb(ctx, 'coup_random_choice'); connectValue(b, 'LIST', buildExpr(ctx, a[0]), e.line); return b; }
    case 'len': { const b = nb(ctx, 'lists_length'); connectValue(b, 'VALUE', buildExpr(ctx, a[0]), e.line); return b; }
    case 'cards_in': { const b = nb(ctx, 'coup_cards_in'); connectValue(b, 'A', buildExpr(ctx, a[0]), e.line); connectValue(b, 'B', buildExpr(ctx, a[1]), e.line); return b; }
    case 'cards_not_in': { const b = nb(ctx, 'coup_cards_not_in'); connectValue(b, 'A', buildExpr(ctx, a[0]), e.line); connectValue(b, 'B', buildExpr(ctx, a[1]), e.line); return b; }
    case 'random_int': {
      if (a[0]?.k !== 'num' || a[1]?.k !== 'num') throw new DecompileError('random_int needs two number literals to map to a block', e.line);
      return field(ctx, 'coup_random_int', { A: String(a[0].v), B: String(a[1].v) });
    }
    case 'steal':
      throw new DecompileError(`steal() is not a move — ${NO_CAPTAIN}`, e.line);
    case 'strongest_cards': {
      if (a.length === 2) {
        const b = nb(ctx, 'coup_sorted_strongest');
        connectValue(b, 'LIST', buildExpr(ctx, a[0]), e.line);
        connectValue(b, 'ORDER', buildExpr(ctx, a[1]), e.line);
        return b;
      }
      if (a.length === 3 && a[2].k === 'num' && Number.isInteger(a[2].v)) {
        const b = nb(ctx, 'coup_strongest_n');
        b.setFieldValue(String(a[2].v), 'N');
        connectValue(b, 'LIST', buildExpr(ctx, a[0]), e.line);
        connectValue(b, 'ORDER', buildExpr(ctx, a[1]), e.line);
        return b;
      }
      throw new DecompileError('strongest_cards needs a list and a power order, plus how many cards to keep', e.line);
    }
    default:
      if (ctx.procs.has(fn)) return buildProcCall(ctx, fn, a, e.line);
      throw new DecompileError(`no block for the function "${fn}()"`, e.line);
  }
}

function buildProcCall(ctx: Ctx, fn: string, args: Node[], line?: number): Blockly.Block {
  const b = nb(ctx, 'procedures_callreturn') as Blockly.Block & { loadExtraState?: (s: unknown) => void };
  b.loadExtraState?.({ name: fn, params: ctx.procs.get(fn) });
  args.forEach((arg, i) => connectValue(b, `ARG${i}`, buildExpr(ctx, arg), line));
  return b;
}

function buildCmp(ctx: Ctx, e: Node): Blockly.Block {
  // action.type == "tax"  →  semantic "this move is X"
  if (e.op === '==' && isAttrOf(e.l, 'action', 'type') && e.r.k === 'str') {
    if (e.r.v === 'steal') throw new DecompileError(`there is no steal move — ${NO_CAPTAIN}`, e.line);
    if (!ACTION_TYPES.has(e.r.v)) throw new DecompileError(`"${e.r.v}" is not one of the moves`, e.line);
    return field(ctx, 'coup_action_is', { TYPE: e.r.v });
  }
  const b = nb(ctx, 'logic_compare');
  b.setFieldValue(CMP_OP[e.op], 'OP');
  connectValue(b, 'A', buildExpr(ctx, e.l), e.line);
  connectValue(b, 'B', buildExpr(ctx, e.r), e.line);
  return b;
}

function buildIn(ctx: Ctx, e: Node): Blockly.Block {
  const { l, r } = e;
  if (isAttrOf(r, 'state', 'my_cards')) {
    if (l.k === 'str') return field(ctx, 'coup_has_role', { ROLE: roleLiteral(l.v, 'this card test', e.line) });
    const b = nb(ctx, 'coup_i_have');
    connectValue(b, 'ROLE', buildExpr(ctx, l), e.line);
    return b;
  }
  if (r.k === 'attr' && r.name === 'claims' && l.k === 'str') {
    const b = nb(ctx, 'coup_player_claimed');
    b.setFieldValue(roleLiteral(l.v, 'this claim test', e.line), 'ROLE');
    connectValue(b, 'PLAYER', buildExpr(ctx, r.obj), e.line);
    return b;
  }
  throw new DecompileError('this "in" test has no block yet', e.line);
}

// action.claimed_role != None and state.revealed_roles[action.claimed_role] >= 3
function matchesImpossible(e: Node): boolean {
  if (e.k !== 'and') return false;
  const l = e.l, r = e.r;
  const leftOk = l && l.k === 'cmp' && l.op === '!=' && isAttrOf(l.l, 'action', 'claimed_role') && isNone(l.r);
  if (!leftOk) return false;
  if (!(r && r.k === 'cmp' && r.op === '>=' && r.r && r.r.k === 'num' && r.r.v === 3)) return false;
  const idx = r.l;
  return idx && idx.k === 'index' && isAttrOf(idx.obj, 'state', 'revealed_roles') && isAttrOf(idx.idx, 'action', 'claimed_role');
}

function buildAnd(ctx: Ctx, e: Node): Blockly.Block {
  if (matchesImpossible(e)) return nb(ctx, 'coup_claimed_role_impossible');
  return binBool(ctx, 'AND', e.l, e.r, e.line);
}

function binBool(ctx: Ctx, op: string, l: Node, r: Node, line?: number): Blockly.Block {
  const b = nb(ctx, 'logic_operation');
  b.setFieldValue(op, 'OP');
  connectValue(b, 'A', buildExpr(ctx, l), line);
  connectValue(b, 'B', buildExpr(ctx, r), line);
  return b;
}

function buildBin(ctx: Ctx, e: Node): Blockly.Block {
  if (e.op === '%') {
    const b = nb(ctx, 'math_modulo');
    connectValue(b, 'DIVIDEND', buildExpr(ctx, e.l), e.line);
    connectValue(b, 'DIVISOR', buildExpr(ctx, e.r), e.line);
    return b;
  }
  const opName = ARITH_OP[e.op];
  if (!opName) throw new DecompileError(`the "${e.op}" operator has no block`, e.line);
  const b = nb(ctx, 'math_arithmetic');
  b.setFieldValue(opName, 'OP');
  connectValue(b, 'A', buildExpr(ctx, e.l), e.line);
  connectValue(b, 'B', buildExpr(ctx, e.r), e.line);
  return b;
}
