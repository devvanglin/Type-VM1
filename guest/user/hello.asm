# Hello world in user mode.  Uses the write() and exit() system calls.
.org 0x0
_start:
  la a0, hello_msg
  li a1, hello_len
  li a7, 1                  # sys_write
  ecall

  li a0, 10                 # newline
  li a7, 4                  # sys_putchar
  ecall

  li a0, 0
  li a7, 2                  # sys_exit(0)
  ecall
hang:
  j hang

.data
hello_msg:
  .ascii "Hello from user mode!  (U-mode, ecall system calls)"
hello_end:
  .equ hello_len, hello_end - hello_msg
