# ---------------------------------------------------------------------------
# Trap entry, dispatch and panic reporting
# ---------------------------------------------------------------------------
#
# Layout of the 144-byte trap frame (x0 is not saved):
#   offset 4*n  register xn
#   offset 128  mepc
#   offset 132  mstatus
#   offset 136  mcause
#   offset 140  scratch (interrupted mode)
#
.equ TF_RET,    0     # also the (unused) x0 slot: trap-handler return address
.equ TF_EPC,    128
.equ TF_STATUS, 132
.equ TF_CAUSE,  136
.equ TF_MODE,   140
.equ TF_SIZE,   144

.section .text
.global trap_entry
trap_entry:
  # Switch to the dedicated trap stack; the interrupted sp goes to mscratch.
  csrrw sp, mscratch, sp
  addi sp, sp, -TF_SIZE
  sw x1, 4(sp)
  sw x3, 12(sp)
  sw x4, 16(sp)
  sw x5, 20(sp)
  sw x6, 24(sp)
  sw x7, 28(sp)
  sw x8, 32(sp)
  sw x9, 36(sp)
  sw x10, 40(sp)
  sw x11, 44(sp)
  sw x12, 48(sp)
  sw x13, 52(sp)
  sw x14, 56(sp)
  sw x15, 60(sp)
  sw x16, 64(sp)
  sw x17, 68(sp)
  sw x18, 72(sp)
  sw x19, 76(sp)
  sw x20, 80(sp)
  sw x21, 84(sp)
  sw x22, 88(sp)
  sw x23, 92(sp)
  sw x24, 96(sp)
  sw x25, 100(sp)
  sw x26, 104(sp)
  sw x27, 108(sp)
  sw x28, 112(sp)
  sw x29, 116(sp)
  sw x30, 120(sp)
  sw x31, 124(sp)
  csrr t0, mscratch
  sw t0, 8(sp)               # interrupted sp
  csrr t0, mepc
  sw t0, TF_EPC(sp)
  csrr t0, mstatus
  sw t0, TF_STATUS(sp)
  csrr t0, mcause
  sw t0, TF_CAUSE(sp)

  la t0, trap_return
  sw t0, TF_RET(sp)
  mv a0, sp
  call trap_handler
trap_return:

  # Return to the interrupted context.
  lw t0, TF_EPC(sp)
  csrw mepc, t0
  lw t0, TF_STATUS(sp)
  csrw mstatus, t0
  addi t0, sp, TF_SIZE
  csrw mscratch, t0
  lw x1, 4(sp)
  lw x3, 12(sp)
  lw x4, 16(sp)
  lw x5, 20(sp)
  lw x6, 24(sp)
  lw x7, 28(sp)
  lw x8, 32(sp)
  lw x9, 36(sp)
  lw x10, 40(sp)
  lw x11, 44(sp)
  lw x12, 48(sp)
  lw x13, 52(sp)
  lw x14, 56(sp)
  lw x15, 60(sp)
  lw x16, 64(sp)
  lw x17, 68(sp)
  lw x18, 72(sp)
  lw x19, 76(sp)
  lw x20, 80(sp)
  lw x21, 84(sp)
  lw x22, 88(sp)
  lw x23, 92(sp)
  lw x24, 96(sp)
  lw x25, 100(sp)
  lw x26, 104(sp)
  lw x27, 108(sp)
  lw x28, 112(sp)
  lw x29, 116(sp)
  lw x30, 120(sp)
  lw x31, 124(sp)
  lw x2, 8(sp)               # interrupted sp (must be last)
  mret

# a0 = frame pointer
trap_handler:
  lw t0, TF_CAUSE(a0)
  bltz t0, trap_interrupt
  li t1, 8
  beq t0, t1, trap_syscall
  li t1, 2
  beq t0, t1, trap_illegal
  li t1, 5
  beq t0, t1, trap_load_fault
  li t1, 7
  beq t0, t1, trap_store_fault
  li t1, 1
  beq t0, t1, trap_instr_fault
  li t1, 3
  beq t0, t1, trap_breakpoint
  li t1, 11
  beq t0, t1, trap_syscall_kernel
  j trap_unexpected

trap_interrupt:
  slli t0, t0, 1
  srli t0, t0, 1
  li t1, 7
  beq t0, t1, trap_timer
  li t1, 11
  beq t0, t1, trap_external
  li t1, 3
  beq t0, t1, trap_breakpoint
  j trap_unexpected

trap_timer:
  j timer_irq

trap_external:
  j external_irq

trap_syscall:
  j syscall_u

trap_syscall_kernel:
  li t0, 11
  j trap_fault_common

trap_illegal:
  li t0, 2
  j trap_fault_common

trap_load_fault:
  li t0, 5
  j trap_fault_common

trap_store_fault:
  li t0, 7
  j trap_fault_common

trap_instr_fault:
  li t0, 1
  j trap_fault_common

trap_breakpoint:
  li t0, 3
  j trap_fault_common

# t0 = cause; kills the running user program, or panics in kernel mode.
trap_fault_common:
  mv s1, a0                  # frame
  mv s2, t0                  # cause
  # Determine the interrupted privilege from mstatus.MPP (kept in the frame).
  lw t0, TF_STATUS(s1)
  srli t0, t0, 11
  andi t0, t0, 3
  beqz t0, trap_fault_user
  j trap_panic

trap_fault_user:
  la t0, user_active
  lw t1, 0(t0)
  beqz t1, trap_panic
  PRINT_STR msg_user_fault
  mv a0, s2
  call putdec
  PRINT_STR msg_at
  lw a0, TF_EPC(s1)
  call puthex
  NEWLINE
  # Kill the program: return to the kernel context that launched it.
  li a0, -1
  j user_abort

trap_panic:
  PRINT_STR msg_panic_prefix
  lw a0, TF_CAUSE(s1)
  call puthex
  PRINT_STR msg_panic_epc
  lw a0, TF_EPC(s1)
  call puthex
  PRINT_STR msg_panic_tval
  csrr a0, mtval
  call puthex
  NEWLINE
  j panic_halt

trap_unexpected:
  PRINT_STR msg_panic_prefix
  PRINT_STR msg_unexpected
  NEWLINE
  j panic_halt

panic_halt:
  li t0, SYS_BASE
  li t1, 1
  sw t1, SYS_EXIT_CODE(t0)
  li t1, SYS_POWEROFF
  sw t1, SYS_CTRL(t0)
panic_spin:
  j panic_spin
