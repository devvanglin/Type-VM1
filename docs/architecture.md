# Type-VM1 架构

## 分层

```
public/index.html + public/app.js      浏览器字符终端（无依赖 ES module）
        |  POST /api/input, GET /api/stream (SSE)
src/host/server.ts                    会话管理，把宿主事件循环切成片
src/cli.ts                            run / build / web / script 四个入口
src/host/tvfs.ts                      TVFS 镜像构建与解析（宿主侧）
src/vm/machine.ts                     设备连线、虚拟时钟、运行循环
src/vm/cpu.ts                         RV32IM hart
src/vm/memory.ts                      总线、RAM、MMIO 分派
src/vm/devices.ts                     UART / CLINT / PLIC / virtio-blk / RTC / 关机控制
src/asm/*                             汇编器（预处理 → 解析 → 布局 → 松弛 → 编码 → 列表）
guest/kernel/*.asm                    guest 内核（汇编）
guest/user/*.asm                      用户态程序（汇编）
```

## 一次启动发生了什么

1. `scripts/build.ts` 用汇编器把 `guest/kernel/kernel.asm`（含 12 个 `.include`）汇编成
   `build/kernel.bin`，同时把每个用户程序组装成带 `TVX1` 头的可执行文件，
   再用 `src/host/tvfs.ts` 把所有文件塞进 `build/disk.img`。
2. `Machine` 构造时把内核镜像拷进 RAM 的 `0x80000000`，给总线挂上 6 个设备，
   复位 hart（`pc = 0x80000000`, `mode = M`）。
3. `_start` 设置栈指针、`mscratch`（陷阱栈）、`mtvec`（陷阱入口），清零 BSS，
   然后调用 `kmain`。
4. `kmain` 初始化 UART、virtio-blk（现代 virtio 1.0 握手 + 单队列）、挂载 TVFS、
   启动 CLINT 定时器（每 1 ms 一次中断），最后进入 `shell_loop`。

## CPU 执行循环

`Cpu.step()` 每次执行一条指令：

1. `mcycle++`；
2. 检查 `mie & mip`，若有挂起中断且 `mstatus.MIE = 1`，进入陷阱；
3. 取指 `bus.read32(pc)`，失败则 `mcause = 1`（取指访问异常）；
4. 译码执行，访存失败翻译成 `mcause = 5/7`，非法指令是 `mcause = 2`；
5. 写回前把 `x0` 强制清零（这是最容易写错的一条，本项目早期就踩过）；
6. `minstret++`。

陷阱进入时 `mstatus` 按规范压栈（MIE→MPIE，特权级→MPP），`mepc/mcause/mtval` 更新，
`mode = M`，`pc = mtvec`（`mtvec[1:0] == 1` 时按中断号向量化）。

## 虚拟时钟

```
mtime = retired_instructions / 10 + idle_ticks
```

也就是说：10 MIPS 的虚拟 CPU 配 1 MHz 的 CLINT，正好是“每 10 条指令走 1 微秒”。
`WFI` 会直接把 `idle_ticks` 快进到下一个 `mtimecmp`，所以 `sleep 250`
在宿主机上瞬间完成，但 guest 里读到的 `mtime` 确实前进了 250000 tick。

## 中断路径

```
UART 收到字节 → uart.line() → plic.setLine(10) → cpu.mip |= MEIP → 陷阱
virtio 完成请求 → 置 interrupt_status → plic.setLine(1) → 同上
CLINT mtime >= mtimecmp → cpu.mip |= MTIP → 陷阱（机器定时器）
```

guest 的 `trap_handler` 按 `mcause` 分派：`7` 走 `timer_irq`，`11` 走 `external_irq`
（claim → 处理 → complete），`8` 走 `syscall_u`，其余归为异常。

## 用户态

`run_user(entry)` 把内核寄存器存进 `kern_ctx`，把 `mepc` 设成用户入口，
`mstatus = 0x80`（MPIE=1，MPP=U），切到用户栈，`mret` 进入 U 模式。
用户程序用 `ecall`（`a7` 是调用号）请求内核；退出时 `user_abort`
恢复 `kern_ctx` 并 `ret` 回 `run_program`。

如果用户程序触发异常（例如写地址 0），`trap_handler` 发现 `mstatus.MPP = U`
就调用 `user_abort` 杀掉程序，shell 继续活着。

## 网页终端

页面刻意做到极简：纯黑背景、单一等宽字体、没有任何边框/面板/状态栏。
所有信息都由 guest 内核自己打印到 UART 上，浏览器只负责维护一块字符网格。

两个实现细节：

- **灰度抗锯齿**：`#screen` 有 `transform: translateZ(0)`，把它提升为合成层，
  Chrome 于是用灰度抗锯齿渲染字形，终端不会出现次像素彩边（截图像素检查：
  0 个非灰度颜色）。
- **光标只在空闲状态翻转时重绘**：定时器比较 `idle` 布尔值，只有真正变化才重写
  DOM，避免空闲页面反复重建节点、把用户的文本选择清掉。

## 为什么全是 TypeScript

因为目标是“看得懂的虚拟机”：没有构建步骤、没有外部依赖，`node src/cli.ts run`
就能跑。汇编器、CPU、设备、内核、前端加起来不到 1 万行可读代码。
