# ---------------------------------------------------------------------------
# Kernel self test
# ---------------------------------------------------------------------------

# a0 = test name
test_ok:
  addi sp, sp, -16
  sw ra, 12(sp)
  sw s0, 8(sp)
  mv s0, a0
  PRINT_STR test_ok_prefix
  mv a0, s0
  call puts
  NEWLINE
  la t0, test_passed
  lw t1, 0(t0)
  addi t1, t1, 1
  sw t1, 0(t0)
  lw s0, 8(sp)
  lw ra, 12(sp)
  addi sp, sp, 16
  ret

# a0 = test name
test_fail:
  addi sp, sp, -16
  sw ra, 12(sp)
  sw s0, 8(sp)
  mv s0, a0
  PRINT_STR test_fail_prefix
  mv a0, s0
  call puts
  NEWLINE
  la t0, test_failed
  lw t1, 0(t0)
  addi t1, t1, 1
  sw t1, 0(t0)
  lw s0, 8(sp)
  lw ra, 12(sp)
  addi sp, sp, 16
  ret

run_selftests:
  addi sp, sp, -16
  sw ra, 12(sp)
  PRINT_STR msg_test_header
  la t0, test_passed
  sw zero, 0(t0)
  la t0, test_failed
  sw zero, 0(t0)

  # RAM
  li t0, 0x80080000
  li t1, 0x5a5a5a5a
  sw t1, 0(t0)
  lw t2, 0(t0)
  bne t1, t2, selftest_mem_fail
  la a0, test_name_mem
  call test_ok
  j selftest_uart
selftest_mem_fail:
  la a0, test_name_mem
  call test_fail

selftest_uart:
  li t0, UART_BASE
  lbu t1, UART_LSR(t0)
  andi t1, t1, LSR_THRE
  beqz t1, selftest_uart_fail
  la a0, test_name_uart
  call test_ok
  j selftest_timer
selftest_uart_fail:
  la a0, test_name_uart
  call test_fail

selftest_timer:
  li t0, CLINT_MTIME
  lw s0, 0(t0)
  li t1, 0
selftest_timer_loop:
  addi t1, t1, 1
  li t2, 20000
  blt t1, t2, selftest_timer_loop
  lw s1, 0(t0)
  bltu s0, s1, selftest_timer_ok
  la a0, test_name_timer
  call test_fail
  j selftest_disk
selftest_timer_ok:
  la a0, test_name_timer
  call test_ok

selftest_disk:
  li t0, VIRTIO_BASE
  lw t1, VIRTIO_MAGIC(t0)
  li t2, VIRTIO_MAGIC_VAL
  bne t1, t2, selftest_disk_fail
  lw t1, VIRTIO_VERSION(t0)
  li t2, 2
  bne t1, t2, selftest_disk_fail
  lw t1, VIRTIO_DEVICE(t0)
  li t2, 2
  bne t1, t2, selftest_disk_fail
  la a0, test_name_disk
  call test_ok
  j selftest_fs
selftest_disk_fail:
  la a0, test_name_disk
  call test_fail

selftest_fs:
  la t0, fs_ok
  lw t1, 0(t0)
  beqz t1, selftest_fs_fail
  la t0, fs_count
  lw t1, 0(t0)
  beqz t1, selftest_fs_fail
  la a0, test_name_fs
  call test_ok
  j selftest_user
selftest_fs_fail:
  la a0, test_name_fs
  call test_fail

selftest_user:
  la a0, test_prog_name
  call fs_find
  beqz a0, selftest_user_fail
  la a0, test_prog_name
  call run_program
  la t0, user_exit_code
  lw t1, 0(t0)
  bnez t1, selftest_user_fail
  la a0, test_name_user
  call test_ok
  j selftest_summary
selftest_user_fail:
  la a0, test_name_user
  call test_fail

selftest_summary:
  PRINT_STR msg_test_summary
  la t0, test_passed
  lw a0, 0(t0)
  call putdec
  PRINT_STR msg_test_passed
  la t0, test_failed
  lw a0, 0(t0)
  call putdec
  PRINT_STR msg_test_failed
  lw ra, 12(sp)
  addi sp, sp, 16
  ret
