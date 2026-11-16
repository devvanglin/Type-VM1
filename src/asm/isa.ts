/** RV32IM instruction encoders plus the pseudo-instructions the assembler supports. */

export const ABI_REGS: Record<string, number> = {
  zero: 0, ra: 1, sp: 2, gp: 3, tp: 4, t0: 5, t1: 6, t2: 7,
  s0: 8, fp: 8, s1: 9,
  a0: 10, a1: 11, a2: 12, a3: 13, a4: 14, a5: 15, a6: 16, a7: 17,
  s2: 18, s3: 19, s4: 20, s5: 21, s6: 22, s7: 23, s8: 24, s9: 25, s10: 26, s11: 27,
  t3: 28, t4: 29, t5: 30, t6: 31,
};

export const CSRS: Record<string, number> = {
  mstatus: 0x300, misa: 0x301, medeleg: 0x302, mideleg: 0x303,
  mie: 0x304, mtvec: 0x305, mcounteren: 0x306,
  mscratch: 0x340, mepc: 0x341, mcause: 0x342, mtval: 0x343, mip: 0x344,
  menvcfg: 0x30a, mstatush: 0x310,
  mcycle: 0xb00, minstret: 0xb02, mcycleh: 0xb80, minstreth: 0xb82,
  mcountinhibit: 0x320,
  mhartid: 0xf14, mvendorid: 0xf11, marchid: 0xf12, mimpid: 0xf13,
  cycle: 0xc00, time: 0xc01, instret: 0xc02,
  cycleh: 0xc80, timeh: 0xc81, instreth: 0xc82,
};

export interface OpCtx {
  /** Address of the instruction being encoded (used for pc-relative operands). */
  pc: number;
  /** True when the assembler relaxed this branch into the 8-byte form. */
  expand: boolean;
  /** Size in bytes that the layout pass reserved for this instruction. */
  size: number;
  tryImm(op: string): number | undefined;
  reg(op: string): number;
  mem(op: string): { base: number; offset: number; isMem: boolean };
  csr(op: string): number;
  fault(message: string): never;
}

export interface InstrDef {
  /** Bytes reserved; may depend on the operand values. */
  size?: number | ((ctx: { tryImm(op: string): number | undefined }, ops: string[]) => number);
  encode(ctx: OpCtx, ops: string[]): number[];
}

function need(ctx: OpCtx, ops: string[], n: number, form: string): void {
  if (ops.length !== n) ctx.fault(`expected ${n} operand(s) (${form}), got ${ops.length}`);
}

function imm(ctx: OpCtx, op: string): number {
  const v = ctx.tryImm(op);
  if (v === undefined) ctx.fault(`unresolved symbol in operand '${op}'`);
  return v | 0;
}

function reg(ctx: OpCtx, op: string): number {
  return ctx.reg(op);
}

function immField(ctx: OpCtx, v: number, bits: number, what: string): number {
  const min = -(1 << (bits - 1));
  const max = (1 << (bits - 1)) - 1;
  if (v < min || v > max) ctx.fault(`${what} out of range: ${v} (allowed ${min}..${max})`);
  return v;
}

function encR(f7: number, rs2: number, rs1: number, f3: number, rd: number, op: number): number {
  return (((f7 & 0x7f) << 25) | ((rs2 & 31) << 20) | ((rs1 & 31) << 15) | ((f3 & 7) << 12) | ((rd & 31) << 7) | (op & 0x7f)) >>> 0;
}
function encI(v: number, rs1: number, f3: number, rd: number, op: number): number {
  return (((v & 0xfff) << 20) | ((rs1 & 31) << 15) | ((f3 & 7) << 12) | ((rd & 31) << 7) | (op & 0x7f)) >>> 0;
}
function encS(v: number, rs2: number, rs1: number, f3: number, op: number): number {
  return ((((v >> 5) & 0x7f) << 25) | ((rs2 & 31) << 20) | ((rs1 & 31) << 15) | ((f3 & 7) << 12) | ((v & 0x1f) << 7) | (op & 0x7f)) >>> 0;
}
function encB(v: number, rs2: number, rs1: number, f3: number, op: number): number {
  return ((((v >> 12) & 1) << 31) | (((v >> 5) & 0x3f) << 25) | ((rs2 & 31) << 20) | ((rs1 & 31) << 15) |
    ((f3 & 7) << 12) | (((v >> 1) & 0xf) << 8) | (((v >> 11) & 1) << 7) | (op & 0x7f)) >>> 0;
}
function encU(v: number, rd: number, op: number): number {
  return (((v & 0xfffff000) >>> 0) | ((rd & 31) << 7) | (op & 0x7f)) >>> 0;
}
function encJ(v: number, rd: number, op: number): number {
  return ((((v >> 20) & 1) << 31) | (((v >> 1) & 0x3ff) << 21) | (((v >> 11) & 1) << 20) |
    (((v >> 12) & 0xff) << 12) | ((rd & 31) << 7) | (op & 0x7f)) >>> 0;
}

function encodeBranch(ctx: OpCtx, ops: string[], name: string, f3: number): number[] {
  need(ctx, ops, 3, `${name} rs1, rs2, target`);
  const rs1 = reg(ctx, ops[0]);
  const rs2 = reg(ctx, ops[1]);
  const target = imm(ctx, ops[2]);
  return emitBranch(ctx, rs1, rs2, target, f3);
}

const BRANCH_F3: Record<string, number> = { beq: 0, bne: 1, blt: 4, bge: 5, bltu: 6, bgeu: 7 };

function encLoad(ctx: OpCtx, ops: string[], f3: number, name: string): number[] {
  need(ctx, ops, 2, `${name} rd, offset(rs1)`);
  const rd = reg(ctx, ops[0]);
  const m = ctx.mem(ops[1]);
  if (!m.isMem) ctx.fault(`expected 'offset(reg)' as ${name} memory operand`);
  const off = immField(ctx, m.offset, 12, "load offset");
  return [encI(off, m.base, f3, rd, 0x03)];
}

function encStore(ctx: OpCtx, ops: string[], f3: number, name: string): number[] {
  need(ctx, ops, 2, `${name} rs2, offset(rs1)`);
  const rs2 = reg(ctx, ops[0]);
  const m = ctx.mem(ops[1]);
  if (!m.isMem) ctx.fault(`expected 'offset(reg)' as ${name} memory operand`);
  const off = immField(ctx, m.offset, 12, "store offset");
  return [encS(off, rs2, m.base, f3, 0x23)];
}

function encAluI(ctx: OpCtx, ops: string[], f3: number, name: string): number[] {
  need(ctx, ops, 3, `${name} rd, rs1, imm`);
  const rd = reg(ctx, ops[0]);
  const rs1 = reg(ctx, ops[1]);
  const v = immField(ctx, imm(ctx, ops[2]), 12, "immediate");
  return [encI(v, rs1, f3, rd, 0x13)];
}

function encShiftI(ctx: OpCtx, ops: string[], f3: number, f7: number, name: string): number[] {
  need(ctx, ops, 3, `${name} rd, rs1, shamt`);
  const rd = reg(ctx, ops[0]);
  const rs1 = reg(ctx, ops[1]);
  const sh = imm(ctx, ops[2]);
  if (sh < 0 || sh > 31) ctx.fault("shift amount must be 0..31");
  return [encI((f7 << 5) | sh, rs1, f3, rd, 0x13)];
}

function encAluR(ctx: OpCtx, ops: string[], f3: number, f7: number, name: string): number[] {
  need(ctx, ops, 3, `${name} rd, rs1, rs2`);
  const rd = reg(ctx, ops[0]);
  const rs1 = reg(ctx, ops[1]);
  const rs2 = reg(ctx, ops[2]);
  return [encR(f7, rs2, rs1, f3, rd, 0x33)];
}

function encLi(ctx: OpCtx, ops: string[]): number[] {
  need(ctx, ops, 2, "li rd, imm");
  const rd = reg(ctx, ops[0]);
  const v = imm(ctx, ops[1]);
  if (ctx.size === 4) {
    if (v < -2048 || v > 2047) ctx.fault(`li value ${v} does not fit in 12 bits (size was fixed to 4 bytes)`);
    return [encI(v, 0, 0, rd, 0x13)];
  }
  const hi = ((v + 0x800) >>> 12) & 0xfffff;
  const lo = (v - (hi * 4096)) | 0;
  return [encU(hi << 12, rd, 0x37), encI(lo, rd, 0, rd, 0x13)];
}

function liSize(ctx: { tryImm(op: string): number | undefined }, ops: string[]): number {
  if (ops.length !== 2) return 8;
  const v = ctx.tryImm(ops[1]);
  if (v === undefined) return 8;
  return v >= -2048 && v <= 2047 ? 4 : 8;
}

function encLa(ctx: OpCtx, ops: string[]): number[] {
  need(ctx, ops, 2, "la rd, symbol");
  const rd = reg(ctx, ops[0]);
  const off = (imm(ctx, ops[1]) - ctx.pc) | 0;
  const hi = (off + 0x800) >> 12;
  const lo = (off - (hi << 12)) | 0;
  return [encU(hi << 12, rd, 0x17), encI(lo, rd, 0, rd, 0x13)];
}

function encCall(ctx: OpCtx, ops: string[]): number[] {
  need(ctx, ops, 1, "call symbol");
  const off = (imm(ctx, ops[0]) - ctx.pc) | 0;
  const hi = (off + 0x800) >> 12;
  const lo = (off - (hi << 12)) | 0;
  return [encU(hi << 12, 1, 0x17), encI(lo, 1, 0, 1, 0x67)];
}

function encTail(ctx: OpCtx, ops: string[]): number[] {
  need(ctx, ops, 1, "tail symbol");
  const off = (imm(ctx, ops[0]) - ctx.pc) | 0;
  const hi = (off + 0x800) >> 12;
  const lo = (off - (hi << 12)) | 0;
  return [encU(hi << 12, 6, 0x17), encI(lo, 6, 0, 0, 0x67)];
}

function encJal(ctx: OpCtx, ops: string[]): number[] {
  need(ctx, ops, 2, "jal rd, target");
  const rd = reg(ctx, ops[0]);
  const off = immField(ctx, (imm(ctx, ops[1]) - ctx.pc) | 0, 21, "jump offset");
  return [encJ(off, rd, 0x6f)];
}

function encJalr(ctx: OpCtx, ops: string[]): number[] {
  if (ops.length === 1) {
    const rs1 = reg(ctx, ops[0]);
    return [encI(0, rs1, 0, 1, 0x67)];
  }
  if (ops.length === 2) {
    const m = ctx.mem(ops[1]);
    if (m.isMem) {
      const rd = reg(ctx, ops[0]);
      return [encI(immField(ctx, m.offset, 12, "jalr offset"), m.base, 0, rd, 0x67)];
    }
    const rd = reg(ctx, ops[0]);
    const rs1 = reg(ctx, ops[1]);
    return [encI(0, rs1, 0, rd, 0x67)];
  }
  if (ops.length === 3) {
    const rd = reg(ctx, ops[0]);
    const rs1 = reg(ctx, ops[1]);
    const off = immField(ctx, imm(ctx, ops[2]), 12, "jalr offset");
    return [encI(off, rs1, 0, rd, 0x67)];
  }
  ctx.fault("expected 'jalr rd, rs1, offset', 'jalr rd, offset(rs1)' or 'jalr rs1'");
}

function encCsr(ctx: OpCtx, ops: string[], f3: number, isImm: boolean, name: string): number[] {
  need(ctx, ops, 3, `${name} rd, csr, ${isImm ? "uimm" : "rs1"}`);
  const rd = reg(ctx, ops[0]);
  const csr = ctx.csr(ops[1]);
  let src: number;
  if (isImm) {
    src = imm(ctx, ops[2]);
    if (src < 0 || src > 31) ctx.fault("CSR immediate must be 0..31");
  } else {
    src = reg(ctx, ops[2]);
  }
  return [(((csr & 0xfff) << 20) | (src << 15) | (f3 << 12) | (rd << 7) | 0x73) >>> 0];
}

function encCsrAlias(ctx: OpCtx, ops: string[], f3: number, name: string): number[] {
  need(ctx, ops, 2, `${name} rd, csr`);
  const rd = reg(ctx, ops[0]);
  const csr = ctx.csr(ops[1]);
  return [encI(csr & 0xfff, 0, f3, rd, 0x73)];
}

function encCsrW(ctx: OpCtx, ops: string[], f3: number, isImm: boolean, name: string): number[] {
  need(ctx, ops, 2, `${name} csr, ${isImm ? "uimm" : "rs1"}`);
  const csr = ctx.csr(ops[0]);
  let src: number;
  if (isImm) {
    src = imm(ctx, ops[1]);
    if (src < 0 || src > 31) ctx.fault("CSR immediate must be 0..31");
  } else {
    src = reg(ctx, ops[1]);
  }
  return [(((csr & 0xfff) << 20) | (src << 15) | (f3 << 12) | (0 << 7) | 0x73) >>> 0];
}

function encMemWord(ctx: OpCtx, ops: string[], f3: number, isLoad: boolean, name: string): number[] {
  if (isLoad) {
    need(ctx, ops, 2, `${name} rd, offset(rs1)`);
    const rd = reg(ctx, ops[0]);
    const m = ctx.mem(ops[1]);
    return [encI(immField(ctx, m.offset, 12, "offset"), m.base, f3, rd, 0x03)];
  }
  need(ctx, ops, 2, `${name} rs2, offset(rs1)`);
  const rs2 = reg(ctx, ops[0]);
  const m = ctx.mem(ops[1]);
  return [encS(immField(ctx, m.offset, 12, "offset"), rs2, m.base, f3, 0x23)];
}

/** Emit a conditional branch, relaxing to invert + jal when the target is far. */
function emitBranch(ctx: OpCtx, rs1: number, rs2: number, target: number, f3: number): number[] {
  if (!ctx.expand) {
    const off = immField(ctx, (target - ctx.pc) | 0, 13, "branch offset");
    return [encB(off, rs2, rs1, f3, 0x63)];
  }
  const inverse = [1, 0, -1, -1, 5, 4, 7, 6][f3];
  const jalOff = (target - (ctx.pc + 4)) | 0;
  immField(ctx, jalOff, 21, "relaxed branch offset");
  return [encB(8, rs2, rs1, inverse, 0x63), encJ(jalOff, 0, 0x6f)];
}

function encBnezZero(ctx: OpCtx, ops: string[], name: string): number[] {
  need(ctx, ops, 2, `${name} rs, target`);
  const rs = reg(ctx, ops[0]);
  const target = imm(ctx, ops[1]);
  // (funct3, rs1, rs2) for each alias.
  const map: Record<string, [number, number, number]> = {
    beqz: [0, rs, 0],
    bnez: [1, rs, 0],
    blez: [5, 0, rs],
    bgez: [5, rs, 0],
    bltz: [4, rs, 0],
    bgtz: [4, 0, rs],
  };
  const [f3, rs1, rs2] = map[name];
  return emitBranch(ctx, rs1, rs2, target, f3);
}

function encRet(ctx: OpCtx, ops: string[]): number[] {
  need(ctx, ops, 0, "ret");
  return [encI(0, 1, 0, 0, 0x67)];
}

function encJump(ctx: OpCtx, ops: string[]): number[] {
  need(ctx, ops, 1, "j target");
  const off = immField(ctx, (imm(ctx, ops[0]) - ctx.pc) | 0, 21, "jump offset");
  return [encJ(off, 0, 0x6f)];
}

function encFixed(word: number): (ctx: OpCtx, ops: string[]) => number[] {
  return (ctx, ops) => {
    need(ctx, ops, 0, `0x${word.toString(16)}`);
    return [word >>> 0];
  };
}

function encFence(ctx: OpCtx, ops: string[]): number[] {
  // Accept fence / fence.i with optional operand text, encode the common forms.
  if (ops.length === 0) return [0x0ff0000f];
  return [0x0ff0000f];
}

const R_INSTR: Array<[string, number, number]> = [
  ["add", 0, 0x00], ["sub", 0, 0x20], ["sll", 1, 0x00], ["slt", 2, 0x00], ["sltu", 3, 0x00],
  ["xor", 4, 0x00], ["srl", 5, 0x00], ["sra", 5, 0x20], ["or", 6, 0x00], ["and", 7, 0x00],
  ["mul", 0, 0x01], ["mulh", 1, 0x01], ["mulhsu", 2, 0x01], ["mulhu", 3, 0x01],
  ["div", 4, 0x01], ["divu", 5, 0x01], ["rem", 6, 0x01], ["remu", 7, 0x01],
];

const I_INSTR: Array<[string, number]> = [
  ["addi", 0], ["slti", 2], ["sltiu", 3], ["xori", 4], ["ori", 6], ["andi", 7],
];

const LOAD_INSTR: Array<[string, number, string]> = [
  ["lb", 0, "lb"], ["lh", 1, "lh"], ["lw", 2, "lw"], ["lbu", 4, "lbu"], ["lhu", 5, "lhu"],
];

const STORE_INSTR: Array<[string, number, string]> = [
  ["sb", 0, "sb"], ["sh", 1, "sh"], ["sw", 2, "sw"],
];

const BRANCH_INSTR: Array<[string, number]> = [
  ["beq", 0], ["bne", 1], ["blt", 4], ["bge", 5], ["bltu", 6], ["bgeu", 7],
];

function buildTable(): Record<string, InstrDef> {
  const t: Record<string, InstrDef> = {};

  t.lui = { encode: (c, o) => { need(c, o, 2, "lui rd, imm20"); const v = imm(c, o[1]); return [encU(v << 12, reg(c, o[0]), 0x37)]; } };
  t.auipc = { encode: (c, o) => { need(c, o, 2, "auipc rd, imm20"); const v = imm(c, o[1]); return [encU(v << 12, reg(c, o[0]), 0x17)]; } };
  t.jal = { encode: encJal };
  t.jalr = { encode: encJalr };
  for (const [name, f3] of BRANCH_INSTR) {
    t[name] = { size: 4, encode: (c, o) => encodeBranch(c, o, name, f3) };
  }
  for (const [name, f3] of LOAD_INSTR) t[name] = { encode: (c, o) => encLoad(c, o, f3, name) };
  for (const [name, f3] of STORE_INSTR) t[name] = { encode: (c, o) => encStore(c, o, f3, name) };
  for (const [name, f3] of I_INSTR) t[name] = { encode: (c, o) => encAluI(c, o, f3, name) };
  t.slli = { encode: (c, o) => encShiftI(c, o, 1, 0x00, "slli") };
  t.srli = { encode: (c, o) => encShiftI(c, o, 5, 0x00, "srli") };
  t.srai = { encode: (c, o) => encShiftI(c, o, 5, 0x20, "srai") };
  for (const [name, f3, f7] of R_INSTR) t[name] = { encode: (c, o) => encAluR(c, o, f3, f7, name) };
  t.fence = { encode: encFence };
  t["fence.i"] = { encode: encFence };
  t.fencei = { encode: encFence };
  t.ecall = { encode: encFixed(0x00000073) };
  t.ebreak = { encode: encFixed(0x00100073) };
  t.mret = { encode: encFixed(0x30200073) };
  t.wfi = { encode: encFixed(0x10500073) };
  t.sret = { encode: encFixed(0x10200073) };
  t.unimp = { encode: encFixed(0x00000000) };

  t.csrrw = { encode: (c, o) => encCsr(c, o, 1, false, "csrrw") };
  t.csrrs = { encode: (c, o) => encCsr(c, o, 2, false, "csrrs") };
  t.csrrc = { encode: (c, o) => encCsr(c, o, 3, false, "csrrc") };
  t.csrrwi = { encode: (c, o) => encCsr(c, o, 5, true, "csrrwi") };
  t.csrrsi = { encode: (c, o) => encCsr(c, o, 6, true, "csrrsi") };
  t.csrrci = { encode: (c, o) => encCsr(c, o, 7, true, "csrrci") };

  t.li = { size: liSize, encode: encLi };
  t.la = { size: 8, encode: encLa };
  t.mv = { encode: (c, o) => { need(c, o, 2, "mv rd, rs"); return [encI(0, reg(c, o[1]), 0, reg(c, o[0]), 0x13)]; } };
  t.not = { encode: (c, o) => { need(c, o, 2, "not rd, rs"); return [encI(-1, reg(c, o[1]), 4, reg(c, o[0]), 0x13)]; } };
  t.neg = { encode: (c, o) => { need(c, o, 2, "neg rd, rs"); return [encR(0x20, reg(c, o[1]), 0, 0, reg(c, o[0]), 0x33)]; } };
  t.seqz = { encode: (c, o) => { need(c, o, 2, "seqz rd, rs"); return [encI(1, reg(c, o[1]), 3, reg(c, o[0]), 0x13)]; } };
  t.snez = { encode: (c, o) => { need(c, o, 2, "snez rd, rs"); return [encR(0, reg(c, o[1]), 0, 3, reg(c, o[0]), 0x33)]; } };
  t.sltz = { encode: (c, o) => { need(c, o, 2, "sltz rd, rs"); return [encR(0, 0, reg(c, o[1]), 2, reg(c, o[0]), 0x33)]; } };
  t.sgtz = { encode: (c, o) => { need(c, o, 2, "sgtz rd, rs"); return [encR(0, reg(c, o[1]), 0, 2, reg(c, o[0]), 0x33)]; } };
  t.nop = { encode: (c, o) => [0x00000013] };
  t.ret = { encode: encRet };
  t.j = { encode: encJump };
  t.jr = { encode: (c, o) => { need(c, o, 1, "jr rs"); return [encI(0, reg(c, o[0]), 0, 0, 0x67)]; } };
  t.call = { size: 8, encode: encCall };
  t.tail = { size: 8, encode: encTail };
  for (const name of ["beqz", "bnez", "blez", "bgez", "bltz", "bgtz"]) {
    t[name] = { size: 4, encode: (c, o) => encBnezZero(c, o, name) };
  }
  // bgt/ble/bgtu/bleu are the same machine branch with the operands swapped.
  const SWAPPED_BRANCH: Record<string, number> = { bgt: 4, ble: 5, bgtu: 6, bleu: 7 };
  for (const [name, f3] of Object.entries(SWAPPED_BRANCH)) {
    t[name] = {
      size: 4,
      encode: (c, o) => {
        need(c, o, 3, `${name} rs1, rs2, target`);
        const rs1 = reg(c, o[1]);
        const rs2 = reg(c, o[0]);
        return emitBranch(c, rs1, rs2, imm(c, o[2]), f3);
      },
    };
  }
  t["fence.i"] = { encode: encFence };
  t.csrr = { encode: (c, o) => encCsrAlias(c, o, 2, "csrr") };
  t.csrw = { encode: (c, o) => encCsrW(c, o, 1, false, "csrw") };
  t.csrs = { encode: (c, o) => encCsrW(c, o, 2, false, "csrs") };
  t.csrc = { encode: (c, o) => encCsrW(c, o, 3, false, "csrc") };
  t.csrwi = { encode: (c, o) => encCsrW(c, o, 5, true, "csrwi") };
  t.csrsi = { encode: (c, o) => encCsrW(c, o, 6, true, "csrsi") };
  t.csrci = { encode: (c, o) => encCsrW(c, o, 7, true, "csrci") };
  t.rdcycle = { encode: (c, o) => { need(c, o, 1, "rdcycle rd"); return [encI(0xc00, 0, 2, reg(c, o[0]), 0x73)]; } };
  t.rdtime = { encode: (c, o) => { need(c, o, 1, "rdtime rd"); return [encI(0xc01, 0, 2, reg(c, o[0]), 0x73)]; } };
  t.rdinstret = { encode: (c, o) => { need(c, o, 1, "rdinstret rd"); return [encI(0xc02, 0, 2, reg(c, o[0]), 0x73)]; } };
  return t;
}

export const INSTRUCTIONS: Record<string, InstrDef> = buildTable();

export function encodeInstructionSize(def: InstrDef, ctx: { tryImm(op: string): number | undefined }, ops: string[]): number {
  if (typeof def.size === "function") return def.size(ctx, ops);
  return def.size ?? 4;
}
