# ---------------------------------------------------------------------------
# Kernel main, command shell, line editor and commands
# ---------------------------------------------------------------------------

kmain:
  call uart_init
  PRINT_STR banner_0
  PRINT_STR banner_1
  PRINT_STR banner_2
  PRINT_STR banner_3
  call virtio_init
  call fs_mount
  call print_boot_info
  call timer_init
  PRINT_STR msg_ready
  j shell_loop

print_boot_info:
  addi sp, sp, -16
  sw ra, 12(sp)
  PRINT_STR msg_cpu
  PRINT_STR msg_mem
  PRINT_STR msg_dev_uart
  PRINT_STR msg_dev_timer
  PRINT_STR msg_dev_plic
  PRINT_STR msg_dev_disk
  PRINT_STR msg_dev_rtc
  PRINT_STR msg_dev_sys
  la t0, virtio_ok
  lw t0, 0(t0)
  beqz t0, boot_info_no_disk
  PRINT_STR msg_disk_ok
  la t0, disk_sectors
  lw a0, 0(t0)
  call putdec
  PRINT_STR msg_sectors
  j boot_info_fs
boot_info_no_disk:
  PRINT_STR msg_disk_bad
boot_info_fs:
  la t0, fs_ok
  lw t0, 0(t0)
  beqz t0, boot_info_no_fs
  PRINT_STR msg_fs_ok
  la t0, fs_count
  lw a0, 0(t0)
  call putdec
  PRINT_STR msg_files
  j boot_info_done
boot_info_no_fs:
  PRINT_STR msg_fs_bad
boot_info_done:
  lw ra, 12(sp)
  addi sp, sp, 16
  ret

shell_loop:
  PRINT_STR msg_prompt
  la a0, line_buf
  li a1, 200
  call read_line
  la a0, line_buf
  call tokenize
  beqz a0, shell_loop
  la t0, arg_buf
  lw a0, 0(t0)
  call dispatch
  j shell_loop

# a0 = buffer, a1 = capacity -> a0 = length
read_line:
  addi sp, sp, -32
  sw ra, 28(sp)
  sw s0, 24(sp)
  sw s1, 20(sp)
  sw s2, 16(sp)
  mv s0, a0
  mv s1, a1
  li s2, 0
read_line_key:
  call uart_getc
  li t0, 13
  beq a0, t0, read_line_done
  li t0, 10
  beq a0, t0, read_line_done
  li t0, 127
  beq a0, t0, read_line_back
  li t0, 8
  beq a0, t0, read_line_back
  li t0, 3
  beq a0, t0, read_line_cancel
  li t0, 21
  beq a0, t0, read_line_kill
  li t0, 27
  beq a0, t0, read_line_escape
  li t0, 32
  blt a0, t0, read_line_key
  li t0, 126
  blt t0, a0, read_line_key
  addi t0, s1, -1
  bge s2, t0, read_line_key
  add t0, s0, s2
  sb a0, 0(t0)
  addi s2, s2, 1
  EMIT_CHAR
  j read_line_key
read_line_back:
  beqz s2, read_line_key
  addi s2, s2, -1
  li a0, 8
  EMIT_CHAR
  li a0, 32
  EMIT_CHAR
  li a0, 8
  EMIT_CHAR
  j read_line_key
read_line_kill:
  beqz s2, read_line_key
  addi s2, s2, -1
  li a0, 8
  EMIT_CHAR
  li a0, 32
  EMIT_CHAR
  li a0, 8
  EMIT_CHAR
  j read_line_kill
read_line_escape:
  call uart_getc
  call uart_getc
  j read_line_key
read_line_cancel:
  li a0, 94
  EMIT_CHAR
  li a0, 67
  EMIT_CHAR
  NEWLINE
  li s2, 0
read_line_done:
  add t0, s0, s2
  sb zero, 0(t0)
  NEWLINE
  mv a0, s2
  lw s2, 16(sp)
  lw s1, 20(sp)
  lw s0, 24(sp)
  lw ra, 28(sp)
  addi sp, sp, 32
  ret

# a0 = line -> a0 = number of arguments (at most 4, stored in arg_buf)
tokenize:
  la t1, arg_buf
  li t2, 0
  mv t0, a0
tokenize_skip:
  lbu t3, 0(t0)
  beqz t3, tokenize_done
  li t4, 32
  bne t3, t4, tokenize_start
  sb zero, 0(t0)
  addi t0, t0, 1
  j tokenize_skip
tokenize_start:
  li t4, 8
  bge t2, t4, tokenize_done
  slli t4, t2, 2
  add t4, t4, t1
  sw t0, 0(t4)
  addi t2, t2, 1
tokenize_scan:
  lbu t3, 0(t0)
  beqz t3, tokenize_done
  li t4, 32
  beq t3, t4, tokenize_skip
  addi t0, t0, 1
  j tokenize_scan
tokenize_done:
  mv a0, t2
  ret

.macro TRY name, handler
  mv a0, s0
  la a1, \name
  call strcmp
  beqz a0, \handler
.endm

# a0 = command word
dispatch:
  addi sp, sp, -16
  sw ra, 12(sp)
  sw s0, 8(sp)
  mv s0, a0
  TRY cmd_help, cmd_help_run
  TRY cmd_info, cmd_info_run
  TRY cmd_ls, cmd_ls_run
  TRY cmd_cat, cmd_cat_run
  TRY cmd_hexdump, cmd_hexdump_run
  TRY cmd_run, cmd_run_run
  TRY cmd_echo, cmd_echo_run
  TRY cmd_date, cmd_date_run
  TRY cmd_uptime, cmd_uptime_run
  TRY cmd_sleep, cmd_sleep_run
  TRY cmd_mem, cmd_mem_run
  TRY cmd_disk, cmd_disk_run
  TRY cmd_irq, cmd_irq_run
  TRY cmd_test, cmd_test_run
  TRY cmd_clear, cmd_clear_run
  TRY cmd_reboot, cmd_reboot_run
  TRY cmd_halt, cmd_halt_run
  PRINT_STR msg_unknown_cmd
  mv a0, s0
  call puts
  NEWLINE
  PRINT_STR msg_help_hint
  j dispatch_done

cmd_help_run:
  PRINT_STR help_text
  j dispatch_done

cmd_info_run:
  PRINT_STR msg_info_isa
  csrr a0, misa
  call puthex
  li a0, 41
  EMIT_CHAR
  NEWLINE
  PRINT_STR msg_info_mode
  PRINT_STR msg_info_time
  li t0, CLINT_MTIME
  lw a0, 0(t0)
  call putdec
  PRINT_STR msg_info_ticks
  j dispatch_done

cmd_ls_run:
  call fs_list
  j dispatch_done

cmd_missing:
  PRINT_STR msg_missing_arg
  j dispatch_done

cmd_cat_run:
  la t0, arg_buf
  lw s1, 4(t0)
  beqz s1, cmd_missing
  mv a0, s1
  call fs_cat
  bgez a0, dispatch_done
  addi t0, a0, 1
  beqz t0, cmd_cat_not_found
  PRINT_STR msg_open_failed
  j dispatch_done
cmd_cat_not_found:
  PRINT_STR msg_not_found
  mv a0, s1
  call puts
  NEWLINE
  j dispatch_done

cmd_run_run:
  la t0, arg_buf
  lw a0, 4(t0)
  beqz a0, cmd_missing
  call run_program
  j dispatch_done

cmd_echo_run:
  li s2, 1
echo_loop:
  li t0, 8
  bge s2, t0, echo_done
  slli t0, s2, 2
  la t1, arg_buf
  add t0, t0, t1
  lw s3, 0(t0)
  beqz s3, echo_done
  li t0, 1
  beq s2, t0, echo_nospace
  li a0, 32
  EMIT_CHAR
echo_nospace:
  mv a0, s3
  call puts
  addi s2, s2, 1
  j echo_loop
echo_done:
  NEWLINE
  j dispatch_done

cmd_date_run:
  call print_date
  j dispatch_done

cmd_uptime_run:
  call print_uptime
  j dispatch_done

cmd_sleep_run:
  la t0, arg_buf
  lw s1, 4(t0)
  beqz s1, cmd_missing
  mv a0, s1
  call parse_dec
  mv s2, a0
  call sleep_ms
  PRINT_STR msg_slept
  mv a0, s2
  call putdec
  PRINT_STR msg_ms
  li t0, CLINT_MTIME
  lw a0, 0(t0)
  call putdec
  PRINT_STR msg_ticks
  j dispatch_done

cmd_hexdump_run:
  la t0, arg_buf
  lw s1, 4(t0)
  beqz s1, cmd_missing
  lw s2, 8(t0)
  li s3, 128
  beqz s2, hexdump_count
  mv a0, s2
  call parse_dec
  mv s3, a0
hexdump_count:
  li t0, 512
  bltu s3, t0, hexdump_len
  mv s3, t0
hexdump_len:
  mv a0, s1
  call fs_find
  beqz a0, hexdump_not_found
  mv s4, a0
  lw t0, 32(s4)
  bltu t0, s3, hexdump_small
  j hexdump_read
hexdump_small:
  mv s3, t0
hexdump_read:
  mv a0, s4
  la a1, scratch_buf
  mv a2, s3
  li a3, 0
  call fs_read_part
  bltz a0, hexdump_error
  mv s5, a0
  li s6, 0
hexdump_row:
  bgeu s6, s5, dispatch_done
  mv a0, s6
  call puthex32
  li a0, 58
  EMIT_CHAR
  li a0, 32
  EMIT_CHAR
  li s7, 0
hexdump_col:
  li t0, 16
  bge s7, t0, hexdump_ascii_start
  add t0, s6, s7
  bgeu t0, s5, hexdump_pad
  la t1, scratch_buf
  add t1, t1, t0
  lbu a0, 0(t1)
  call puthex2
  li a0, 32
  EMIT_CHAR
  j hexdump_col_next
hexdump_pad:
  li a0, 32
  EMIT_CHAR
  EMIT_CHAR
  EMIT_CHAR
hexdump_col_next:
  addi s7, s7, 1
  j hexdump_col
hexdump_ascii_start:
  li a0, 124
  EMIT_CHAR
  li s7, 0
hexdump_ascii:
  li t0, 16
  bge s7, t0, hexdump_ascii_done
  add t0, s6, s7
  bgeu t0, s5, hexdump_ascii_dot
  la t1, scratch_buf
  add t1, t1, t0
  lbu a0, 0(t1)
  li t0, 32
  blt a0, t0, hexdump_ascii_dot
  li t0, 127
  bge t0, a0, hexdump_ascii_put
hexdump_ascii_dot:
  li a0, 46
hexdump_ascii_put:
  EMIT_CHAR
  addi s7, s7, 1
  j hexdump_ascii
hexdump_ascii_done:
  li a0, 124
  EMIT_CHAR
  NEWLINE
  addi s6, s6, 16
  j hexdump_row
hexdump_not_found:
  PRINT_STR msg_not_found
  mv a0, s1
  call puts
  NEWLINE
  j dispatch_done
hexdump_error:
  PRINT_STR msg_open_failed
  j dispatch_done

cmd_mem_run:
  la t0, arg_buf
  lw s1, 4(t0)
  beqz s1, cmd_missing
  mv a0, s1
  call parse_hex
  mv s2, a0
  la t0, arg_buf
  lw s3, 8(t0)
  li s4, 4
  beqz s3, mem_count_done
  mv a0, s3
  call parse_dec
  mv s4, a0
mem_count_done:
  li s5, 0
  li t0, 0x80000000
  bltu s2, t0, mem_bad_addr
  li t0, 0x81000000
  bgeu s2, t0, mem_bad_addr
mem_loop:
  bge s5, s4, dispatch_done
  mv a0, s2
  call puthex
  li a0, 58
  EMIT_CHAR
  li a0, 32
  EMIT_CHAR
  lw a0, 0(s2)
  call puthex
  NEWLINE
  addi s2, s2, 4
  addi s5, s5, 1
  j mem_loop
mem_bad_addr:
  PRINT_STR msg_bad_addr
  j dispatch_done

cmd_disk_run:
  la t0, virtio_ok
  lw t0, 0(t0)
  beqz t0, cmd_disk_none
  PRINT_STR msg_disk_cap
  la t0, disk_sectors
  lw a0, 0(t0)
  call putdec
  PRINT_STR msg_sectors
  j dispatch_done
cmd_disk_none:
  PRINT_STR msg_disk_none
  j dispatch_done

cmd_irq_run:
  PRINT_STR msg_irq_mip
  csrr a0, mip
  call puthex
  NEWLINE
  PRINT_STR msg_irq_mie
  csrr a0, mie
  call puthex
  NEWLINE
  PRINT_STR msg_irq_mcause
  csrr a0, mcause
  call puthex
  NEWLINE
  PRINT_STR msg_irq_ticks
  la t0, tick_count
  lw a0, 0(t0)
  call putdec
  NEWLINE
  PRINT_STR msg_irq_ext
  la t0, ext_irq_count
  lw a0, 0(t0)
  call putdec
  NEWLINE
  j dispatch_done

cmd_test_run:
  call run_selftests
  j dispatch_done

cmd_clear_run:
  PRINT_STR msg_clear
  j dispatch_done

cmd_reboot_run:
  PRINT_STR msg_reboot
  li t0, SYS_BASE
  li t1, SYS_RESET
  sw t1, SYS_CTRL(t0)
cmd_reboot_wait:
  j cmd_reboot_wait

cmd_halt_run:
  PRINT_STR msg_halted
  li t0, SYS_BASE
  li t1, SYS_POWEROFF
  sw t1, SYS_CTRL(t0)
  j dispatch_done

dispatch_done:
  lw s0, 8(sp)
  lw ra, 12(sp)
  addi sp, sp, 16
  ret

# a0 = decimal string -> a0 = value
parse_dec:
  li t0, 0
parse_dec_loop:
  lbu t1, 0(a0)
  beqz t1, parse_dec_done
  li t2, 48
  blt t1, t2, parse_dec_done
  li t2, 57
  blt t2, t1, parse_dec_done
  addi t1, t1, -48
  li t2, 10
  mul t0, t0, t2
  add t0, t0, t1
  addi a0, a0, 1
  j parse_dec_loop
parse_dec_done:
  mv a0, t0
  ret

# a0 = hexadecimal string (optional 0x) -> a0 = value
parse_hex:
  lbu t1, 0(a0)
  li t2, 48
  bne t1, t2, parse_hex_start
  lbu t1, 1(a0)
  li t2, 120
  bne t1, t2, parse_hex_start
  addi a0, a0, 2
parse_hex_start:
  li t0, 0
parse_hex_loop:
  lbu t1, 0(a0)
  beqz t1, parse_hex_done
  li t2, 48
  blt t1, t2, parse_hex_done
  li t2, 57
  bge t2, t1, parse_hex_digit
  li t2, 97
  blt t1, t2, parse_hex_upper
  addi t1, t1, -87
  j parse_hex_shift
parse_hex_upper:
  addi t1, t1, -55
  j parse_hex_shift
parse_hex_digit:
  addi t1, t1, -48
parse_hex_shift:
  slli t0, t0, 4
  or t0, t0, t1
  addi a0, a0, 1
  j parse_hex_loop
parse_hex_done:
  mv a0, t0
  ret

# Print the current UTC date and time from the goldfish RTC.
print_date:
  addi sp, sp, -64
  sw ra, 60(sp)
  sw s0, 56(sp)
  sw s1, 52(sp)
  sw s2, 48(sp)
  sw s3, 44(sp)
  sw s4, 40(sp)
  sw s5, 36(sp)
  sw s6, 32(sp)
  sw s7, 28(sp)
  sw s8, 24(sp)
  li t0, RTC_BASE
  lw s0, 4(t0)
  li t1, 86400
  divu s1, s0, t1
  remu s2, s0, t1
  li t1, 3600
  divu s3, s2, t1
  remu s2, s2, t1
  li t1, 60
  divu s4, s2, t1
  remu s5, s2, t1
  li t1, 719468
  add t2, s1, t1
  li t1, 146097
  divu t3, t2, t1
  mul t4, t3, t1
  sub t5, t2, t4
  li t0, 1460
  divu t6, t5, t0
  sub t6, t5, t6
  li t0, 36524
  divu a0, t5, t0
  add t6, t6, a0
  li t0, 146096
  divu a0, t5, t0
  sub t6, t6, a0
  li t0, 365
  divu t6, t6, t0
  li t0, 400
  mul a0, t3, t0
  add a0, t6, a0
  mv s6, a0
  li t0, 365
  mul a1, t6, t0
  srli t0, t6, 2
  add a1, a1, t0
  li t0, 100
  divu t0, t6, t0
  sub a1, a1, t0
  sub a1, t5, a1
  li t0, 5
  mul a2, a1, t0
  addi a2, a2, 2
  li t0, 153
  divu a2, a2, t0
  li t0, 153
  mul a3, a2, t0
  addi a3, a3, 2
  li t0, 5
  divu a3, a3, t0
  sub a3, a1, a3
  addi a3, a3, 1
  li t0, 10
  blt a2, t0, date_month_early
  addi a2, a2, -9
  j date_month_done
date_month_early:
  addi a2, a2, 3
date_month_done:
  mv s7, a2
  mv s8, a3
  li t0, 2
  blt t0, s7, date_year_done
  addi s6, s6, 1
date_year_done:
  PRINT_STR msg_date_prefix
  mv a0, s6
  call putdec
  li a0, 45
  EMIT_CHAR
  mv a0, s7
  call put2
  li a0, 45
  EMIT_CHAR
  mv a0, s8
  call put2
  li a0, 32
  EMIT_CHAR
  mv a0, s3
  call put2
  li a0, 58
  EMIT_CHAR
  mv a0, s4
  call put2
  li a0, 58
  EMIT_CHAR
  mv a0, s5
  call put2
  PRINT_STR msg_utc
  lw s8, 24(sp)
  lw s7, 28(sp)
  lw s6, 32(sp)
  lw s5, 36(sp)
  lw s4, 40(sp)
  lw s3, 44(sp)
  lw s2, 48(sp)
  lw s1, 52(sp)
  lw s0, 56(sp)
  lw ra, 60(sp)
  addi sp, sp, 64
  ret
