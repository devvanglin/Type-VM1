/** Source location and error type shared by the assembler and its preprocessor. */

export interface SourceLine {
  file: string;
  line: number;
  text: string;
}

export class AsmError extends Error {
  file: string;
  line: number;

  constructor(message: string, loc?: { file: string; line: number }) {
    super(loc ? `${loc.file}:${loc.line}: ${message}` : message);
    this.name = "AsmError";
    this.file = loc ? loc.file : "<input>";
    this.line = loc ? loc.line : 0;
  }
}

export function fail(message: string, loc?: { file: string; line: number }): never {
  throw new AsmError(message, loc);
}
