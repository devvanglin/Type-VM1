/** RV32IM hart: integer core, CSRs, traps and interrupts. */

import { Bus, BusFault } from "./memory.ts";

export type StepStatus = "ok" | "wfi" | "halt";

const MSTATUS_MIE = 1 << 3;
const MSTATUS_MPIE = 1 << 7;
const MSTATUS_MPP_SHIFT = 11;

const MIP_MSIP = 1 << 3;
const MIP_MTIP = 1 << 7;
const MIP_MEIP = 1 << 11;

export const CAUSE = {
  instrMisaligned: 0,
  instrAccess: 1,
  illegal: 2,
  breakpoint: 3,
  loadMisaligned: 4,
  loadAccess: 5,
  storeMisaligned: 6,
  storeAccess: 7,
  ecallU: 8,
  ecallS: 9,
  ecallM: 11,
  interruptSoftware: 3,
  interruptTimer: 7,
  interruptExternal: 11,
} as const;

export class Cpu {
  regs = new Uint32Array(32);
  pc = 0;
  mode = 3; // 3 = M, 0 = U
  mstatus = 0;
  mie = 0;
  mtvec = 0;
  mscratch = 0;
  mepc = 0;
  mcause = 0;
  mtval = 0;
  mip = 0;
  mcounteren = 0;
  mcountinhibit = 0;
  mcycle = 0;
  minstret = 0;
  time = 0;
  halted = false;
  bus: Bus;
  /** Optional debugging hooks (used by --trace and tests). */
  onTrap: ((info: { cause: number; tval: number; epc: number; interrupt: boolean }) => void) | null = null;
  onStep: ((pc: number, inst: number) => void) | null = null;
  debugBranches = false;
  /** Number of instructions executed since reset (monotonic, not wrapped). */
  steps = 0;

  constructor(bus: Bus) {
    this.bus = bus;
  }

  reset(pc: number): void {
    this.regs.fill(0);
    this.pc = pc >>> 0;
    this.mode = 3;
    this.mstatus = 0;
    this.mie = 0;
    this.mtvec = 0;
    this.mscratch = 0;
    this.mepc = 0;
    this.mcause = 0;
    this.mtval = 0;
    this.mip = 0;
    this.mcounteren = 0;
    this.mcountinhibit = 0;
    this.mcycle = 0;
    this.minstret = 0;
    this.halted = false;
    this.steps = 0;
  }

  private nextInterrupt(): number {
    const mstatus = this.mstatus;
    if ((mstatus & MSTATUS_MIE) === 0) return -1;
    const pending = this.mie & this.mip;
    if (pending & MIP_MEIP) return CAUSE.interruptExternal;
    if (pending & MIP_MTIP) return CAUSE.interruptTimer;
    if (pending & MIP_MSIP) return CAUSE.interruptSoftware;
    return -1;
  }

  private takeTrap(cause: number, tval: number, interrupt: boolean): void {
    this.regs[0] = 0;
    const status = this.mstatus;
    const mie = (status & MSTATUS_MIE) !== 0 ? 1 : 0;
    const mpp = this.mode;
    this.mstatus = (status & ~(MSTATUS_MIE | MSTATUS_MPIE | (3 << MSTATUS_MPP_SHIFT))) |
      (mie << 7) | (mpp << MSTATUS_MPP_SHIFT);
    this.mepc = this.pc;
    this.mcause = ((interrupt ? 0x80000000 : 0) | cause) >>> 0;
    this.mtval = tval >>> 0;
    if (this.onTrap) this.onTrap({ cause, tval: tval >>> 0, epc: this.mepc, interrupt });
    this.mode = 3;
    const base = this.mtvec & ~3;
    if (interrupt && (this.mtvec & 3) === 1) {
      this.pc = (base + 4 * cause) >>> 0;
    } else {
      this.pc = base >>> 0;
    }
  }

  private trapException(cause: number, tval: number): void {
    this.takeTrap(cause, tval, false);
  }

  /** Execute a single instruction. */
  step(): StepStatus {
    if (this.halted) return "halt";
    this.mcycle = (this.mcycle + 1) >>> 0;
    this.steps++;

    const irq = this.nextInterrupt();
    if (irq >= 0) {
      this.takeTrap(irq, 0, true);
      return "ok";
    }

    const pc = this.pc;
    let inst: number;
    try {
      inst = this.bus.read32(pc);
    } catch (e) {
      if (e instanceof BusFault) {
        this.trapException(CAUSE.instrAccess, pc);
        return "ok";
      }
      throw e;
    }
    if (this.onStep) this.onStep(pc, inst);

    const opcode = inst & 0x7f;
    const rd = (inst >>> 7) & 31;
    const f3 = (inst >>> 12) & 7;
    const rs1 = (inst >>> 15) & 31;
    const rs2 = (inst >>> 20) & 31;
    const f7 = (inst >>> 25) & 0x7f;
    const immI = inst >> 20;
    const immS = ((inst >> 25) << 5) | ((inst >> 7) & 0x1f);
    const immB = ((((inst >> 31) & 1) << 12) | (((inst >> 7) & 1) << 11) |
      (((inst >> 25) & 0x3f) << 5) | (((inst >> 8) & 0xf) << 1));
    const immB13 = (immB << 19) >> 19;
    const immU = inst & 0xfffff000;
    const immJ = (((insB(inst, 31)) << 20) | (((inst >> 12) & 0xff) << 12) |
      (((inst >> 20) & 1) << 11) | (((inst >> 21) & 0x3ff) << 1));
    const immJ21 = (immJ << 11) >> 11;
    const r = this.regs;
    let nextPc = (pc + 4) >>> 0;

    switch (opcode) {
      case 0x37: // LUI
        r[rd] = immU >>> 0;
        break;
      case 0x17: // AUIPC
        r[rd] = (pc + immU) >>> 0;
        break;
      case 0x6f: // JAL
        r[rd] = nextPc;
        nextPc = (pc + immJ21) >>> 0;
        break;
      case 0x67: { // JALR
        const target = ((r[rs1] | 0) + immI) & ~1;
        r[rd] = nextPc;
        nextPc = target >>> 0;
        break;
      }
      case 0x63: { // BRANCH
        const a = r[rs1] | 0;
        const b = r[rs2] | 0;
        let taken = false;
        switch (f3) {
          case 0: taken = a === b; break;
          case 1: taken = a !== b; break;
          case 4: taken = a < b; break;
          case 5: taken = a >= b; break;
          case 6: taken = (a >>> 0) < (b >>> 0); break;
          case 7: taken = (a >>> 0) >= (b >>> 0); break;
          default: this.trapException(CAUSE.illegal, inst); return "ok";
        }
        if (taken) nextPc = (pc + immB13) >>> 0;
        if (this.debugBranches) {
          console.error(`branch pc=0x${pc.toString(16)} inst=0x${inst.toString(16)} f3=${f3} rs1=x${rs1}(${a}) rs2=x${rs2}(${b}) taken=${taken} off=${immB13} next=0x${nextPc.toString(16)}`);
        }
        break;
      }
      case 0x03: { // LOAD
        const addr = ((r[rs1] | 0) + immI) >>> 0;
        const align = f3 === 2 ? 4 : f3 === 1 || f3 === 5 ? 2 : 1;
        if (align > 1 && (addr & (align - 1)) !== 0) {
          this.trapException(CAUSE.loadMisaligned, addr);
          return "ok";
        }
        try {
          switch (f3) {
            case 0: r[rd] = (this.bus.read8(addr) << 24) >> 24; break;
            case 1: r[rd] = (this.bus.read16(addr) << 16) >> 16; break;
            case 2: r[rd] = this.bus.read32(addr); break;
            case 4: r[rd] = this.bus.read8(addr); break;
            case 5: r[rd] = this.bus.read16(addr); break;
            default: this.trapException(CAUSE.illegal, inst); return "ok";
          }
        } catch (e) {
          if (e instanceof BusFault) { this.trapException(CAUSE.loadAccess, addr); return "ok"; }
          throw e;
        }
        break;
      }
      case 0x23: { // STORE
        const addr = ((r[rs1] | 0) + immS) >>> 0;
        const align = f3 === 2 ? 4 : f3 === 1 ? 2 : 1;
        if (align > 1 && (addr & (align - 1)) !== 0) {
          this.trapException(CAUSE.storeMisaligned, addr);
          return "ok";
        }
        try {
          switch (f3) {
            case 0: this.bus.write8(addr, r[rs2]); break;
            case 1: this.bus.write16(addr, r[rs2]); break;
            case 2: this.bus.write32(addr, r[rs2]); break;
            default: this.trapException(CAUSE.illegal, inst); return "ok";
          }
        } catch (e) {
          if (e instanceof BusFault) { this.trapException(CAUSE.storeAccess, addr); return "ok"; }
          throw e;
        }
        break;
      }
      case 0x13: { // OP-IMM
        const a = r[rs1] | 0;
        switch (f3) {
          case 0: r[rd] = (a + immI) >>> 0; break;
          case 1:
            if (f7 === 0x00) r[rd] = (a << (immI & 31)) >>> 0;
            else { this.trapException(CAUSE.illegal, inst); return "ok"; }
            break;
          case 2: r[rd] = (a < immI ? 1 : 0) >>> 0; break;
          case 3: r[rd] = ((a >>> 0) < (immI >>> 0) ? 1 : 0) >>> 0; break;
          case 4: r[rd] = (a ^ immI) >>> 0; break;
          case 5:
            if (f7 === 0x00) r[rd] = (a >>> (immI & 31)) >>> 0;
            else if (f7 === 0x20) r[rd] = (a >> (immI & 31)) >>> 0;
            else { this.trapException(CAUSE.illegal, inst); return "ok"; }
            break;
          case 6: r[rd] = (a | immI) >>> 0; break;
          case 7: r[rd] = (a & immI) >>> 0; break;
        }
        break;
      }
      case 0x33: { // OP
        const a = r[rs1] | 0;
        const b = r[rs2] | 0;
        const au = r[rs1] >>> 0;
        const bu = r[rs2] >>> 0;
        switch (f3) {
          case 0:
            r[rd] = (f7 === 0x20 ? (a - b) : (a + b)) >>> 0;
            break;
          case 1: r[rd] = (a << (b & 31)) >>> 0; break;
          case 2: r[rd] = (a < b ? 1 : 0) >>> 0; break;
          case 3: r[rd] = (au < bu ? 1 : 0) >>> 0; break;
          case 4: r[rd] = (a ^ b) >>> 0; break;
          case 5:
            r[rd] = (f7 === 0x20 ? (a >> (b & 31)) : (au >>> (b & 31))) >>> 0;
            break;
          case 6: r[rd] = (a | b) >>> 0; break;
          case 7: r[rd] = (a & b) >>> 0; break;
        }
        if (f7 === 0x01) {
          switch (f3) {
            case 0: r[rd] = Math.imul(a, b) >>> 0; break;
            case 1: r[rd] = Number((BigInt(a | 0) * BigInt(b | 0)) >> 32n) >>> 0; break;
            case 2: r[rd] = Number((BigInt(a | 0) * BigInt(bu)) >> 32n) >>> 0; break;
            case 3: r[rd] = Number((BigInt(au) * BigInt(bu)) >> 32n) >>> 0; break;
            case 4:
              if (b === 0) r[rd] = 0xffffffff;
              else if (a === -2147483648 && b === -1) r[rd] = 0x80000000;
              else r[rd] = (Math.trunc(a / b)) >>> 0;
              break;
            case 5:
              if (bu === 0) r[rd] = 0xffffffff;
              else r[rd] = Math.floor(au / bu) >>> 0;
              break;
            case 6:
              if (b === 0) r[rd] = a >>> 0;
              else if (a === -2147483648 && b === -1) r[rd] = 0;
              else r[rd] = (a % b) >>> 0;
              break;
            case 7:
              if (bu === 0) r[rd] = au;
              else r[rd] = (au % bu) >>> 0;
              break;
          }
        }
        break;
      }
      case 0x0f: // FENCE / FENCE.I
        break;
      case 0x73: { // SYSTEM
        if (f3 === 0) {
          if (inst === 0x73) { // ECALL
            this.trapException(this.mode === 3 ? CAUSE.ecallM : CAUSE.ecallU, 0);
            return "ok";
          }
          if (inst === 0x00100073) { // EBREAK
            this.trapException(CAUSE.breakpoint, 0);
            return "ok";
          }
          if (inst === 0x30200073) { // MRET
            const mpp = (this.mstatus >>> MSTATUS_MPP_SHIFT) & 3;
            const mpie = (this.mstatus & MSTATUS_MPIE) !== 0 ? 1 : 0;
            this.mstatus = (this.mstatus & ~(MSTATUS_MIE | MSTATUS_MPIE | (3 << MSTATUS_MPP_SHIFT))) |
              (mpie << 3) | MSTATUS_MPIE;
            this.mode = mpp;
            this.pc = this.mepc >>> 0;
            return "ok";
          }
          if (inst === 0x10500073) { // WFI
            if ((this.mie & this.mip) !== 0) break;
            // Retire the instruction; the machine fast-forwards virtual time.
            this.pc = nextPc;
            return "wfi";
          }
          this.trapException(CAUSE.illegal, inst);
          return "ok";
        }
        const csr = (inst >>> 20) & 0xfff;
        const isImm = (f3 & 4) !== 0;
        const srcReg = rs1;
        const srcVal = isImm ? rs1 : r[rs1];
        const write = ((f3 & 3) === 1) || (srcReg !== 0);
        let old: number;
        try {
          old = this.readCsr(csr);
        } catch {
          this.trapException(CAUSE.illegal, inst);
          return "ok";
        }
        if (((csr >>> 10) & 3) === 3 && (write || (f3 & 3) === 1)) {
          this.trapException(CAUSE.illegal, inst);
          return "ok";
        }
        if (write) {
          let value = old;
          switch (f3 & 3) {
            case 1: value = srcVal; break;
            case 2: value = old | srcVal; break;
            case 3: value = old & ~srcVal; break;
          }
          try {
            this.writeCsr(csr, value >>> 0);
          } catch {
            this.trapException(CAUSE.illegal, inst);
            return "ok";
          }
        }
        r[rd] = old >>> 0;
        break;
      }
      default:
        this.trapException(CAUSE.illegal, inst);
        return "ok";
    }

    this.pc = nextPc;
    r[0] = 0; // x0 is hard-wired to zero
    if ((this.mcountinhibit & 4) === 0) this.minstret = (this.minstret + 1) >>> 0;
    return "ok";
  }

  private readCsr(csr: number): number {
    switch (csr) {
      case 0x300: return this.mstatus;
      case 0x301: return 0x40001100; // RV32 I+M
      case 0x304: return this.mie;
      case 0x305: return this.mtvec;
      case 0x306: return this.mcounteren;
      case 0x320: return this.mcountinhibit;
      case 0x340: return this.mscratch;
      case 0x341: return this.mepc;
      case 0x342: return this.mcause;
      case 0x343: return this.mtval;
      case 0x344: return this.mip;
      case 0xb00: return this.mcycle;
      case 0xb02: return this.minstret;
      case 0xb80: return 0;
      case 0xb82: return 0;
      case 0xc00: return this.mcycle;
      case 0xc01: return this.time >>> 0;
      case 0xc02: return this.minstret;
      case 0xc80: return 0;
      case 0xc81: return Math.floor(this.time / 4294967296) >>> 0;
      case 0xc82: return 0;
      case 0xf11: return 0x5459564d; // "TVM" vendor id
      case 0xf12: return 0x31564d54; // "TMV1" architecture id
      case 0xf13: return 0x00010000;
      case 0xf14: return 0;
      default:
        throw new Error(`unsupported CSR 0x${csr.toString(16)}`);
    }
  }

  private writeCsr(csr: number, value: number): void {
    switch (csr) {
      case 0x300: {
        const keep = this.mstatus & ~(MSTATUS_MIE | (3 << MSTATUS_MPP_SHIFT));
        this.mstatus = (keep | (value & (MSTATUS_MIE | (3 << MSTATUS_MPP_SHIFT)))) >>> 0;
        return;
      }
      case 0x304: this.mie = value; return;
      case 0x305: this.mtvec = value; return;
      case 0x306: this.mcounteren = value; return;
      case 0x320: this.mcountinhibit = value & 7; return;
      case 0x340: this.mscratch = value; return;
      case 0x341: this.mepc = value & ~1; return;
      case 0x342: this.mcause = value; return;
      case 0x343: this.mtval = value; return;
      case 0x344: this.mip = (this.mip & 0x888) | (value & 0x8); return;
      case 0xb00: this.mcycle = value; return;
      case 0xb02: this.minstret = value; return;
      case 0xb80: case 0xb82: return;
      default:
        throw new Error(`unsupported CSR 0x${csr.toString(16)}`);
    }
  }

  /** Set interrupt-pending bits (MIP). Device lines are OR-ed by the machine. */
  setMip(bits: number): void {
    this.mip = (this.mip & ~0x888) | (bits & 0x888);
  }
}

function insB(inst: number, bit: number): number {
  return (inst >>> bit) & 1;
}
