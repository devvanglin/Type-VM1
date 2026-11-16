# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

.org 0x80000000

.section .text
.global _start
_start:
  # Kernel stack and trap stack are set up before any C-like code runs.
  la sp, kernel_stack_top
  la t0, trap_stack_top
  csrw mscratch, t0
  la t0, trap_entry
  csrw mtvec, t0

  # Zero the BSS (the emulator starts with zeroed RAM, but be explicit).
  la t0, __bss_start
  la t1, __bss_end
bss_check:
  bgeu t0, t1, bss_done
  sw zero, 0(t0)
  addi t0, t0, 4
  j bss_check
bss_done:

  call kmain

  # kmain should never return; if it does, power the machine off.
  li t0, SYS_BASE
  li t1, 1
  sw t1, SYS_EXIT_CODE(t0)
  li t1, SYS_POWEROFF
  sw t1, SYS_CTRL(t0)
halt_loop:
  j halt_loop
