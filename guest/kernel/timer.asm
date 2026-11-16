# ---------------------------------------------------------------------------
# CLINT timer and PLIC external interrupt handling
# ---------------------------------------------------------------------------

timer_init:
  li t0, CLINT_MTIMECMP
  li t1, CLINT_MTIME
  lw t2, 0(t1)
  li t3, TICK_INTERVAL
  add t2, t2, t3
  sw t2, 0(t0)
  sw zero, 4(t0)
  # Enable machine timer and external interrupts.
  li t1, 0x880
  csrs mie, t1
  ret

# Called from the trap handler (machine mode, interrupts disabled).
timer_irq:
  la t0, tick_count
  lw t1, 0(t0)
  addi t1, t1, 1
  sw t1, 0(t0)

  li t0, CLINT_MTIMECMP
  la t1, sleeping
  lw t2, 0(t1)
  bnez t2, timer_sleep_check

  li t3, CLINT_MTIME
  lw t2, 0(t3)
  li t4, TICK_INTERVAL
  add t2, t2, t4
  sw t2, 0(t0)
  ret

timer_sleep_check:
  li t3, CLINT_MTIME
  lw t4, 0(t3)
  la t5, sleep_target
  lw t6, 0(t5)
  bltu t4, t6, timer_sleep_again
  # The sleep deadline has been reached.
  sw zero, 0(t1)
  li t2, TICK_INTERVAL
  add t2, t4, t2
  sw t2, 0(t0)
  ret

timer_sleep_again:
  sw t6, 0(t0)
  ret

# a0 = milliseconds; returns when the virtual clock has advanced that far.
sleep_ms:
  beqz a0, sleep_ms_done
  addi sp, sp, -16
  sw ra, 12(sp)
  li t0, 1000
  mul t1, a0, t0
  li t0, CLINT_MTIME
  lw t2, 0(t0)
  add t2, t2, t1
  la t0, sleep_target
  sw t2, 0(t0)
  la t0, sleeping
  li t1, 1
  sw t1, 0(t0)
  li t0, CLINT_MTIMECMP
  sw t2, 0(t0)
  sw zero, 4(t0)
  csrsi mstatus, 8
sleep_ms_loop:
  wfi
  la t0, sleeping
  lw t1, 0(t0)
  bnez t1, sleep_ms_loop
  csrci mstatus, 8
  lw ra, 12(sp)
  addi sp, sp, 16
sleep_ms_done:
  ret

# PLIC interrupt: claim, handle, complete.
external_irq:
  addi sp, sp, -16
  sw ra, 12(sp)
  li t0, PLIC_CLAIM
  lw s0, 0(t0)
  beqz s0, external_irq_done
  li t1, IRQ_VIRTIO
  bne s0, t1, external_irq_complete
  # Acknowledge the virtio used-ring interrupt.
  li t2, VIRTIO_BASE
  lw t3, VIRTIO_ISTATUS(t2)
  sw t3, VIRTIO_IACK(t2)
external_irq_complete:
  li t0, PLIC_CLAIM
  sw s0, 0(t0)
  la t0, ext_irq_count
  lw t1, 0(t0)
  addi t1, t1, 1
  sw t1, 0(t0)
external_irq_done:
  lw ra, 12(sp)
  addi sp, sp, 16
  ret

# Print "up S.mmm s" from the virtual clock.
print_uptime:
  addi sp, sp, -16
  sw ra, 12(sp)
  li t0, CLINT_MTIME
  lw t1, 0(t0)
  li t2, 1000000
  divu s0, t1, t2
  remu t1, t1, t2
  li t2, 1000
  divu s1, t1, t2
  PRINT_STR msg_uptime
  mv a0, s0
  call putdec
  li a0, 46
  EMIT_CHAR
  mv a0, s1
  call put3
  PRINT_STR msg_seconds
  NEWLINE
  lw ra, 12(sp)
  addi sp, sp, 16
  ret
