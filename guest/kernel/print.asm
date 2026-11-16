# ---------------------------------------------------------------------------
# Formatted output helpers
# ---------------------------------------------------------------------------

# a0 = value -> eight lowercase hex digits
puthex32:
  mv t3, a0
  li t4, 8
  li t5, 28
puthex32_loop:
  srl a0, t3, t5
  andi a0, a0, 0x0f
  li t0, 10
  blt a0, t0, puthex32_digit
  addi a0, a0, 39       # ('a' - '0') - 10
puthex32_digit:
  addi a0, a0, 48       # '0'
  EMIT_CHAR
  addi t5, t5, -4
  bgez t5, puthex32_loop
  ret

# a0 = value -> "0x" followed by eight hex digits
puthex:
  addi sp, sp, -16
  sw ra, 12(sp)
  sw t6, 8(sp)
  mv t6, a0
  li a0, 48
  EMIT_CHAR
  li a0, 120
  EMIT_CHAR
  mv a0, t6
  call puthex32
  lw ra, 12(sp)
  lw t6, 8(sp)
  addi sp, sp, 16
  ret

# a0 = value -> unsigned decimal
putdec:
  addi sp, sp, -32
  addi t3, sp, 0
  li t4, 10
  mv t5, a0
  beqz t5, putdec_zero
putdec_loop:
  remu t6, t5, t4
  divu t5, t5, t4
  addi t6, t6, 48
  sb t6, 0(t3)
  addi t3, t3, 1
  bnez t5, putdec_loop
putdec_emit:
  addi t3, t3, -1
  lbu a0, 0(t3)
  EMIT_CHAR
  bne t3, sp, putdec_emit
  addi sp, sp, 32
  ret
putdec_zero:
  li a0, 48
  EMIT_CHAR
  addi sp, sp, 32
  ret

# a0 = value (0..99) -> two zero-padded digits
put2:
  addi sp, sp, -16
  sw ra, 12(sp)
  sw s0, 8(sp)
  mv s0, a0
  li t0, 10
  divu a0, s0, t0
  call putdec
  li t0, 10
  remu a0, s0, t0
  call putdec
  lw s0, 8(sp)
  lw ra, 12(sp)
  addi sp, sp, 16
  ret

# a0 = value (0..999) -> three zero-padded digits
put3:
  addi sp, sp, -16
  sw ra, 12(sp)
  sw s0, 8(sp)
  mv s0, a0
  li t0, 100
  divu a0, s0, t0
  call putdec
  li t0, 100
  remu s0, s0, t0
  li t0, 10
  divu a0, s0, t0
  call putdec
  li t0, 10
  remu a0, s0, t0
  call putdec
  lw s0, 8(sp)
  lw ra, 12(sp)
  addi sp, sp, 16
  ret

# a0 = value (0..9999) -> four zero-padded digits
put4:
  addi sp, sp, -16
  sw ra, 12(sp)
  sw s0, 8(sp)
  mv s0, a0
  li t0, 1000
  divu a0, s0, t0
  call putdec
  li t0, 1000
  remu s0, s0, t0
  li t0, 100
  divu a0, s0, t0
  call putdec
  li t0, 100
  remu s0, s0, t0
  li t0, 10
  divu a0, s0, t0
  call putdec
  li t0, 10
  remu a0, s0, t0
  call putdec
  lw s0, 8(sp)
  lw ra, 12(sp)
  addi sp, sp, 16
  ret

# a0 = string; prints it inside square brackets
puts_bracket:
  addi sp, sp, -16
  sw ra, 12(sp)
  sw s0, 8(sp)
  mv s0, a0
  li a0, 91
  EMIT_CHAR
  mv a0, s0
  call puts
  li a0, 93
  EMIT_CHAR
  lw s0, 8(sp)
  lw ra, 12(sp)
  addi sp, sp, 16
  ret

# a0 = byte -> two lowercase hex digits
puthex2:
  addi sp, sp, -16
  sw ra, 12(sp)
  mv t3, a0
  srli a0, t3, 4
  call puthex_nibble
  andi a0, t3, 0x0f
  call puthex_nibble
  lw ra, 12(sp)
  addi sp, sp, 16
  ret

# a0 = 0..15
puthex_nibble:
  li t0, 10
  blt a0, t0, puthex_nibble_digit
  addi a0, a0, 39
puthex_nibble_digit:
  addi a0, a0, 48
  EMIT_CHAR
  ret
