# ---------------------------------------------------------------------------
# User mode, system calls and program loading
# ---------------------------------------------------------------------------

# a0 = entry point; returns the exit code when the program finishes.
run_user:
  la t0, kern_ctx
  sw ra, 0(t0)
  sw sp, 4(t0)
  sw s0, 8(t0)
  sw s1, 12(t0)
  sw s2, 16(t0)
  sw s3, 20(t0)
  sw s4, 24(t0)
  sw s5, 28(t0)
  sw s6, 32(t0)
  sw s7, 36(t0)
  sw s8, 40(t0)
  sw s9, 44(t0)
  sw s10, 48(t0)
  sw s11, 52(t0)
  sw gp, 56(t0)
  sw tp, 60(t0)

  la t0, user_active
  li t1, 1
  sw t1, 0(t0)
  la t0, user_exit_code
  sw zero, 0(t0)

  csrw mepc, a0
  li t0, 0x80            # MPIE = 1, MPP = 0 (user), MIE = 0
  csrw mstatus, t0
  li sp, USER_STACK_TOP
  mret

# Return to the kernel context that launched the program.
# a0 = exit code.
user_abort:
  # The trap frame is abandoned: point mscratch back at a clean trap stack.
  la t0, trap_stack_top
  csrw mscratch, t0
  la t0, user_active
  sw zero, 0(t0)
  la t0, user_exit_code
  sw a0, 0(t0)
  la t0, kern_ctx
  lw sp, 4(t0)
  lw s1, 12(t0)
  lw s2, 16(t0)
  lw s3, 20(t0)
  lw s4, 24(t0)
  lw s5, 28(t0)
  lw s6, 32(t0)
  lw s7, 36(t0)
  lw s8, 40(t0)
  lw s9, 44(t0)
  lw s10, 48(t0)
  lw s11, 52(t0)
  lw gp, 56(t0)
  lw tp, 60(t0)
  lw ra, 0(t0)
  lw s0, 8(t0)
  ret

# a0 = trap frame; returns with mepc advanced past the ecall.
syscall_u:
  mv s1, a0
  lw t0, 68(s1)              # a7 = syscall number
  li t1, 1
  beq t0, t1, sys_write
  li t1, 2
  beq t0, t1, sys_exit
  li t1, 3
  beq t0, t1, sys_putnum
  li t1, 4
  beq t0, t1, sys_putchar
  li t1, 5
  beq t0, t1, sys_getchar
  li t1, 6
  beq t0, t1, sys_time
  li t0, -1
  sw t0, 40(s1)
  j sys_return

sys_write:
  lw t2, 40(s1)              # a0 = buffer
  lw t3, 44(s1)              # a1 = length
  li t4, USER_BASE
  bltu t2, t4, sys_write_denied
  add t5, t2, t3
  li t4, USER_LIMIT
  bgtu t5, t4, sys_write_denied
  mv t6, t3
sys_write_loop:
  beqz t6, sys_write_done
  lbu a0, 0(t2)
  EMIT_CHAR
  addi t2, t2, 1
  addi t6, t6, -1
  j sys_write_loop
sys_write_done:
  sw t3, 40(s1)
  j sys_return
sys_write_denied:
  li t0, -1
  sw t0, 40(s1)
  j sys_return

sys_exit:
  lw a0, 40(s1)
  j user_abort

sys_putnum:
  lw a0, 40(s1)
  lw a1, 44(s1)
  li t0, 16
  beq a1, t0, sys_putnum_hex
  call putdec
  j sys_return_zero
sys_putnum_hex:
  call puthex
  j sys_return_zero

sys_putchar:
  lw a0, 40(s1)
  EMIT_CHAR
  j sys_return_zero

sys_getchar:
  call uart_getc_nb
  sw a0, 40(s1)
  j sys_return

sys_time:
  li t0, CLINT_MTIME
  lw a0, 0(t0)
  sw a0, 40(s1)
  j sys_return

sys_return_zero:
  sw zero, 40(s1)
sys_return:
  lw t0, TF_EPC(s1)
  addi t0, t0, 4
  sw t0, TF_EPC(s1)
  lw ra, TF_RET(s1)          # helpers clobber ra: restore the trap-handler continuation
  ret

# a0 = file name; loads the TVX program and runs it.
run_program:
  addi sp, sp, -32
  sw ra, 28(sp)
  sw s0, 24(sp)
  sw s1, 20(sp)
  sw s2, 16(sp)
  mv s0, a0

  # Append ".TVX" when the user typed a bare program name.
  mv t0, s0
rp_name_scan:
  lbu t1, 0(t0)
  beqz t1, rp_name_ext
  li t2, 46
  beq t1, t2, rp_name_ready
  addi t0, t0, 1
  j rp_name_scan
rp_name_ext:
  la t2, scratch_buf
  mv t3, s0
rp_name_copy:
  lbu t1, 0(t3)
  sb t1, 0(t2)
  beqz t1, rp_name_append
  addi t3, t3, 1
  addi t2, t2, 1
  j rp_name_copy
rp_name_append:
  li t1, 46
  sb t1, 0(t2)
  addi t2, t2, 1
  li t1, 84
  sb t1, 0(t2)
  addi t2, t2, 1
  li t1, 86
  sb t1, 0(t2)
  addi t2, t2, 1
  li t1, 88
  sb t1, 0(t2)
  addi t2, t2, 1
  sb zero, 0(t2)
  la s0, scratch_buf
rp_name_ready:
  mv a0, s0
  call fs_find
  beqz a0, run_program_not_found
  mv s0, a0
  lw s1, 32(s0)                    # file size
  li t0, USER_MAX_SIZE
  bltu t0, s1, run_program_too_big
  li t0, 20
  bltu s1, t0, run_program_bad

  # Read and validate the 16-byte header.
  mv a0, s0
  la a1, scratch_buf
  li a2, 16
  li a3, 0
  call fs_read_part
  li t0, 16
  bne a0, t0, run_program_bad
  la t0, scratch_buf
  lw t1, 0(t0)
  li t2, TVX_MAGIC
  bne t1, t2, run_program_bad
  lw s2, 4(t0)                     # entry offset
  lw t2, 8(t0)                     # payload size
  addi t3, t2, 16
  bne t3, s1, run_program_bad
  li t3, USER_MAX_SIZE
  bltu t3, t2, run_program_too_big

  # Load the payload at USER_BASE.
  mv a0, s0
  li a1, USER_BASE
  mv a2, t2
  li a3, 16
  call fs_read_part
  bltu a0, t2, run_program_bad

  PRINT_STR msg_exec
  li a0, USER_BASE
  add a0, a0, s2
  call run_user
  mv s1, a0
  la t0, user_exit_code
  lw s1, 0(t0)
  PRINT_STR msg_exit
  mv a0, s1
  call putdec
  NEWLINE
  li a0, 0
  j run_program_ret

run_program_not_found:
  PRINT_STR msg_no_program
  mv a0, s0
  call puts
  NEWLINE
  li a0, -1
  j run_program_ret
run_program_bad:
  PRINT_STR msg_bad_program
  li a0, -2
  j run_program_ret
run_program_too_big:
  PRINT_STR msg_program_too_big
  li a0, -3
run_program_ret:
  lw s2, 16(sp)
  lw s1, 20(sp)
  lw s0, 24(sp)
  lw ra, 28(sp)
  addi sp, sp, 32
  ret
