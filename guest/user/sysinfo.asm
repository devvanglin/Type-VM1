# Prints the virtual clock value and returns 0.
.org 0x0
_start:
  la a0, msg
  li a1, msg_len
  li a7, 1
  ecall
  li a7, 6                  # sys_time
  ecall
  li a7, 3
  ecall
  li a0, 32
  li a7, 4
  ecall
  la a0, unit
  li a1, unit_len
  li a7, 1
  ecall
  li a0, 13
  li a7, 4
  ecall
  li a0, 10
  li a7, 4
  ecall
  li a0, 0
  li a7, 2
  ecall
hang:
  j hang

.data
msg:
  .ascii "virtual clock: "
msg_end:
  .equ msg_len, msg_end - msg
unit:
  .ascii "ticks"
unit_end:
  .equ unit_len, unit_end - unit
