# Prints the first 12 Fibonacci numbers through the sys_putnum syscall.
.org 0x0
_start:
  li s0, 1
  li s1, 1
  li s2, 12
fib_loop:
  mv a0, s0
  li a1, 10
  li a7, 3                  # sys_putnum(value, base)
  ecall
  li a0, 32
  li a7, 4                  # sys_putchar(' ')
  ecall
  add s3, s0, s1
  mv s0, s1
  mv s1, s3
  addi s2, s2, -1
  bnez s2, fib_loop
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
