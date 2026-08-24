/**
 * botlang — a sandboxed Python-subset interpreter for student Coup bots.
 *
 * Both editor modes produce this language: the block editor generates it,
 * advanced students type it directly. It is deliberately small:
 *
 *   def / return / if / elif / else / while / for-in / pass / break / continue
 *   numbers, strings, booleans, None, lists, dicts
 *   and / or / not / in / not in / comparisons / + - * / // % **
 *   attribute access (state.my_coins), indexing (xs[0], xs[-1]), ternary
 *   a small set of list/string methods (append, pop, count, lower, ...)
 *
 * Safety: no host access at all — the only names a program can reach are the
 * builtins the runtime injects. Every statement/expression tick counts against
 * a step budget so `while True:` can't hang the scrim server. Randomness comes
 * from an injected rng so replays are bit-for-bit reproducible.
 */
'use strict';

class CompileError extends Error {
  constructor(message, line) { super(message); this.line = line; this.isCompile = true; }
}
class BotRuntimeError extends Error {
  constructor(message, line) { super(message); this.line = line; this.isRuntime = true; }
}

const KEYWORDS = new Set(['def', 'return', 'if', 'elif', 'else', 'while', 'for', 'in',
  'not', 'and', 'or', 'True', 'False', 'None', 'pass', 'break', 'continue']);
const TWO_CHAR = ['**', '//', '<=', '>=', '==', '!=', '+=', '-=', '*=', '/='];
const ONE_CHAR = '+-*/%()[]{}:,.<>=';

// ------------------------------------------------------------------ tokenizer
function tokenize(src) {
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  const toks = [];
  const indents = [0];
  for (let ln = 0; ln < lines.length; ln++) {
    const raw = lines[ln];
    let i = 0;
    while (i < raw.length && (raw[i] === ' ' || raw[i] === '\t')) i++;
    if (i >= raw.length || raw[i] === '#') continue; // blank or comment-only
    const indent = raw.slice(0, i).replace(/\t/g, '    ').length;
    const line = ln + 1;
    if (indent > indents[indents.length - 1]) { indents.push(indent); toks.push({ t: 'INDENT', line }); }
    else {
      while (indent < indents[indents.length - 1]) { indents.pop(); toks.push({ t: 'DEDENT', line }); }
      if (indent !== indents[indents.length - 1]) throw new CompileError('indentation does not match any outer level', line);
    }
    while (i < raw.length) {
      const c = raw[i];
      if (c === ' ' || c === '\t') { i++; continue; }
      if (c === '#') break;
      if (c === '"' || c === "'") {
        let j = i + 1, s = '';
        while (j < raw.length && raw[j] !== c) {
          if (raw[j] === '\\' && j + 1 < raw.length) {
            const e = raw[j + 1];
            s += e === 'n' ? '\n' : e === 't' ? '\t' : e; j += 2;
          } else { s += raw[j]; j++; }
        }
        if (j >= raw.length) throw new CompileError('unterminated string', line);
        toks.push({ t: 'STR', v: s, line }); i = j + 1; continue;
      }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(raw[i + 1] || ''))) {
        let j = i; while (j < raw.length && /[0-9.]/.test(raw[j])) j++;
        const num = Number(raw.slice(i, j));
        if (!Number.isFinite(num)) throw new CompileError(`bad number "${raw.slice(i, j)}"`, line);
        toks.push({ t: 'NUM', v: num, line }); i = j; continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        let j = i; while (j < raw.length && /[A-Za-z0-9_]/.test(raw[j])) j++;
        const w = raw.slice(i, j);
        toks.push(KEYWORDS.has(w) ? { t: w, line } : { t: 'NAME', v: w, line });
        i = j; continue;
      }
      const two = raw.slice(i, i + 2);
      if (TWO_CHAR.includes(two)) { toks.push({ t: two, line }); i += 2; continue; }
      if (ONE_CHAR.includes(c)) { toks.push({ t: c, line }); i++; continue; }
      throw new CompileError(`unexpected character "${c}"`, line);
    }
    toks.push({ t: 'NEWLINE', line });
  }
  const last = lines.length;
  while (indents.length > 1) { indents.pop(); toks.push({ t: 'DEDENT', line: last }); }
  toks.push({ t: 'EOF', line: last });
  return toks;
}

// ------------------------------------------------------------------ parser
function parse(src) {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const at = (t) => toks[p].t === t;
  const eat = (t, what) => {
    if (!at(t)) throw new CompileError(`expected ${what || t} but found "${toks[p].v ?? toks[p].t}"`, toks[p].line);
    return next();
  };

  function parseProgram() {
    const fns = {};
    while (!at('EOF')) {
      if (at('NEWLINE')) { next(); continue; }
      if (at('def')) {
        const f = parseDef();
        if (fns[f.name]) {
          throw new CompileError(
            `you have TWO functions named "${f.name}" — the second would silently replace the first. `
            + `Delete one of them (in blocks: look for two of the same hat block).`, f.line);
        }
        fns[f.name] = f;
        continue;
      }
      throw new CompileError('only "def" function definitions are allowed at the top level', peek().line);
    }
    return { fns };
  }

  function parseDef() {
    const line = eat('def').line;
    const name = eat('NAME', 'function name').v;
    eat('(');
    const params = [];
    while (!at(')')) {
      params.push(eat('NAME', 'parameter name').v);
      if (at(',')) next();
    }
    eat(')'); eat(':', '":"');
    const body = parseBlock();
    return { k: 'def', name, params, body, line };
  }

  function parseBlock() {
    eat('NEWLINE', 'a new line'); eat('INDENT', 'an indented block');
    const stmts = [];
    while (!at('DEDENT')) {
      if (at('NEWLINE')) { next(); continue; }
      stmts.push(parseStmt());
    }
    next(); // DEDENT
    return stmts;
  }

  function parseStmt() {
    const tk = peek();
    switch (tk.t) {
      case 'if': return parseIf();
      case 'while': { next(); const cond = parseExpr(); eat(':'); return { k: 'while', cond, body: parseBlock(), line: tk.line }; }
      case 'for': {
        next(); const v = eat('NAME', 'loop variable').v; eat('in'); const iter = parseExpr(); eat(':');
        return { k: 'for', v, iter, body: parseBlock(), line: tk.line };
      }
      case 'def': return parseDef();
      case 'return': {
        next();
        const val = at('NEWLINE') ? null : parseExpr();
        eat('NEWLINE'); return { k: 'return', val, line: tk.line };
      }
      case 'pass': next(); eat('NEWLINE'); return { k: 'pass', line: tk.line };
      case 'break': next(); eat('NEWLINE'); return { k: 'break', line: tk.line };
      case 'continue': next(); eat('NEWLINE'); return { k: 'continue', line: tk.line };
      default: {
        const expr = parseExpr();
        if (at('=') || at('+=') || at('-=') || at('*=') || at('/=')) {
          const op = next().t;
          if (expr.k !== 'name' && expr.k !== 'index') {
            throw new CompileError('you can only assign to a variable or list[index]', tk.line);
          }
          const val = parseExpr(); eat('NEWLINE');
          return { k: 'assign', target: expr, op, val, line: tk.line };
        }
        eat('NEWLINE');
        return { k: 'expr', expr, line: tk.line };
      }
    }
  }

  function parseIf(asElif) {
    // an elif clause re-enters here with 'elif' as the head token
    const line = (asElif ? eat('elif') : eat('if')).line;
    const cond = parseExpr(); eat(':');
    const body = parseBlock();
    let alt = null;
    if (at('elif')) alt = [parseIf(true)];
    else if (at('else')) { next(); eat(':'); alt = parseBlock(); }
    return { k: 'if', cond, body, alt, line };
  }

  // expr := or_expr ['if' or_expr 'else' expr]
  function parseExpr() {
    const val = parseOr();
    if (at('if')) {
      const line = next().line;
      const cond = parseOr(); eat('else');
      return { k: 'ternary', cond, a: val, b: parseExpr(), line };
    }
    return val;
  }
  function parseOr() {
    let l = parseAnd();
    while (at('or')) { const line = next().line; l = { k: 'or', l, r: parseAnd(), line }; }
    return l;
  }
  function parseAnd() {
    let l = parseNot();
    while (at('and')) { const line = next().line; l = { k: 'and', l, r: parseNot(), line }; }
    return l;
  }
  function parseNot() {
    if (at('not')) { const line = next().line; return { k: 'not', v: parseNot(), line }; }
    return parseCmp();
  }
  function parseCmp() {
    let l = parseAdd();
    for (;;) {
      const t = peek().t;
      if (['<', '>', '<=', '>=', '==', '!='].includes(t)) {
        const line = next().line; l = { k: 'cmp', op: t, l, r: parseAdd(), line };
      } else if (t === 'in') {
        const line = next().line; l = { k: 'in', l, r: parseAdd(), line };
      } else if (t === 'not' && toks[p + 1] && toks[p + 1].t === 'in') {
        const line = next().line; next(); l = { k: 'not', v: { k: 'in', l, r: parseAdd(), line }, line };
      } else break;
    }
    return l;
  }
  function parseAdd() {
    let l = parseMul();
    while (at('+') || at('-')) { const op = next(); l = { k: 'bin', op: op.t, l, r: parseMul(), line: op.line }; }
    return l;
  }
  function parseMul() {
    let l = parseUnary();
    while (at('*') || at('/') || at('//') || at('%')) { const op = next(); l = { k: 'bin', op: op.t, l, r: parseUnary(), line: op.line }; }
    return l;
  }
  function parseUnary() {
    if (at('-')) { const line = next().line; return { k: 'neg', v: parseUnary(), line }; }
    return parsePow();
  }
  function parsePow() {
    const base = parsePostfix();
    if (at('**')) { const line = next().line; return { k: 'bin', op: '**', l: base, r: parseUnary(), line }; }
    return base;
  }
  function parsePostfix() {
    let e = parseAtom();
    for (;;) {
      if (at('(')) {
        const line = next().line;
        const args = [];
        while (!at(')')) {
          if (at('NAME') && toks[p + 1] && toks[p + 1].t === '=') {
            throw new CompileError('keyword arguments are not supported — pass values in order, e.g. assassinate(target, 0.5)', peek().line);
          }
          args.push(parseExpr());
          if (at(',')) next();
        }
        eat(')');
        e = { k: 'call', fn: e, args, line };
      } else if (at('[')) {
        const line = next().line;
        const idx = parseExpr(); eat(']');
        e = { k: 'index', obj: e, idx, line };
      } else if (at('.')) {
        const line = next().line;
        e = { k: 'attr', obj: e, name: eat('NAME', 'a name after "."').v, line };
      } else break;
    }
    return e;
  }
  function parseAtom() {
    const tk = peek();
    switch (tk.t) {
      case 'NUM': next(); return { k: 'num', v: tk.v, line: tk.line };
      case 'STR': next(); return { k: 'str', v: tk.v, line: tk.line };
      case 'NAME': next(); return { k: 'name', v: tk.v, line: tk.line };
      case 'True': next(); return { k: 'num', v: true, line: tk.line };
      case 'False': next(); return { k: 'num', v: false, line: tk.line };
      case 'None': next(); return { k: 'num', v: null, line: tk.line };
      case '(': { next(); const e = parseExpr(); eat(')'); return e; }
      case '[': {
        next(); const items = [];
        while (!at(']')) { items.push(parseExpr()); if (at(',')) next(); }
        eat(']'); return { k: 'list', items, line: tk.line };
      }
      case '{': {
        next(); const pairs = [];
        while (!at('}')) {
          const key = parseExpr(); eat(':'); pairs.push([key, parseExpr()]);
          if (at(',')) next();
        }
        eat('}'); return { k: 'dict', pairs, line: tk.line };
      }
      default:
        throw new CompileError(`unexpected "${tk.v ?? tk.t}"`, tk.line);
    }
  }

  return parseProgram();
}

// ------------------------------------------------------------------ runtime
const LIST_METHODS = {
  append: (a, x) => { a.push(x); return null; },
  pop: (a, i) => (i === undefined ? a.pop() : a.splice(pyIdx(a, i), 1)[0]),
  remove: (a, x) => { const i = a.findIndex((y) => eq(y, x)); if (i >= 0) a.splice(i, 1); return null; },
  count: (a, x) => a.filter((y) => eq(y, x)).length,
  index: (a, x) => a.findIndex((y) => eq(y, x)),
  reverse: (a) => { a.reverse(); return null; },
  sort: (a) => { a.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)); return null; },
};
const STR_METHODS = {
  lower: (s) => s.toLowerCase(),
  upper: (s) => s.toUpperCase(),
  startswith: (s, x) => s.startsWith(x),
  endswith: (s, x) => s.endsWith(x),
  split: (s, sep) => s.split(sep === undefined ? /\s+/ : sep),
  strip: (s) => s.trim(),
  replace: (s, a, b) => s.split(a).join(b),
};

function pyIdx(arr, i) { return i < 0 ? arr.length + i : i; }
function eq(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => eq(x, b[i]));
  return a === b;
}
function truthy(v) {
  if (v === null || v === undefined || v === false) return false;
  if (v === true) return true;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}
function repr(v) {
  if (v === null || v === undefined) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return '[' + v.map(repr).join(', ') + ']';
  if (typeof v === 'object') {
    if (v.__native || v.__fn) return '<function>';
    if (typeof v.name === 'string') return v.name; // player objects print as their name
    return '{' + Object.entries(v).filter(([k]) => !k.startsWith('__')).map(([k, x]) => k + ': ' + repr(x)).join(', ') + '}';
  }
  return String(v);
}

function stdBuiltins(rng, printOut) {
  const nat = (name, fn) => [name, { __native: fn, name }];
  return Object.fromEntries([
    nat('len', (x) => (Array.isArray(x) || typeof x === 'string') ? x.length : Object.keys(x || {}).length),
    nat('abs', Math.abs),
    nat('min', (...xs) => Math.min(...(xs.length === 1 && Array.isArray(xs[0]) ? xs[0] : xs))),
    nat('max', (...xs) => Math.max(...(xs.length === 1 && Array.isArray(xs[0]) ? xs[0] : xs))),
    nat('sum', (a) => a.reduce((s, x) => s + x, 0)),
    nat('round', (x, d) => { const m = 10 ** (d || 0); return Math.round(x * m) / m; }),
    nat('floor', Math.floor),
    nat('sorted', (a) => [...a].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0))),
    nat('range', (a, b) => {
      const [lo, hi] = b === undefined ? [0, a] : [a, b];
      const out = [];
      for (let i = lo; i < hi && out.length < 2000; i++) out.push(i);
      return out;
    }),
    nat('str', repr),
    nat('int', (x) => Math.trunc(Number(x))),
    nat('float', (x) => Number(x)),
    nat('random', () => rng()),
    nat('chance', (p) => rng() < p),                       // True with probability p
    nat('random_int', (a, b) => a + Math.floor(rng() * (b - a + 1))),
    nat('choice', (a) => {
      if (!Array.isArray(a) || !a.length) throw new BotRuntimeError('choice() needs a non-empty list');
      return a[Math.floor(rng() * a.length)];
    }),
    nat('print', (...xs) => { if (printOut) printOut.push(xs.map(repr).join(' ')); return null; }),
  ]);
}

class Program {
  constructor(source) {
    this.source = source;
    this.ast = parse(source);           // throws CompileError
  }
  has(name) { return !!this.ast.fns[name]; }
  functionNames() { return Object.keys(this.ast.fns); }

  /**
   * Call a top-level function. `env` maps names → values (game builtins,
   * state, action constructors). Throws BotRuntimeError on any misstep.
   */
  call(name, args, { env = {}, rng = Math.random, maxSteps = 40000, printOut = null } = {}) {
    const fn = this.ast.fns[name];
    if (!fn) throw new BotRuntimeError(`function "${name}" is not defined`);
    const globals = Object.assign(Object.create(null), stdBuiltins(rng, printOut), env);
    for (const [fname, fdef] of Object.entries(this.ast.fns)) {
      globals[fname] = { __fn: fdef, __globals: globals };
    }
    const state = { steps: 0, maxSteps, depth: 0, globals };
    return callFn(globals[name], args, state);
  }
}

function callFn(fnVal, args, S) {
  if (fnVal && fnVal.__native) return fnVal.__native(...args);
  const fn = fnVal.__fn;
  if (S.depth > 40) throw new BotRuntimeError('too much recursion (depth > 40)', fn.line);
  const locals = Object.create(null);
  fn.params.forEach((pname, i) => { locals[pname] = args[i] === undefined ? null : args[i]; });
  S.depth++;
  const sig = execBlock(fn.body, locals, S);
  S.depth--;
  return sig && sig.s === 'return' ? sig.v : null;
}

function tick(S, line) {
  if (++S.steps > S.maxSteps) {
    throw new BotRuntimeError('your bot ran too long (possible infinite loop)', line);
  }
}

function execBlock(stmts, locals, S) {
  for (const st of stmts) {
    const sig = execStmt(st, locals, S);
    if (sig) return sig;
  }
  return null;
}

function execStmt(st, locals, S) {
  tick(S, st.line);
  switch (st.k) {
    case 'pass': return null;
    case 'break': return { s: 'break' };
    case 'continue': return { s: 'continue' };
    case 'return': return { s: 'return', v: st.val ? evalExpr(st.val, locals, S) : null };
    case 'expr': evalExpr(st.expr, locals, S); return null;
    case 'def':
      locals[st.name] = { __fn: st, __globals: S.globals };
      return null;
    case 'assign': {
      let v = evalExpr(st.val, locals, S);
      if (st.op !== '=') {
        const cur = evalExpr(st.target, locals, S);
        const opc = st.op[0];
        v = binop(opc, cur, v, st.line);
      }
      if (st.target.k === 'name') locals[st.target.v] = v;
      else {
        const obj = evalExpr(st.target.obj, locals, S);
        const idx = evalExpr(st.target.idx, locals, S);
        if (Array.isArray(obj)) obj[pyIdx(obj, idx)] = v;
        else if (obj && typeof obj === 'object') obj[idx] = v;
        else throw new BotRuntimeError('cannot assign into that', st.line);
      }
      return null;
    }
    case 'if': {
      if (truthy(evalExpr(st.cond, locals, S))) return execBlock(st.body, locals, S);
      if (st.alt) return execBlock(st.alt, locals, S);
      return null;
    }
    case 'while': {
      while (truthy(evalExpr(st.cond, locals, S))) {
        tick(S, st.line);
        const sig = execBlock(st.body, locals, S);
        if (sig) {
          if (sig.s === 'break') break;
          if (sig.s === 'return') return sig;
        }
      }
      return null;
    }
    case 'for': {
      let iter = evalExpr(st.iter, locals, S);
      if (typeof iter === 'string') iter = iter.split('');
      if (!Array.isArray(iter)) throw new BotRuntimeError('you can only loop over a list', st.line);
      for (const item of [...iter]) {
        tick(S, st.line);
        locals[st.v] = item;
        const sig = execBlock(st.body, locals, S);
        if (sig) {
          if (sig.s === 'break') break;
          if (sig.s === 'return') return sig;
        }
      }
      return null;
    }
    default: throw new BotRuntimeError(`unknown statement`, st.line);
  }
}

function binop(op, a, b, line) {
  if (op === '+') {
    if (typeof a === 'string' || typeof b === 'string') return repr(a) === a && repr(b) === b ? a + b : repr(a) + repr(b);
    if (Array.isArray(a) && Array.isArray(b)) return a.concat(b);
    return num(a, line) + num(b, line);
  }
  const x = num(a, line), y = num(b, line);
  switch (op) {
    case '-': return x - y;
    case '*': return x * y;
    case '/': if (y === 0) throw new BotRuntimeError('division by zero', line); return x / y;
    case '//': if (y === 0) throw new BotRuntimeError('division by zero', line); return Math.floor(x / y);
    case '%': if (y === 0) throw new BotRuntimeError('division by zero', line); return ((x % y) + y) % y;
    case '**': return x ** y;
  }
  throw new BotRuntimeError(`unknown operator ${op}`, line);
}
function num(v, line) {
  if (typeof v === 'number') return v;
  if (v === true) return 1;
  if (v === false) return 0;
  throw new BotRuntimeError(`expected a number but got ${repr(v)}`, line);
}

function evalExpr(e, locals, S) {
  tick(S, e.line);
  switch (e.k) {
    case 'num': return e.v;
    case 'str': return e.v;
    case 'name': {
      if (e.v in locals) return locals[e.v];
      if (e.v in S.globals) return S.globals[e.v];
      throw new BotRuntimeError(`"${e.v}" is not defined — check the spelling, or set it first`, e.line);
    }
    case 'list': return e.items.map((x) => evalExpr(x, locals, S));
    case 'dict': {
      const o = {};
      for (const [k, v] of e.pairs) o[evalExpr(k, locals, S)] = evalExpr(v, locals, S);
      return o;
    }
    case 'neg': return -num(evalExpr(e.v, locals, S), e.line);
    case 'not': return !truthy(evalExpr(e.v, locals, S));
    case 'and': { const l = evalExpr(e.l, locals, S); return truthy(l) ? evalExpr(e.r, locals, S) : l; }
    case 'or': { const l = evalExpr(e.l, locals, S); return truthy(l) ? l : evalExpr(e.r, locals, S); }
    case 'ternary': return truthy(evalExpr(e.cond, locals, S)) ? evalExpr(e.a, locals, S) : evalExpr(e.b, locals, S);
    case 'bin': return binop(e.op, evalExpr(e.l, locals, S), evalExpr(e.r, locals, S), e.line);
    case 'cmp': {
      const a = evalExpr(e.l, locals, S), b = evalExpr(e.r, locals, S);
      switch (e.op) {
        case '==': return eq(a, b);
        case '!=': return !eq(a, b);
        case '<': return a < b;
        case '>': return a > b;
        case '<=': return a <= b;
        case '>=': return a >= b;
      }
      break;
    }
    case 'in': {
      const item = evalExpr(e.l, locals, S), coll = evalExpr(e.r, locals, S);
      if (Array.isArray(coll)) return coll.some((x) => eq(x, item));
      if (typeof coll === 'string') return coll.includes(item);
      if (coll && typeof coll === 'object') return item in coll;
      throw new BotRuntimeError('"in" needs a list, string, or dict on the right', e.line);
    }
    case 'index': {
      const obj = evalExpr(e.obj, locals, S);
      const idx = evalExpr(e.idx, locals, S);
      if (Array.isArray(obj) || typeof obj === 'string') {
        const i = pyIdx(obj, idx);
        if (i < 0 || i >= obj.length) throw new BotRuntimeError(`index ${idx} is out of range (length ${obj.length})`, e.line);
        return obj[i];
      }
      if (obj && typeof obj === 'object') {
        if (!(idx in obj)) throw new BotRuntimeError(`key ${repr(idx)} not found`, e.line);
        return obj[idx];
      }
      throw new BotRuntimeError('cannot index into that', e.line);
    }
    case 'attr': {
      const obj = evalExpr(e.obj, locals, S);
      if (Array.isArray(obj)) {
        const m = LIST_METHODS[e.name];
        if (m) return { __native: (...args) => m(obj, ...args), name: e.name };
        throw new BotRuntimeError(`lists have no "${e.name}" — try append, pop, remove, count, index, sort, reverse`, e.line);
      }
      if (typeof obj === 'string') {
        const m = STR_METHODS[e.name];
        if (m) return { __native: (...args) => m(obj, ...args), name: e.name };
        throw new BotRuntimeError(`strings have no "${e.name}"`, e.line);
      }
      if (obj && typeof obj === 'object') {
        if (e.name in obj) return obj[e.name];
        const known = Object.keys(obj).filter((k) => !k.startsWith('__')).slice(0, 12).join(', ');
        throw new BotRuntimeError(`no "${e.name}" here — available: ${known}`, e.line);
      }
      throw new BotRuntimeError(`cannot read ".${e.name}" of ${repr(obj)}`, e.line);
    }
    case 'call': {
      const fnVal = evalExpr(e.fn, locals, S);
      if (!fnVal || (!fnVal.__native && !fnVal.__fn)) {
        throw new BotRuntimeError(`${repr(fnVal)} is not a function`, e.line);
      }
      const args = e.args.map((a) => evalExpr(a, locals, S));
      try {
        return callFn(fnVal, args, S);
      } catch (err) {
        if (err.isRuntime && err.line === undefined) err.line = e.line;
        throw err;
      }
    }
    default: throw new BotRuntimeError('unknown expression', e.line);
  }
}

function compile(source) { return new Program(source); }

module.exports = { compile, Program, CompileError, BotRuntimeError, repr, truthy };
