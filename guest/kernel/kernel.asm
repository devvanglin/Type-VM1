# Type-VM1 guest kernel
# A small monolithic kernel for the Type-VM1 RV32IM virtual machine.
#
# Boot:  _start -> kmain -> shell
# It provides a 16550 UART console driver, a CLINT timer, a PLIC + virtio-blk
# disk driver, a tiny read-only filesystem (TVFS) and a user-mode loader with
# ecall-based system calls.

.include "consts.asm"
.include "macros.asm"
.include "boot.asm"
.include "uart.asm"
.include "string.asm"
.include "print.asm"
.include "trap.asm"
.include "timer.asm"
.include "virtio.asm"
.include "fs.asm"
.include "user.asm"
.include "shell.asm"
.include "selftest.asm"
.include "data.asm"
