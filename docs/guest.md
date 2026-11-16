# TinyVM OS（guest 内核）

内核全部由 RISC-V 汇编写成，源码在 `guest/kernel/`，通过 `kernel.asm` 里的
`.include` 组装。

| 文件 | 内容 |
| --- | --- |
| `consts.asm` | 内存映射、寄存器偏移、常量 |
| `macros.asm` | `EMIT_CHAR`、`PRINT_STR`、`NEWLINE`、`PANIC` 等 |
| `boot.asm` | `_start`：栈、`mscratch`、`mtvec`、清 BSS、进 `kmain` |
| `uart.asm` | 16550 驱动（发送、接收、空闲时 WFI） |
| `string.asm` | `strlen strcmp strncmp memcpy memset strcmp_ord` 等 |
| `print.asm` | `puthex putdec put2 put3 put4` 等格式化输出 |
| `trap.asm` | 陷阱入口（144 字节寄存器帧）、分派、panic |
| `timer.asm` | CLINT 定时器、`sleep_ms`、PLIC 中断处理、`print_uptime` |
| `virtio.asm` | virtio-blk 初始化与读写 |
| `fs.asm` | TVFS 挂载 / 查找 / 读取 / 列目录 / cat |
| `user.asm` | 用户态切换、`ecall` 分派、TVX 加载器 |
| `shell.asm` | `kmain`、行编辑、tokenizer、命令实现、日期换算 |
| `selftest.asm` | `test` 命令的 6 项自检 |
| `data.asm` | 字符串表与 BSS |

## 系统调用

用户程序用 `ecall`，调用号放 `a7`，参数依次放 `a0`–`a2`，返回值放 `a0`：

| 号 | 名称 | 参数 | 返回 |
| --- | --- | --- | --- |
| 1 | `write` | `a0` 缓冲区，`a1` 长度 | 写入字节数，越界返回 -1 |
| 2 | `exit` | `a0` 退出码 | 不返回 |
| 3 | `putnum` | `a0` 数值，`a1` 进制（16 表示十六进制） | 0 |
| 4 | `putchar` | `a0` 字符 | 0 |
| 5 | `getchar` | 无 | 字符或 -1 |
| 6 | `time` | 无 | `mtime` 低 32 位 |

内核会校验 `write` 的缓冲区落在 `0x80400000`–`0x80600000` 之间。

## TVX 可执行格式

```
偏移 0   "TVX1"
偏移 4   entry 偏移（相对镜像起始）
偏移 8   payload 大小
偏移 12  版本（1）
偏移 16  代码与数据
```

用户程序链接在 `0`，加载到 `0x80400000`，栈顶是 `0x805f0000`。
`run NAME` 会自动补 `.TVX` 后缀。

## TVFS 文件系统

磁盘扇区 0 是超级块，扇区 1–2 是文件表（每项 64 字节：31 字节名字 + 大小 +
起始扇区 + 标志），数据从扇区 3 开始。

```
0   "TVFS0001"
8   version = 1
12  扇区大小 = 512
16  总扇区数
20  文件数
24  文件表扇区 = 1
28  数据起始扇区 = 3
```

镜像由 `src/host/tvfs.ts` 的 `buildTvfs()` 生成，也可以被 `parseTvfs()` 读回来（测试里用到）。

## Shell 命令

| 命令 | 说明 |
| --- | --- |
| `help` | 命令列表 |
| `info` | `misa`、特权级、`mtime` |
| `ls` | 列磁盘文件 |
| `cat FILE` | 打印文本文件 |
| `run FILE` | 加载并运行用户程序 |
| `echo TEXT...` | 回显（最多 7 个参数） |
| `date` | 从 RTC 读 UTC 时间 |
| `uptime` | 虚拟时钟运行时长 |
| `sleep MS` | 用 CLINT + WFI 睡 MS 虚拟毫秒 |
| `mem ADDR [N]` | dump 物理内存 |
| `disk` | virtio-blk 容量 |
| `irq` | `mip` / `mie` / `mcause` / tick 数 |
| `test` | 内核自检 |
| `clear` | ANSI 清屏 |
| `reboot` / `halt` | 重启 / 关机 |

行编辑支持退格、`Ctrl-C` 取消、`Ctrl-U` 删行、方向键（忽略）。

## 用户程序

| 程序 | 演示什么 |
| --- | --- |
| `HELLO` | 最基本的 `write` + `exit` |
| `FIB` | 循环 + `putnum` 系统调用 |
| `SYSINFO` | `time` 系统调用 |
| `CRASH` | 写地址 0 触发存储访问异常，内核捕获并杀死程序 |
| `TEST` | 自检用的静默程序 |
