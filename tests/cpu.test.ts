import { test } from "node:test";
import assert from "node:assert/strict";
import { runSnippet } from "./helpers.ts";

function regs(source: string, limit = 200): number[] {
  return runSnippet(source, limit).regs;
}

test("x0 always reads as zero", () => {
  const r = regs(`
.org 0x80000000
li x0, 123
addi zero, zero, 55
add a1, zero, zero
`);
  assert.equal(r[0], 0);
  assert.equal(r[11], 0);
});

test("arithmetic and logic", () => {
  const r = regs(`
.org 0x80000000
li a0, 0x7fffffff
addi a0, a0, 1          # overflow wraps to 0x80000000
li a1, 0xfffffff0
xori a1, a1, 0x0f
li a2, -8
srai a2, a2, 1
li a3, 0x80000000
srli a3, a3, 31
li a4, 5
slli a4, a4, 30
li a5, 100
li a6, 7
slt a7, a5, a6
sltu s0, a5, a6
slti s1, a6, 7
sltiu s2, a6, 7
`);
  assert.equal(r[10], 0x80000000);
  assert.equal(r[11], 0xffffffff);
  assert.equal(r[12], -4 >>> 0);
  assert.equal(r[13], 1);
  assert.equal(r[14], 5 << 30);
  assert.equal(r[17], 0); // 100 < 7 is false
  assert.equal(r[8], 0);
  assert.equal(r[9], 0); // 7 < 7 is false
  assert.equal(r[18], 0);
});

test("M extension edge cases", () => {
  const r = regs(`
.org 0x80000000
li a0, -7
li a1, 2
div a2, a0, a1          # -3
rem a3, a0, a1          # -1
li a4, 0x80000000
li a5, -1
div a6, a4, a5          # overflow -> 0x80000000
rem a7, a4, a5          # 0
li s0, 0
div s1, a0, s0          # divide by zero -> -1
divu s2, a0, s0         # divide by zero -> 0xffffffff
rem s3, a0, s0          # -> dividend
remu s4, a0, s0         # -> dividend
li s5, 0x10000
li s6, 0x10000
mul s7, s5, s6          # 0x100000000 wraps to 0
mulh s8, s5, s6         # high word is 1
mulhu s9, s5, s6
li s10, -1
li s11, -1
mulh t0, s10, s11       # (-1 * -1) >> 32 = 0
mulhsu t1, s10, s11     # -1 * 0xffffffff >> 32 = -1
`);
  assert.equal(r[12], -3 >>> 0);
  assert.equal(r[13], -1 >>> 0);
  assert.equal(r[16], 0x80000000);
  assert.equal(r[17], 0);
  assert.equal(r[9], -1 >>> 0);   // div by zero
  assert.equal(r[18], 0xffffffff); // divu by zero
  assert.equal(r[19], -7 >>> 0);   // rem by zero returns the dividend
  assert.equal(r[20], -7 >>> 0);   // remu by zero returns the dividend
  assert.equal(r[23], 0);          // mul low word wraps
  assert.equal(r[24], 1);          // mulh high word
  assert.equal(r[25], 1);          // mulhu high word
  assert.equal(r[5], 0);           // mulh(-1, -1)
  assert.equal(r[6], 0xffffffff);  // mulhsu(-1, 0xffffffff)
});

test("loads and stores of every width", () => {
  const r = regs(`
.org 0x80000000
la s0, data
lb a0, 0(s0)            # -1
lbu a1, 0(s0)           # 255
lh a2, 2(s0)            # -2
lhu a3, 2(s0)           # 65534
lw a4, 4(s0)            # 0x12345678
sb a1, 8(s0)
sh a3, 10(s0)           # 16-bit store at a 2-byte aligned address
sw a4, 12(s0)
lbu a5, 13(s0)
halt:
j halt
.data
data:
.byte 0xff, 0x00, 0xfe, 0xff
.word 0x12345678
.space 16
`, 60);
  assert.equal(r[10], 0xffffffff);
  assert.equal(r[11], 255);
  assert.equal(r[12], 0xfffffffe);
  assert.equal(r[13], 0xfffe);
  assert.equal(r[14], 0x12345678);
  assert.equal(r[15], 0x56);
});

test("jal/jalr link values and returns", () => {
  const r = runSnippet(`
.org 0x80000000
  la sp, stack
  jal ra, func
after:
  mv s0, ra             # return address of func is 'after'
  j done
func:
  addi sp, sp, -16
  sw ra, 12(sp)
  li a0, 42
  lw ra, 12(sp)
  addi sp, sp, 16
  ret
done:
  j done
.data
.balign 16
.space 64
stack:
`, 60);
  assert.equal(r.regs[8], 0x8000000c); // after (past la sp, jal)
  assert.equal(r.regs[10], 42);
});

test("ecall traps to mtvec and mret returns", () => {
  const r = runSnippet(`
.org 0x80000000
  la t0, handler
  csrw mtvec, t0
  li a7, 7
  ecall
after_ecall:
  j after_ecall
handler:
  csrr a0, mcause
  csrr a1, mepc
  addi a1, a1, 4
  csrw mepc, a1
  mret
`, 40);
  assert.equal(r.regs[10], 11); // ecall from M-mode is cause 11
  assert.equal(r.regs[11], 0x80000014); // mepc of the ecall
});

test("illegal instructions and access faults raise the right cause", () => {
  const illegal = runSnippet(`
.org 0x80000000
  la t0, handler
  csrw mtvec, t0
  .word 0xffffffff
handler:
  csrr a0, mcause
  csrr a1, mtval
  j handler
`, 20);
  assert.equal(illegal.regs[10], 2);
  assert.equal(illegal.regs[11], 0xffffffff);

  const access = runSnippet(`
.org 0x80000000
  la t0, handler
  csrw mtvec, t0
  li t1, 0x00001000
  lw a0, 0(t1)
handler:
  csrr a1, mcause
  csrr a2, mtval
  j handler
`, 20);
  assert.equal(access.regs[11], 5); // load access fault
  assert.equal(access.regs[12], 0x1000);
});

test("mstatus stacking and privilege changes through mret", () => {
  const r = runSnippet(`
.org 0x80000000
  la t0, handler
  csrw mtvec, t0
  la t0, user_entry
  csrw mepc, t0
  li t0, 0x80           # MPIE = 1, MPP = 0 (user)
  csrw mstatus, t0
  la t1, user_entry
  mret
user_entry:
  ecall                 # ecall from user mode -> cause 8
  j user_entry
handler:
  csrr a0, mcause
  csrr a1, mstatus
  j handler
`, 40, undefined);
  assert.equal(r.regs[10], 8);
  // After entering the trap from U-mode the previous privilege is recorded in MPP.
  assert.equal((r.regs[11] >>> 11) & 3, 0);
});

test("csr read/write, set and clear forms", () => {
  const r = runSnippet(`
.org 0x80000000
  li t0, 0x1234
  csrw mscratch, t0
  csrr a0, mscratch
  li t1, 0x00ff
  csrs mscratch, t1
  csrr a1, mscratch
  csrc mscratch, t1
  csrr a2, mscratch
  csrrw a3, mscratch, zero
  csrr a4, mscratch
`, 40);
  assert.equal(r.regs[10], 0x1234);
  assert.equal(r.regs[11], 0x12ff);
  assert.equal(r.regs[12], 0x1200);
  assert.equal(r.regs[13], 0x1200); // old value returned
  assert.equal(r.regs[14], 0);
});

test("branch conditions", () => {
  const r = runSnippet(`
.org 0x80000000
  li s0, 0
  li a0, 5
  li a1, -5
  beq a0, a0, t1
  j fail
t1: addi s0, s0, 1
  bne a0, a1, t2
  j fail
t2: addi s0, s0, 1
  blt a1, a0, t3
  j fail
t3: addi s0, s0, 1
  bge a0, a1, t4
  j fail
t4: addi s0, s0, 1
  bgeu a0, a1, fail     # 5 >= 0xfffffffb unsigned is false
  addi s0, s0, 1
  bltu a0, a1, t5       # 5 < 0xfffffffb unsigned is true
  j fail
t5: addi s0, s0, 1
  bltu a1, a0, fail     # 0xfffffffb < 5 unsigned is false
  addi s0, s0, 1
  ble a1, a0, t6        # signed -5 <= 5
  j fail
t6: addi s0, s0, 1
  bgt a0, a1, t7        # signed 5 > -5
  j fail
t7: addi s0, s0, 1
  bleu a1, a0, fail     # 0xfffffffb <= 5 unsigned is false
  addi s0, s0, 1
  j done
fail:
  li s0, 0xdead
done:
  j done
`, 200);
  assert.equal(r.regs[8], 10);
});
