/** Textual preprocessor for the assembler: comments, .include and .macro. */

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve as resolvePath } from "node:path";
import { AsmError, type SourceLine } from "./errors.ts";

export interface PreprocessOptions {
  /** Extra include directories searched after the directory of the including file. */
  includeDirs?: string[];
  readFile?: (path: string) => string;
}

const MAX_INCLUDE_DEPTH = 16;
const MAX_MACRO_DEPTH = 64;

/** Remove a comment, respecting string literals. */
export function stripComment(text: string): string {
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") { i++; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "#" || ch === ";") return text.slice(0, i);
    if (ch === "/" && text[i + 1] === "/") return text.slice(0, i);
  }
  return text;
}

/** Split on `delim` ignoring delimiters inside quotes or brackets. */
export function splitTopLevel(text: string, delim = ","): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inString = false;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") { i++; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === delim && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts;
}

interface MacroDef {
  name: string;
  params: string[];
  body: string[];
  file: string;
  line: number;
}

export class Preprocessor {
  private macros = new Map<string, MacroDef>();
  private out: SourceLine[] = [];
  private invocationCounter = 0;
  private includeDirs: string[];
  private read: (path: string) => string;

  constructor(options: PreprocessOptions = {}) {
    this.includeDirs = options.includeDirs ?? [];
    this.read = options.readFile ?? ((p) => readFileSync(p, "utf8"));
  }

  run(source: string, fileName: string): SourceLine[] {
    this.processSource(source, fileName, 0, 0);
    return this.out;
  }

  private resolveInclude(name: string, fromFile: string): string {
    const candidates: string[] = [];
    if (isAbsolute(name)) candidates.push(name);
    else {
      candidates.push(resolvePath(dirname(fromFile), name));
      for (const dir of this.includeDirs) candidates.push(resolvePath(dir, name));
    }
    for (const c of candidates) if (existsSync(c)) return c;
    throw new AsmError(`cannot find include file '${name}'`, { file: fromFile, line: 0 });
  }

  private processSource(source: string, file: string, includeDepth: number, macroDepth: number): void {
    if (includeDepth > MAX_INCLUDE_DEPTH) {
      throw new AsmError("include nesting too deep", { file, line: 0 });
    }
    if (macroDepth > MAX_MACRO_DEPTH) {
      throw new AsmError("macro expansion too deep (recursive macro?)", { file, line: 0 });
    }
    const rawLines = source.split(/\r?\n/);
    for (let idx = 0; idx < rawLines.length; idx++) {
      const loc = { file, line: idx + 1 };
      const text = stripComment(rawLines[idx]).trim();
      if (text.length === 0) continue;

      if (text.startsWith(".include")) {
        const m = /^\.include\s+"([^"]+)"/.exec(text);
        if (!m) throw new AsmError("expected a quoted filename after .include", loc);
        const path = this.resolveInclude(m[1], file);
        this.processSource(this.read(path), path, includeDepth + 1, macroDepth);
        continue;
      }

      if (text.startsWith(".macro")) {
        const header = text.slice(".macro".length).trim();
        const words = header.split(/[\s,]+/).filter((w) => w.length > 0);
        if (words.length === 0) throw new AsmError(".macro requires a name", loc);
        const name = words[0];
        const params = words.slice(1);
        const body: string[] = [];
        let end = -1;
        let nesting = 1;
        for (let j = idx + 1; j < rawLines.length; j++) {
          const t = stripComment(rawLines[j]).trim();
          if (t.startsWith(".macro")) nesting++;
          else if (t.startsWith(".endm")) {
            nesting--;
            if (nesting === 0) { end = j; break; }
          }
          body.push(rawLines[j]);
        }
        if (end < 0) throw new AsmError(`unterminated .macro '${name}'`, loc);
        if (this.macros.has(name)) throw new AsmError(`macro '${name}' already defined`, loc);
        this.macros.set(name, { name, params, body, file, line: loc.line });
        idx = end;
        continue;
      }

      if (text === ".endm") throw new AsmError(".endm without .macro", loc);

      const firstWord = text.split(/[\s,]/)[0];
      const macro = this.macros.get(firstWord);
      if (macro) {
        const rest = text.slice(firstWord.length).trim();
        const args = rest.length === 0 ? [] : splitTopLevel(rest);
        if (args.length > macro.params.length) {
          throw new AsmError(`macro '${macro.name}' expects ${macro.params.length} argument(s), got ${args.length}`, loc);
        }
        const binding = new Map<string, string>();
        macro.params.forEach((p, i) => binding.set(p, args[i] ?? ""));
        const uid = String(++this.invocationCounter);
        for (const bodyLine of macro.body) {
          const expanded = bodyLine.replace(/\\(@|[A-Za-z_][\w]*)/g, (whole, name: string) => {
            if (name === "@") return uid;
            if (binding.has(name)) return binding.get(name) as string;
            return whole;
          });
          this.processSource(expanded, macro.file, includeDepth, macroDepth + 1);
        }
        continue;
      }

      this.out.push({ file, line: idx + 1, text });
    }
  }
}

export function preprocess(source: string, fileName = "<input>", options: PreprocessOptions = {}): SourceLine[] {
  return new Preprocessor(options).run(source, fileName);
}
