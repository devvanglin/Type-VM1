/** Tiny integer expression parser used by the assembler.
 *
 * Supports decimal/hex/binary/octal literals, character literals, symbols,
 * unary + - ~ and the binary operators * / % + - << >> & ^ | with the usual
 * C precedence.  Evaluation is two-staged: a symbol may be unknown during the
 * layout pass, in which case the result reports it as unresolved.
 */

import { AsmError } from "./errors.ts";

export type ExprNode =
  | { k: "num"; v: number }
  | { k: "sym"; name: string }
  | { k: "un"; op: string; e: ExprNode }
  | { k: "bin"; op: string; l: ExprNode; r: ExprNode };

export interface EvalResult {
  value?: number;
  unresolved: string[];
}

const EXPR_TOKEN = /\s*(0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*|'(?:\\.|[^'\\])'|[A-Za-z_.$][\w.$]*|<<|>>|[-+*/%&|^~()])/y;

export function parseNumber(text: string): number {
  const t = text.replace(/_/g, "");
  if (/^0[xX]/.test(t)) return parseInt(t.slice(2), 16) >>> 0;
  if (/^0[bB]/.test(t)) return parseInt(t.slice(2), 2) >>> 0;
  if (/^0[oO]/.test(t)) return parseInt(t.slice(2), 8) >>> 0;
  if (/^\d+$/.test(t)) return Number(t);
  throw new AsmError(`bad number '${text}'`);
}

export function parseCharLiteral(text: string): number {
  const body = text.slice(1, -1);
  if (body.length === 1) return body.charCodeAt(0);
  if (body[0] !== "\\") throw new AsmError(`bad character literal ${text}`);
  switch (body[1]) {
    case "n": return 10;
    case "t": return 9;
    case "r": return 13;
    case "0": return 0;
    case "\\": return 92;
    case "'": return 39;
    case '"': return 34;
    case "e": return 27;
    default: throw new AsmError(`bad escape in character literal ${text}`);
  }
}

function tokenize(src: string): string[] {
  const tokens: string[] = [];
  let pos = 0;
  while (pos < src.length) {
    EXPR_TOKEN.lastIndex = pos;
    const m = EXPR_TOKEN.exec(src);
    if (!m) {
      if (/^\s*$/.test(src.slice(pos))) break;
      throw new AsmError(`bad expression near '${src.slice(pos).trim()}'`);
    }
    tokens.push(m[1]);
    pos = EXPR_TOKEN.lastIndex;
  }
  return tokens;
}

export function parseExpr(src: string): ExprNode {
  const tokens = tokenize(src);
  if (tokens.length === 0) throw new AsmError("empty expression");
  let i = 0;

  const peek = (): string | undefined => tokens[i];

  function parsePrimary(): ExprNode {
    const t = peek();
    if (t === undefined) throw new AsmError("unexpected end of expression");
    if (t === "(") {
      i++;
      const e = parseBinary(0);
      if (peek() !== ")") throw new AsmError("missing ')' in expression");
      i++;
      return e;
    }
    if (t === "-" || t === "+" || t === "~") {
      i++;
      return { k: "un", op: t, e: parsePrimary() };
    }
    if (/^0[xXbBoO]/.test(t) || /^\d/.test(t)) {
      i++;
      return { k: "num", v: parseNumber(t) };
    }
    if (t.startsWith("'")) {
      i++;
      return { k: "num", v: parseCharLiteral(t) };
    }
    if (/^[A-Za-z_.$]/.test(t)) {
      i++;
      return { k: "sym", name: t };
    }
    throw new AsmError(`unexpected token '${t}' in expression`);
  }

  const PRECEDENCE: Record<string, number> = {
    "|": 1, "^": 2, "&": 3, "<<": 4, ">>": 4, "+": 5, "-": 5, "*": 6, "/": 6, "%": 6,
  };

  function parseBinary(minPrec: number): ExprNode {
    let left = parsePrimary();
    for (;;) {
      const op = peek();
      if (op === undefined) break;
      const prec = PRECEDENCE[op];
      if (prec === undefined || prec < minPrec) break;
      i++;
      const right = parseBinary(prec + 1);
      left = { k: "bin", op, l: left, r: right };
    }
    return left;
  }

  const node = parseBinary(0);
  if (i !== tokens.length) throw new AsmError(`trailing input in expression near '${tokens[i]}'`);
  return node;
}

function truncDiv(a: number, b: number): number {
  assertNotZero(b);
  return Math.trunc(a / b);
}

function assertNotZero(b: number): void {
  if (b === 0) throw new AsmError("division by zero in expression");
}

/** Evaluate an expression.  `lookup` returns undefined for symbols that are not
 * defined yet; those are reported in `unresolved` instead of throwing. */
export function evaluate(node: ExprNode, lookup: (name: string) => number | undefined): EvalResult {
  const unresolved: string[] = [];

  function ev(n: ExprNode): number | undefined {
    switch (n.k) {
      case "num": return n.v;
      case "sym": {
        const v = lookup(n.name);
        if (v === undefined) {
          if (!unresolved.includes(n.name)) unresolved.push(n.name);
          return undefined;
        }
        return v;
      }
      case "un": {
        const v = ev(n.e);
        if (v === undefined) return undefined;
        if (n.op === "-") return -v;
        if (n.op === "~") return ~v >>> 0;
        return v;
      }
      case "bin": {
        const l = ev(n.l);
        const r = ev(n.r);
        if (l === undefined || r === undefined) return undefined;
        switch (n.op) {
          case "+": return l + r;
          case "-": return l - r;
          case "*": return Math.imul(l, r) >>> 0;
          case "/": return truncDiv(l, r);
          case "%": { assertNotZero(r); return (l % r); }
          case "<<": return (l << (r & 31)) >>> 0;
          case ">>": return l >>> (r & 31);
          case "&": return (l & r) >>> 0;
          case "|": return (l | r) >>> 0;
          case "^": return (l ^ r) >>> 0;
          default: throw new AsmError(`bad operator ${n.op}`);
        }
      }
    }
  }

  const value = ev(node);
  return { value, unresolved };
}
