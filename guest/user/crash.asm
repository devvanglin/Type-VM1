# Deliberately triggers a store access fault to demonstrate trap handling.
.org 0x0
_start:
  la a0, crash_msg
  li a1, crash_len
  li a7, 1
  ecall
  li t0, 0
  sw t0, 0(t0)              # address 0 is not mapped: store access fault
  li a0, 0
  li a7, 2
  ecall
hang:
  j hang

.data
crash_msg:
  .ascii "about to write to address 0 ..."
crash_end:
  .equ crash_len, crash_end - crash_msg
