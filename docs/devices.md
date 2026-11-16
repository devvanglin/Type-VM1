# Type-VM1 平台与设备

## 物理内存映射

| 起始地址 | 大小 | 设备 |
| --- | --- | --- |
| `0x02000000` | 64 KiB | CLINT（机器定时器 + 软件中断） |
| `0x0c000000` | 16 MiB | PLIC |
| `0x10000000` | 256 B | UART 16550 |
| `0x10001000` | 4 KiB | virtio-mmio 块设备 |
| `0x10003000` | 256 B | 系统控制（关机 / 重启 / 让步） |
| `0x10100000` | 4 KiB | goldfish RTC |
| `0x80000000` | 16 MiB | RAM |

超出范围的访问产生访问异常（`mcause = 1/5/7`）；非对齐的设备访问会被总线拒绝。

## UART 16550（`0x10000000`）

| 偏移 | 名称 | 说明 |
| --- | --- | --- |
| 0 | RBR / THR | 读：接收字节；写：发送字节 |
| 1 | IER | bit0 接收中断使能 |
| 2 | FCR / IIR | 写：FIFO 控制（忽略）；读：中断标识 |
| 3 | LCR | 线路控制 |
| 5 | LSR | bit0 数据就绪，bit5 发送保持寄存器空，bit6 发送移位寄存器空 |
| 7 | SCR | 暂存寄存器 |

发送字节会立刻以 UTF-8 字节流的形式出现在终端；接收队列由宿主 `feed()` 填充。

## CLINT（`0x02000000`）

| 偏移 | 名称 |
| --- | --- |
| `0x0000` | MSIP（软件中断） |
| `0x4000` / `0x4004` | MTIMECMP 低/高 32 位 |
| `0xbff8` / `0xbffc` | MTIME 低/高 32 位 |

`mtime >= mtimecmp` 时置 `mip.MTIP`，触发机器定时器中断（`mcause = 0x80000007`）。

## PLIC（`0x0c000000`）

单 hart、单 context 的简化实现：

| 偏移 | 说明 |
| --- | --- |
| `0x0000 + 4*id` | 中断源优先级（0–7） |
| `0x2000` | 使能位图 |
| `0x200000` | 阈值 |
| `0x200004` | claim / complete |

中断源：1 = virtio-blk，10 = UART。claim 后该源被屏蔽，complete 后重新可触发。

## virtio-mmio 块设备（`0x10001000`）

现代 virtio 1.0（version 2）：

| 偏移 | 寄存器 |
| --- | --- |
| `0x000` | MagicValue `0x74726976` |
| `0x004` | Version = 2 |
| `0x008` | DeviceID = 2（block） |
| `0x010` / `0x014` | DeviceFeatures / FeaturesSel |
| `0x020` / `0x024` | DriverFeatures 低/高 |
| `0x030`–`0x044` | QueueSel / QueueNumMax / QueueNum / QueueReady |
| `0x050` | QueueNotify（写 1 触发处理） |
| `0x060` / `0x064` | InterruptStatus / InterruptACK |
| `0x070` | Status |
| `0x074`–`0x094` | QueueDesc / QueueDriver / QueueDevice 低高 32 位 |
| `0x100` | Capacity（512 字节扇区数） |

队列格式与规范一致：描述符表（16 字节/项）、available ring、used ring。
一次请求是三个描述符：16 字节请求头 → 512 字节数据 → 1 字节状态。
设备完成请求后写 used ring 并置 `InterruptStatus = 1`。

内核驱动在 `guest/kernel/virtio.asm`，约 150 行。

## goldfish RTC（`0x10100000`）

- `0x00`：时间高 32 位
- `0x04`：时间低 32 位（Unix 秒，取宿主时钟）

`date` 命令用它算出自 1970 年以来的 UTC 年月日时分秒（完整的 Hinnant 算法）。

## 系统控制（`0x10003000`）

| 偏移 | 说明 |
| --- | --- |
| 0 | 退出码 |
| 4 | 写 `0x5555` 关机，`0x7777` 重启 |
| 8 | 写任意值让出 CPU（宿主循环返回） |

关机会让 `node src/cli.ts run` 以对应退出码结束。
