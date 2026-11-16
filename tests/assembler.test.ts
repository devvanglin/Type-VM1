import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assemble } from "../src/asm/assembler.ts";
import { AsmError } from "../src/asm/errors.ts";

function words(source: string, count: number): number[] {
  const result = assemble(source, { file: "t.asm" });
  const view = new DataView(result.image.buffer, result.image.byteOffset, result.image.byteLength);
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(view.getUint32(i * 4, true));
  return out;
}

test("encodes the base RV32I instructions with the reference encodings", () => {
  const w = words(`
.org 0x80000000
addi a0, zero, 1
add a0, a1, a2
sub a0, a1, a2
lui a0, 0x12345
auipc a0, 0x1
jal ra, target
target:
jalr ra, 0(a0)
sw a1, 8(a0)
lw a1, 8(a0)
beq a0, a1, here
here:
slli a0, a1, 3
srai a0, a1, 3
ecall
mret
wfi
`, 15);
  assert.equal(w[0], 0x00100513); // addi a0, x0, 1
  assert.equal(w[1], 0x00c58533); // add a0, a1, a2
  assert.equal(w[2], 0x40c58533); // sub a0, a1, a2
  assert.equal(w[3], 0x12345537); // lui a0, 0x12345
  assert.equal(w[4], 0x00001517); // auipc a0, 1
  assert.equal(w[5], 0x004000ef); // jal ra, +4 (target is the next instruction)
  assert.equal(w[6], 0x000500e7); // jalr ra, 0(a0)
  assert.equal(w[7], 0x00b52423); // sw a1, 8(a0)
  assert.equal(w[8], 0x00852583); // lw a1, 8(a0)
  assert.equal(w[9], 0x00b50263); // beq a0, a1, +4 (to the label)
  assert.equal(w[10], 0x00359513); // slli a0, a1, 3
  assert.equal(w[11], 0x4035d513); // srai a0, a1, 3
  assert.equal(w[12], 0x00000073); // ecall
  assert.equal(w[13], 0x30200073); // mret
  assert.equal(w[14], 0x10500073); // wfi
});

test("encodes the M extension", () => {
  const w = words(`
.org 0x0
mul a0, a1, a2
mulh a0, a1, a2
divu a0, a1, a2
rem a0, a1, a2
`, 4);
  assert.equal(w[0], 0x02c58533);
  assert.equal(w[1], 0x02c59533);
  assert.equal(w[2], 0x02c5d533);
  assert.equal(w[3], 0x02c5e533);
});

test("pseudo instructions expand as expected", () => {
  const result = assemble(`
.org 0x80000000
start:
  li a0, 5
  li a1, 0x12345678
  mv a2, a0
  nop
  ret
  la a3, start
  call start
`, { file: "t.asm" });
  const view = new DataView(result.image.buffer);
  assert.equal(view.getUint32(0, true), 0x00500513); // li a0, 5 -> addi
  assert.equal(view.getUint32(12, true), 0x00050613); // mv a2, a0
  assert.equal(view.getUint32(16, true), 0x00000013); // nop
  assert.equal(view.getUint32(20, true), 0x00008067); // ret
  assert.equal(result.instrCount, 7);
});

test("li picks the short form when it fits in 12 bits", () => {
  const short = assemble(".org 0x0\nli a0, 2047\n", { file: "t.asm" });
  assert.equal(short.image.length, 4);
  const long = assemble(".org 0x0\nli a0, 2048\n", { file: "t.asm" });
  assert.equal(long.image.length, 8);
});

test("macros, arguments and unique labels work", () => {
  const result = assemble(`
.org 0x0
.macro set reg, value
  li \\reg, \\value
wait_\\@:
  bnez \\reg, wait_\\@
.endm
  set a0, 1
  set a1, 2
`, { file: "t.asm" });
  const symbols = [...result.symbols.keys()];
  assert.ok(symbols.includes("wait_1"));
  assert.ok(symbols.includes("wait_2"));
  assert.equal(result.instrCount, 4);
});

test("includes are resolved relative to the including file", () => {
  const dir = mkdtempSync(join(tmpdir(), "type-vm1-asm-"));
  try {
    writeFileSync(join(dir, "a.asm"), '.equ SIZE, 4\n.include "b.asm"\n');
    writeFileSync(join(dir, "b.asm"), "value: .word SIZE\n");
    const result = assemble('.include "a.asm"\n', {
      file: join(dir, "a.asm"),
      includeDirs: [dir],
    });
    const view = new DataView(result.image.buffer);
    assert.equal(view.getUint32(0, true), 4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("branch relaxation converts far branches", () => {
  const result = assemble(`
.org 0x80000000
start:
  beq a0, a1, far
  .space 5000
far:
  nop
`, { file: "t.asm" });
  const view = new DataView(result.image.buffer);
  // The branch becomes "bne a0, a1, +8" followed by "jal x0, far".
  assert.equal(view.getUint32(0, true) & 0x7f, 0x63);
  assert.equal((view.getUint32(0, true) >>> 12) & 7, 1); // inverted to bne
  assert.equal(view.getUint32(4, true) & 0x7f, 0x6f); // jal
});

test("data directives and .equ produce little-endian bytes", () => {
  const result = assemble(`
.org 0x0
.equ MAGIC, 0x01020304
.byte 1, 2
.half 0x1234
.word MAGIC
.ascii "hi"
.asciz "z"
`, { file: "t.asm" });
  assert.deepEqual(Array.from(result.image), [1, 2, 0x34, 0x12, 4, 3, 2, 1, 0x68, 0x69, 0x7a, 0]);
});

test("unresolved symbols, bad immediates and duplicate labels are reported", () => {
  assert.throws(() => assemble(".org 0x0\nj unknown_symbol\n", { file: "t.asm" }), AsmError);
  assert.throws(() => assemble(".org 0x0\naddi a0, a0, 4096\n", { file: "t.asm" }), /out of range/);
  assert.throws(() => assemble(".org 0x0\na:\na:\n", { file: "t.asm" }), /duplicate label/);
  assert.throws(() => assemble(".org 0x0\nfrobnicate a0\n", { file: "t.asm" }), /unknown instruction/);
  assert.throws(() => assemble(".org 0x0\n.unknown\n", { file: "t.asm" }), /unknown directive/);
});

test("listing annotates addresses and encodings", () => {
  const result = assemble(".org 0x80000000\nstart:\nnop\nret\n", { file: "t.asm", listing: true });
  assert.match(result.listing, /<start>:/);
  assert.match(result.listing, /13 00 00 00\s+nop/);
});

test("expressions evaluate with symbols, precedence and unary operators", () => {
  const result = assemble(`
.org 0x0
.equ BASE, 0x100
.word BASE + 2 * 3
.word (BASE << 2) | 1
.word -BASE
.word ~0
`, { file: "t.asm" });
  const view = new DataView(result.image.buffer);
  assert.equal(view.getUint32(0, true), 0x106);
  assert.equal(view.getUint32(4, true), 0x401);
  assert.equal(view.getUint32(8, true), (-0x100) >>> 0);
  assert.equal(view.getUint32(12, true), 0xffffffff);
});
