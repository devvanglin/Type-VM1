# ---------------------------------------------------------------------------
# 16550 UART console driver
# ---------------------------------------------------------------------------

uart_init:
  li t0, UART_BASE
  li t1, 0x03          # 8 data bits, no parity, 1 stop bit
  sb t1, UART_LCR(t0)
  li t1, 0x07          # enable and clear FIFOs
  sb t1, UART_FCR(t0)
  li t1, 0x00          # polled mode: no UART interrupts
  sb t1, UART_IER(t0)
  ret

# a0 = byte
putc:
  EMIT_CHAR
  ret

# a0 = NUL-terminated string
puts:
  mv t2, a0
puts_loop:
  lbu a0, 0(t2)
  beqz a0, puts_done
  EMIT_CHAR
  addi t2, t2, 1
  j puts_loop
puts_done:
  ret

putnl:
  li a0, 13
  EMIT_CHAR
  li a0, 10
  EMIT_CHAR
  ret

# Wait for and return the next byte in a0.
#
# While the receive queue is empty the hart executes WFI, so the virtual CPU
# idles until the next timer tick instead of spinning.  On real hardware this
# is exactly what an idle loop does; here it also keeps the host cool.
uart_getc:
  li t0, UART_BASE
uart_getc_wait:
  lbu t1, UART_LSR(t0)
  andi t1, t1, LSR_DR
  bnez t1, uart_getc_data
  wfi
  j uart_getc_wait
uart_getc_data:
  lbu a0, UART_RBR(t0)
  ret

# Non-blocking read: a0 = byte or -1 when nothing is queued.
uart_getc_nb:
  li t0, UART_BASE
  lbu t1, UART_LSR(t0)
  andi t1, t1, LSR_DR
  beqz t1, uart_empty
  lbu a0, UART_RBR(t0)
  ret
uart_empty:
  li a0, -1
  ret

# Non-blocking check: a0 = 1 if a byte is waiting, else 0.
uart_ready:
  li t0, UART_BASE
  lbu t1, UART_LSR(t0)
  andi a0, t1, LSR_DR
  snez a0, a0
  ret
