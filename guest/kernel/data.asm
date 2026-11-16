# ---------------------------------------------------------------------------
# Messages, buffers and the BSS
# ---------------------------------------------------------------------------

.section .rodata
banner_0:        .asciz "\r\n"
banner_1:        .asciz "  Type-VM1  |  RISC-V RV32IM virtual machine\r\n"
banner_2:        .asciz "  booting TinyVM OS kernel ...\r\n"
banner_3:        .asciz "\r\n"

msg_cpu:         .asciz "CPU      : RV32IM, machine + user mode, 10 MHz virtual\r\n"
msg_mem:         .asciz "RAM      : 16 MiB at 0x80000000\r\n"
msg_dev_uart:    .asciz "devices  : uart0 16550 @ 0x10000000\r\n"
msg_dev_timer:   .asciz "           clint timer @ 0x02000000 (1 MHz)\r\n"
msg_dev_plic:    .asciz "           plic @ 0x0c000000\r\n"
msg_dev_disk:    .asciz "           virtio-blk @ 0x10001000\r\n"
msg_dev_rtc:     .asciz "           goldfish rtc @ 0x10100000\r\n"
msg_dev_sys:     .asciz "           machine control @ 0x10003000\r\n"
msg_disk_ok:     .asciz "disk     : virtio-blk, capacity "
msg_sectors:     .asciz " sectors\r\n"
msg_disk_bad:    .asciz "disk     : virtio-blk not found\r\n"
msg_fs_ok:       .asciz "filesystem: TVFS mounted, "
msg_files:       .asciz " files\r\n"
msg_fs_bad:      .asciz "filesystem: no valid TVFS disk image\r\n"
msg_ready:       .asciz "\r\nType 'help' for a list of commands.\r\n\r\n"

msg_prompt:      .asciz "tinyvm> "
msg_help_hint:   .asciz "type 'help' for the command list\r\n"

help_text:
  .ascii "commands:\r\n"
  .ascii "  help                 show this list\r\n"
  .ascii "  info                 cpu and platform information\r\n"
  .ascii "  ls                   list files on the virtio disk\r\n"
  .ascii "  cat FILE             print a text file\r\n"
  .ascii "  hexdump FILE [N]     hex dump (default 128 bytes)\r\n"
  .ascii "  run FILE             load and run a user-mode program\r\n"
  .ascii "  echo TEXT            echo the arguments\r\n"
  .ascii "  date                 current utc time from the rtc\r\n"
  .ascii "  uptime               time since boot on the virtual clock\r\n"
  .ascii "  sleep MS             sleep for MS virtual milliseconds\r\n"
  .ascii "  mem ADDR [N]         dump N words of physical memory\r\n"
  .ascii "  disk                 virtio-blk status\r\n"
  .ascii "  irq                  interrupt controller state\r\n"
  .ascii "  test                 run the kernel self test\r\n"
  .ascii "  clear                clear the screen\r\n"
  .ascii "  reboot               reboot the machine\r\n"
  .ascii "  halt                 power off the machine\r\n"
  .asciz ""

msg_panic_prefix: .asciz "\r\n*** KERNEL PANIC: cause "
msg_panic_epc:   .asciz "  epc="
msg_panic_tval:  .asciz "  tval="
msg_unexpected:  .asciz "unexpected trap"
msg_user_fault:  .asciz "\r\n[fault] program terminated, cause "
msg_at:          .asciz " at "

msg_unknown_cmd: .asciz "unknown command: "
msg_missing_arg: .asciz "missing argument\r\n"
msg_not_found:   .asciz "no such file: "
msg_no_program:  .asciz "no such program: "
msg_no_disk:     .asciz "no disk filesystem available\r\n"
msg_open_failed: .asciz "cannot read file\r\n"
msg_exit:        .asciz "program exited with code "
msg_exec:        .asciz "executing program...\r\n"
msg_bad_program: .asciz "not a valid TVX program\r\n"
msg_program_too_big: .asciz "program is too large for the user area\r\n"

msg_bytes_nl:    .asciz " bytes\r\n"
msg_total_files: .asciz "total: "
msg_uptime:      .asciz "up "
msg_seconds:     .asciz " s"
msg_date_prefix: .asciz "utc time: "
msg_slept:       .asciz "slept "
msg_ms:          .asciz " ms (virtual clock now "
msg_ticks:       .asciz " ticks)\r\n"
msg_disk_cap:    .asciz "virtio-blk capacity: "
msg_disk_none:   .asciz "virtio-blk not present\r\n"
msg_irq_mip:     .asciz "mip      : "
msg_irq_mie:     .asciz "mie      : "
msg_irq_mcause:  .asciz "mcause   : "
msg_irq_ticks:   .asciz "ticks    : "
msg_irq_ext:     .asciz "ext irqs : "
msg_info_isa:    .asciz "isa      : RV32IM (misa="
msg_info_mode:   .asciz "modes    : machine (M) and user (U)\r\n"
msg_info_time:   .asciz "mtime    : "
msg_clear:       .byte 27, 91, 50, 74, 27, 91, 72, 0
msg_reboot:      .asciz "rebooting ...\r\n"
msg_halted:      .asciz "powering off\r\n"

cmd_help:        .asciz "help"
cmd_info:        .asciz "info"
cmd_ls:          .asciz "ls"
cmd_cat:         .asciz "cat"
cmd_hexdump:     .asciz "hexdump"
cmd_run:         .asciz "run"
cmd_echo:        .asciz "echo"
cmd_date:        .asciz "date"
cmd_uptime:      .asciz "uptime"
cmd_sleep:       .asciz "sleep"
cmd_mem:         .asciz "mem"
cmd_disk:        .asciz "disk"
cmd_irq:         .asciz "irq"
cmd_test:        .asciz "test"
cmd_clear:       .asciz "clear"
cmd_reboot:      .asciz "reboot"
cmd_halt:        .asciz "halt"
msg_bad_addr:    .asciz "address must be inside the 16 MiB of RAM\r\n"
msg_utc:         .asciz " utc\r\n"
msg_info_ticks:  .asciz " ticks\r\n"
test_prog_name:  .asciz "TEST.TVX"

msg_test_header: .asciz "kernel self test:\r\n"
msg_test_summary:.asciz "result   : "
msg_test_passed: .asciz " passed, "
msg_test_failed: .asciz " failed\r\n"
test_ok_prefix:  .asciz "  [ok]   "
test_fail_prefix:.asciz "  [FAIL] "
test_name_mem:   .asciz "ram read/write"
test_name_uart:  .asciz "uart transmitter ready"
test_name_timer: .asciz "clint timer advances"
test_name_disk:  .asciz "virtio-blk mmio identity"
test_name_fs:    .asciz "tvfs superblock"
test_name_user:  .asciz "user mode program"

# ---------------------------------------------------------------------------
# BSS
# ---------------------------------------------------------------------------
.section .bss
.balign 16
__bss_start:
.balign 16
trap_stack:
  .space 4096
trap_stack_top:

.balign 16
kernel_stack:
  .space 16384
kernel_stack_top:

.balign 16
disk_buf:        .space 1024
fs_super:        .space 512
fs_table:        .space 1024
line_buf:        .space 256
arg_buf:         .space 32
virtq_desc:      .space 128
virtq_avail:     .space 64
virtq_used:      .space 128
virtio_hdr:      .space 16
virtio_status:   .space 4
kern_ctx:        .space 64
user_active:     .space 4
user_exit_code:  .space 4
tick_count:      .space 4
ext_irq_count:   .space 4
sleeping:        .space 4
sleep_target:    .space 4
virtio_used_expect: .space 4
virtio_ok:       .space 4
disk_sectors:    .space 4
fs_ok:           .space 4
fs_count:        .space 4
scratch_buf:     .space 512
test_passed:     .space 4
test_failed:     .space 4
.balign 16
__bss_end:
