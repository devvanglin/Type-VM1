# ---------------------------------------------------------------------------
# Platform memory map and register offsets
# ---------------------------------------------------------------------------

.equ RAM_BASE,        0x80000000
.equ RAM_SIZE,        0x01000000

# 16550-compatible UART
.equ UART_BASE,       0x10000000
.equ UART_RBR,        0x00
.equ UART_THR,        0x00
.equ UART_IER,        0x01
.equ UART_FCR,        0x02
.equ UART_LCR,        0x03
.equ UART_MCR,        0x04
.equ UART_LSR,        0x05
.equ UART_SCR,        0x07
.equ LSR_DR,          0x01
.equ LSR_THRE,        0x20
.equ LSR_TEMT,        0x40

# Core-local interruptor: 1 MHz virtual clock
.equ CLINT_BASE,      0x02000000
.equ CLINT_MTIMECMP,  0x02004000
.equ CLINT_MTIME,     0x0200bff8
.equ TICK_INTERVAL,   1000            # 1 ms

# Platform-level interrupt controller
.equ PLIC_PRIORITY,   0x0c000000
.equ PLIC_ENABLE,     0x0c002000
.equ PLIC_THRESHOLD,  0x0c200000
.equ PLIC_CLAIM,      0x0c200004
.equ IRQ_VIRTIO,      1
.equ IRQ_UART,        10

# virtio-mmio block device
.equ VIRTIO_BASE,     0x10001000
.equ VIRTIO_MAGIC,    0x000
.equ VIRTIO_VERSION,  0x004
.equ VIRTIO_DEVICE,   0x008
.equ VIRTIO_VENDOR,   0x00c
.equ VIRTIO_FEATURES, 0x010
.equ VIRTIO_FEAT_SEL, 0x014
.equ VIRTIO_DFEAT_LO, 0x020
.equ VIRTIO_DFEAT_HI, 0x024
.equ VIRTIO_QSEL,     0x030
.equ VIRTIO_QNUMMAX,  0x034
.equ VIRTIO_QNUM,     0x038
.equ VIRTIO_QREADY,   0x044
.equ VIRTIO_QNOTIFY,  0x050
.equ VIRTIO_ISTATUS,  0x060
.equ VIRTIO_IACK,     0x064
.equ VIRTIO_STATUS,   0x070
.equ VIRTIO_QDESC_LO, 0x074
.equ VIRTIO_QDESC_HI, 0x078
.equ VIRTIO_QAVAIL_LO,0x080
.equ VIRTIO_QAVAIL_HI,0x084
.equ VIRTIO_QUSED_LO, 0x090
.equ VIRTIO_QUSED_HI, 0x094
.equ VIRTIO_CONFIG,   0x100
.equ VIRTIO_MAGIC_VAL, 0x74726976
.equ VIRTIO_VERSION_VAL, 2
.equ VIRTIO_ID_BLOCK, 2

# Machine control
.equ SYS_BASE,        0x10003000
.equ SYS_EXIT_CODE,   0x00
.equ SYS_CTRL,        0x04
.equ SYS_YIELD,       0x08
.equ SYS_POWEROFF,    0x5555
.equ SYS_RESET,       0x7777

# Goldfish RTC
.equ RTC_BASE,        0x10100000

# User program area
.equ USER_BASE,       0x80400000
.equ USER_LIMIT,      0x80600000
.equ USER_STACK_TOP,  0x805f0000
.equ USER_MAX_SIZE,   0x00100000

# TVFS / TVX
.equ TVFS_MAGIC_LO,   0x53465654   # "TVFS"
.equ TVFS_MAGIC_HI,   0x31303030   # "0001"
.equ TVFS_MAX_FILES,  16
.equ SECTOR_SIZE,     512
.equ TVX_MAGIC,       0x31585654   # "TVX1"
.equ TVX_HEADER_SIZE, 16
