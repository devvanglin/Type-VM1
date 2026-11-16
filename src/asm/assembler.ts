/** Two-pass RV32IM assembler with branch relaxation, macros, includes and a listing. */

import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { AsmError, type SourceLine } from "./errors.ts";
import { evaluate, parseExpr, type ExprNode } from "./expr.ts";
import { ABI_REGS, CSRS, INSTRUCTIONS, encodeInstructionSize, type OpCtx } from "./isa.ts";
import { preprocess, splitTopLevel, stripComment } from "./preprocess.ts";

export type Loc = { file: string; line: number };

type DataEntry = { byte: number } | { node: ExprNode; width: number };

type Item =
  | { t: "label"; name: string; loc: Loc; addr: number }
  | {
      t: "instr"; name: string; ops: string[]; loc: Loc; text: string;
      addr: number; size: number; expand: boolean;
    }
  | { t: "bytes"; entries: DataEntry[]; loc: Loc; text: string; addr: number }
  | { t: "zero"; n: number; loc: Loc; text: string; addr: number }
  | { t: "align"; n: number; loc: Loc; text: string; addr: number; pad: number }
  | { t: "org"; expr: ExprNode; loc: Loc; text: string; addr: number; target: number }
  | { t: "equ"; name: string; expr: ExprNode; loc: Loc; text: string };

export interface AssembleOptions {
  /** Base address for the image; defaults to the address of the first emitted byte. */
  base?: number;
  /** File name used in diagnostics (defaults to "<input>"). */
  file?: string;
  includeDirs?: string[];
  readFile?: (path: string) => string;
  /** Collect a human-readable listing. */
  listing?: boolean;
}

export interface AssembleResult {
  base: number;
  image: Uint8Array;
  symbols: Map<string, number>;
  entry: number;
  listing: string;
  /** Number of machine instructions encoded. */
  instrCount: number;
  /** Source lines processed. */
  lineCount: number;
}

const NUMBER_RE = /^[+-]?(0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*)$/;

function parseRegister(text: string): number {
  const t = text.trim().toLowerCase();
  if (/^x([0-9]|[12][0-9]|3[01])$/.test(t)) return Number(t.slice(1));
  const r = ABI_REGS[t];
  if (r === undefined) throw new AsmError(`unknown register '${text}'`);
  return r;
}

function parseCsr(text: string): number {
  const t = text.trim().toLowerCase();
  const c = CSRS[t];
  if (c !== undefined) return c;
  if (/^0x[0-9a-f]+$/.test(t)) return parseInt(t.slice(2), 16);
  throw new AsmError(`unknown CSR '${text}'`);
}

function parseStringLiteral(text: string): number[] {
  const t = text.trim();
  if (!t.startsWith('"') || !t.endsWith('"') || t.length < 2) {
    throw new AsmError(`expected a string literal, got '${text}'`);
  }
  const body = t.slice(1, -1);
  const out: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch !== "\\") { out.push(body.charCodeAt(i) & 0xff); continue; }
    const next = body[++i];
    switch (next) {
      case "n": out.push(10); break;
      case "t": out.push(9); break;
      case "r": out.push(13); break;
      case "0": out.push(0); break;
      case "e": out.push(27); break;
      case "\\": out.push(92); break;
      case '"': out.push(34); break;
      case "x": {
        const hex = body.slice(i + 1, i + 3);
        if (!/^[0-9a-fA-F]{2}$/.test(hex)) throw new AsmError("bad \\x escape in string");
        out.push(parseInt(hex, 16));
        i += 2;
        break;
      }
      default: throw new AsmError(`bad escape '\\${next}' in string`);
    }
  }
  return out;
}

class Parser {
  items: Item[] = [];
  consts = new Map<string, number>();
  lineCount = 0;

  private evalConst(node: ExprNode): number | undefined {
    const r = evaluate(node, (name) => this.consts.get(name));
    return r.value;
  }

  parse(lines: SourceLine[]): Item[] {
    for (const line of lines) {
      this.lineCount++;
      try {
        this.parseLine(line);
      } catch (e) {
        if (e instanceof AsmError && e.line === 0) {
          throw new AsmError(e.message, { file: line.file, line: line.line });
        }
        throw e;
      }
    }
    return this.items;
  }

  private parseLine(line: SourceLine): void {
    const loc = { file: line.file, line: line.line };
    let text = stripComment(line.text).trim();
    if (text.length === 0) return;

    // Leading labels, possibly several on one line.
    for (;;) {
      const m = /^([A-Za-z_.$][\w.$]*):/.exec(text);
      if (!m) break;
      const name = m[1];
      if (this.items.some((it) => it.t === "label" && it.name === name) || this.consts.has(name)) {
        throw new AsmError(`duplicate label '${name}'`, loc);
      }
      this.items.push({ t: "label", name, loc, addr: 0 });
      text = text.slice(m[0].length).trim();
    }
    if (text.length === 0) return;

    if (text.startsWith(".")) {
      this.parseDirective(text, loc, line.text.trim());
      return;
    }

    const sp = text.search(/\s/);
    const name = (sp < 0 ? text : text.slice(0, sp)).toLowerCase();
    const rest = sp < 0 ? "" : text.slice(sp + 1).trim();
    const def = INSTRUCTIONS[name];
    if (!def) throw new AsmError(`unknown instruction '${name}'`, loc);
    const ops = rest.length === 0 ? [] : splitTopLevel(rest);
    const size = encodeInstructionSize(def, { tryImm: (op) => this.tryConst(op) }, ops);
    this.items.push({ t: "instr", name, ops, loc, text: line.text.trim(), addr: 0, size, expand: false });
  }

  private tryConst(op: string): number | undefined {
    try {
      return this.evalConst(parseExpr(op));
    } catch {
      return undefined;
    }
  }

  private parseDirective(text: string, loc: Loc, raw: string): void {
    const sp = text.search(/\s/);
    const dir = (sp < 0 ? text : text.slice(0, sp)).toLowerCase();
    const rest = sp < 0 ? "" : text.slice(sp + 1).trim();
    const operands = (): string[] => (rest.length === 0 ? [] : splitTopLevel(rest));

    switch (dir) {
      case ".org": {
        const expr = parseExpr(rest);
        this.items.push({ t: "org", expr, loc, text: raw, addr: 0, target: 0 });
        return;
      }
      case ".align": case ".p2align": case ".balign": {
        const n = Number(rest);
        if (!Number.isInteger(n) || n < 0 || n > 16) throw new AsmError(`bad alignment '${rest}'`, loc);
        const bytes = dir === ".balign" ? n : 1 << n;
        if (bytes === 0) throw new AsmError("alignment must be positive", loc);
        this.items.push({ t: "align", n: bytes, loc, text: raw, addr: 0, pad: 0 });
        return;
      }
      case ".byte": case ".half": case ".short": case ".word": case ".long": case ".dword": {
        const width = dir === ".byte" ? 1 : dir === ".half" || dir === ".short" ? 2 : dir === ".dword" ? 8 : 4;
        const entries: DataEntry[] = [];
        for (const op of operands()) {
          if (op.startsWith('"')) throw new AsmError(`string not allowed in ${dir}; use .ascii`, loc);
          const node = parseExpr(op);
          const v = this.evalConst(node);
          if (v === undefined) entries.push({ node, width });
          else entries.push(...bytesOf(v, width));
        }
        this.items.push({ t: "bytes", entries, loc, text: raw, addr: 0 });
        return;
      }
      case ".ascii": case ".asciz": case ".string": {
        const entries: DataEntry[] = [];
        for (const op of operands()) {
          for (const b of parseStringLiteral(op)) entries.push({ byte: b });
          if (dir !== ".ascii") entries.push({ byte: 0 });
        }
        this.items.push({ t: "bytes", entries, loc, text: raw, addr: 0 });
        return;
      }
      case ".space": case ".zero": {
        const parts = operands();
        const n = this.evalConst(parseExpr(parts[0] ?? "0"));
        if (n === undefined) throw new AsmError(".space size must be a constant", loc);
        const fill = parts[1] !== undefined ? this.evalConst(parseExpr(parts[1])) ?? 0 : 0;
        const entries: DataEntry[] = [];
        for (let i = 0; i < n; i++) entries.push({ byte: fill & 0xff });
        this.items.push({ t: "bytes", entries, loc, text: raw, addr: 0 });
        return;
      }
      case ".equ": case ".set": {
        const m = /^([A-Za-z_.$][\w.$]*)\s*,?\s*(.+)$/.exec(rest);
        if (!m) throw new AsmError(`.equ expects 'name, expression'`, loc);
        const name = m[1];
        const expr = parseExpr(m[2]);
        if (this.items.some((it) => (it.t === "label" || it.t === "equ") && it.name === name)) {
          throw new AsmError(`duplicate symbol '${name}'`, loc);
        }
        this.items.push({ t: "equ", name, expr, loc, text: raw });
        const v = this.evalConst(expr);
        if (v !== undefined) this.consts.set(name, v);
        return;
      }
      case ".text": case ".data": case ".rodata": case ".bss": case ".section":
      case ".global": case ".globl": case ".type": case ".size": case ".file":
      case ".ident": case ".option": case ".attribute": case ".local":
        return;
      default:
        throw new AsmError(`unknown directive '${dir}'`, loc);
    }
  }
}

function bytesOf(v: number, width: number): DataEntry[] {
  const out: DataEntry[] = [];
  for (let i = 0; i < width; i++) out.push({ byte: (v >>> (8 * i)) & 0xff });
  return out;
}

export function assemble(source: string, options: AssembleOptions = {}): AssembleResult {
  const file = options.file ?? "<input>";
  const lines = preprocess(source, file, { includeDirs: options.includeDirs, readFile: options.readFile });
  const parser = new Parser();
  const items = parser.parse(lines);

  const equDefs = new Map<string, { expr: ExprNode; loc: Loc }>();
  for (const it of items) if (it.t === "equ") equDefs.set(it.name, { expr: it.expr, loc: it.loc });

  // --- layout -------------------------------------------------------------
  let base = options.base ?? 0;
  let symbols = new Map<string, number>();
  let end = 0;

  const resolve = (node: ExprNode, loc: Loc): number => {
    const resolving = new Set<string>();
    const lookup = (name: string): number | undefined => {
      const s = symbols.get(name);
      if (s !== undefined) return s;
      const eq = equDefs.get(name);
      if (!eq) return undefined;
      if (resolving.has(name)) throw new AsmError(`circular definition of '${name}'`, loc);
      resolving.add(name);
      const r = evaluate(eq.expr, lookup);
      resolving.delete(name);
      if (r.value !== undefined) symbols.set(name, r.value);
      return r.value;
    };
    const e = evaluate(node, lookup);
    if (e.value === undefined) {
      throw new AsmError(`undefined symbol(s): ${e.unresolved.join(", ")}`, loc);
    }
    return e.value;
  };

  const instrSize = (it: Extract<Item, { t: "instr" }>): number => it.size;
  const itemBytes = (it: Item): number => {
    switch (it.t) {
      case "label": case "equ": return 0;
      case "instr": return instrSize(it);
      case "bytes": return it.entries.reduce((n, e) => n + ("byte" in e ? 1 : e.width), 0);
      case "zero": return it.n;
      case "align": return it.pad;
      case "org": return 0;
    }
  };

  const layout = (): void => {
    let here = options.base ?? 0;
    let firstEmitted = true;
    end = here;
    for (const it of items) {
      if (it.t === "align") {
        it.addr = here;
        it.pad = (it.n - (here % it.n)) % it.n;
        here += it.pad;
      } else if (it.t === "org") {
        it.addr = here;
        const target = resolve(it.expr, it.loc);
        if (target < here) throw new AsmError(`.org 0x${target.toString(16)} moves backwards from 0x${here.toString(16)}`, it.loc);
        it.target = target;
        here = target;
      } else if (it.t === "label" || it.t === "equ") {
        it.addr = here;
      } else {
        it.addr = here;
        if (firstEmitted && options.base === undefined) {
          base = here;
          firstEmitted = false;
        }
        here += itemBytes(it);
      }
      end = here;
    }
    symbols = new Map();
    for (const it of items) {
      if (it.t === "label") symbols.set(it.name, it.addr);
    }
  };

  const branchOffset = (it: Extract<Item, { t: "instr" }>): number | undefined => {
    const ops = it.ops;
    let targetText: string | undefined;
    if (it.name in BRANCH_ALIASES) targetText = ops[1];
    else if (BRANCH_RE.test(it.name)) targetText = ops[2];
    else return undefined;
    if (targetText === undefined) return undefined;
    try {
      return (resolve(parseExpr(targetText), it.loc) - it.addr) | 0;
    } catch {
      return undefined;
    }
  };

  for (let iter = 0; iter < 200; iter++) {
    layout();
    let changed = false;
    for (const it of items) {
      if (it.t !== "instr" || it.expand) continue;
      if (!(it.name in BRANCH_ALIASES) && !BRANCH_RE.test(it.name)) continue;
      const off = branchOffset(it);
      if (off !== undefined && (off < -4096 || off > 4095)) {
        it.expand = true;
        it.size = 8;
        changed = true;
      }
    }
    if (!changed) break;
  }

  for (const it of items) {
    if (it.t !== "equ" && it.t !== "org" && it.addr < base) {
      throw new AsmError(
        `item at 0x${(it.addr >>> 0).toString(16)} lies below the image base 0x${(base >>> 0).toString(16)}; put '.org 0x...' before any labels`,
        it.loc,
      );
    }
  }

  // --- encode -------------------------------------------------------------
  const image = new Uint8Array(Math.max(0, end - base));
  let instrCount = 0;

  const ctxFor = (it: Extract<Item, { t: "instr" }>): OpCtx => ({
    pc: it.addr,
    expand: it.expand,
    size: it.size,
    tryImm: (op) => {
      try {
        return resolve(parseExpr(op), it.loc);
      } catch {
        return undefined;
      }
    },
    reg: (op) => {
      try {
        return parseRegister(op);
      } catch (e) {
        throw new AsmError((e as Error).message, it.loc);
      }
    },
    mem: (op) => {
      const m = /^(.*?)\(\s*([^()]+?)\s*\)$/.exec(op.trim());
      if (!m) {
        try {
          return { base: parseRegister(op), offset: 0, isMem: false };
        } catch {
          throw new AsmError(`expected a register or 'offset(reg)', got '${op}'`, it.loc);
        }
      }
      const offsetText = m[1].trim();
      const offset = offsetText.length === 0 ? 0 : (resolve(parseExpr(offsetText), it.loc) | 0);
      try {
        return { base: parseRegister(m[2]), offset, isMem: true };
      } catch {
        throw new AsmError(`bad base register in '${op}'`, it.loc);
      }
    },
    csr: (op) => {
      try {
        return parseCsr(op);
      } catch (e) {
        throw new AsmError((e as Error).message, it.loc);
      }
    },
    fault: (msg) => {
      throw new AsmError(msg, it.loc);
    },
  });

  for (const it of items) {
    const off = it.addr - base;
    if (it.t === "instr") {
      const def = INSTRUCTIONS[it.name];
      if (!def) throw new AsmError(`unknown instruction '${it.name}'`, it.loc);
      let words: number[];
      try {
        words = def.encode(ctxFor(it), it.ops);
      } catch (e) {
        if (e instanceof AsmError) throw e;
        throw new AsmError((e as Error).message, it.loc);
      }
      const needed = words.length * 4;
      if (needed !== it.size) {
        throw new AsmError(`internal: size mismatch for '${it.text}' (${needed} vs ${it.size})`, it.loc);
      }
      for (let i = 0; i < words.length; i++) writeU32(image, off + i * 4, words[i]);
      instrCount++;
    } else if (it.t === "bytes") {
      let cursor = off;
      for (const entry of it.entries) {
        if ("byte" in entry) {
          if (cursor >= 0 && cursor < image.length) image[cursor] = entry.byte & 0xff;
          cursor++;
        } else {
          const v = resolve(entry.node, it.loc);
          for (let i = 0; i < entry.width; i++) {
            if (cursor >= 0 && cursor < image.length) image[cursor] = (v >>> (8 * i)) & 0xff;
            cursor++;
          }
        }
      }
    }
  }

  // Resolve equ symbols so they appear in the symbol table.
  for (const [name] of equDefs) {
    if (!symbols.has(name)) {
      try {
        resolve({ k: "sym", name }, { file, line: 0 });
      } catch {
        // Unreferenced, undefined .equ values are reported only when used.
      }
    }
  }

  let listing = "";
  if (options.listing) listing = makeListing(items, image, base);

  const entry = symbols.get("_start") ?? symbols.get("start") ?? base;
  return { base, image, symbols, entry, listing, instrCount, lineCount: parser.lineCount };
}

const BRANCH_ALIASES: Record<string, true> = {
  beqz: true, bnez: true, blez: true, bgez: true, bltz: true, bgtz: true,
};
const BRANCH_RE = /^(beq|bne|blt|bge|bltu|bgeu)$/;

function writeU32(image: Uint8Array, off: number, value: number): void {
  if (off < 0 || off + 4 > image.length) throw new AsmError("internal: write out of image bounds");
  image[off] = value & 0xff;
  image[off + 1] = (value >>> 8) & 0xff;
  image[off + 2] = (value >>> 16) & 0xff;
  image[off + 3] = (value >>> 24) & 0xff;
}

function makeListing(items: Item[], image: Uint8Array, base: number): string {
  const out: string[] = [];
  for (const it of items) {
    if (it.t === "label") {
      out.push(`${hex32(it.addr)}  <${it.name}>:`);
      continue;
    }
    if (it.t === "equ") {
      out.push(`${" ".repeat(10)}  .equ ${it.name}`);
      continue;
    }
    if (it.t === "org" || it.t === "align") {
      out.push(`${hex32(it.addr)}  ${it.text}`);
      continue;
    }
    const off = it.addr - base;
    const bytes = it.t === "instr" ? (it.size === 8 ? 8 : 4) : Math.min(it.t === "bytes" ? itemBytesOf(it) : it.n, 12);
    const hex = Array.from(image.slice(off, off + bytes), (b) => b.toString(16).padStart(2, "0")).join(" ");
    out.push(`${hex32(it.addr)}  ${hex.padEnd(24)}  ${it.text}`);
  }
  return out.join("\n") + "\n";
}

function itemBytesOf(it: Extract<Item, { t: "bytes" }>): number {
  return it.entries.reduce((n, e) => n + ("byte" in e ? 1 : e.width), 0);
}

function hex32(v: number): string {
  return "0x" + (v >>> 0).toString(16).padStart(8, "0");
}

export function assembleFile(path: string, options: AssembleOptions = {}): AssembleResult {
  const source = readFileSync(path, "utf8");
  return assemble(source, {
    ...options,
    file: options.file ?? path,
    includeDirs: options.includeDirs ?? [dirname(path)],
  });
}
