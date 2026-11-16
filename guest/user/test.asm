# Silent self-test program used by the kernel's user-mode test.
.org 0x0
_start:
  li a0, 0
  li a7, 2
  ecall
hang:
  j hang
