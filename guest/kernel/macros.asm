# ---------------------------------------------------------------------------
# Inline helpers
# ---------------------------------------------------------------------------

# Wait until the UART transmit holding register is empty.
# Clobbers: t0, t1
.macro WAIT_THRE
  li t0, UART_BASE
wait_thre_\@:
  lbu t1, UART_LSR(t0)
  andi t1, t1, LSR_THRE
  beqz t1, wait_thre_\@
.endm

# Send the byte in a0.  Clobbers: t0, t1
.macro EMIT_CHAR
  WAIT_THRE
  li t0, UART_BASE
  sb a0, UART_THR(t0)
.endm

# Print a NUL-terminated string located at label \sym.
# Clobbers: a0, t0, t1, t2
.macro PRINT_STR sym
  la a0, \sym
  call puts
.endm

# Print a decimal number from register \reg.
# Clobbers: a0, t0, t1, t3
.macro PRINT_DEC reg
  mv a0, \reg
  call putdec
.endm

# Emit CR LF.
.macro NEWLINE
  call putnl
.endm

# Report a fatal error string and stop the machine.
.macro PANIC msg
  la a0, \msg
  call puts
  call panic_halt
.endm
