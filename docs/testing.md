# 测试与调试

## 跑测试

```bash
node --test "tests/*.test.ts"
```

47 个用例分四组：

| 文件 | 覆盖 |
| --- | --- |
| `tests/assembler.test.ts` | 参考编码、M 扩展、伪指令、宏、include、松弛、数据指示符、错误报告、表达式 |
| `tests/cpu.test.ts` | x0 只读、算术/逻辑、M 扩展边界、各种宽度访存、jal/jalr、ecall/mret、非法指令、访问异常、CSR、分支条件 |
| `tests/devices.test.ts` | UART、CLINT、PLIC、RTC、virtio 身份寄存器与真实读写、总线异常、非对齐陷阱 |
| `tests/kernel.test.ts` | 整机启动、help/ls/cat、用户程序、故障处理、自检、sleep、halt、reboot、行编辑 |

`tests/helpers.ts` 里有两个工具：

- `runSnippet(source, limit)`：汇编一小段代码，跑 N 条指令，返回寄存器和陷阱信息；
- `runKernel(input)`：启动真实内核，喂入控制台输入，返回屏幕文本。

## 截屏

```bash
node scripts/screenshot.ts --out docs/web-terminal.png --commands "ls,run HELLO,test"
```

脚本自带一个极简 CDP 客户端（基于 `node:net` 手写 WebSocket 帧），
用无头 Chrome 打开网页终端、敲几个命令、再存 PNG。设置 `TYPEVM_DEBUG=1` 可以看到 CDP 收发。

## 调试内核

```bash
node src/cli.ts run --trace               # 逐条打印 pc 和指令字（前 2 万条）
node src/cli.ts script examples/demo.tvt  # 无头回放，最后打印统计
```

在代码里：

```ts
const m = createMachine();
m.cpu.onStep = (pc, inst) => { /* ... */ };
m.cpu.onTrap = (info) => console.log("trap", info);
m.feed("help\n");
```

`Machine.stats()` 会给出指令数、`mtime`、磁盘请求数、读写字节数。

## 常见坑

- **x0 必须只读**：任何写 x0 的指令（包括 `jalr x0`）都不能改变 x0。这个 bug
  会让 `ret` 直接把返回地址写进零寄存器，症状是函数返回后跳飞。
- **WFI 要退休指令**：陷入 WFI 时不更新 `pc` 会反复执行同一条指令。
  本项目的 `Machine` 在看到 `wfi` 时快进虚拟时钟，CPU 则把 `pc` 推进到下一条。
- **中断分派用 s 寄存器会踩栈帧**：`trap_handler` 用 `s1` 保存帧指针，而帧里存着
  被中断代码的 `s1`；恢复前一定要先把它用掉。
- **trap 入口的返回地址**：中断服务程序会调用普通函数，`ra` 会被覆盖，
  所以帧里专门存了一份 `TF_RET`（偏移 0，正好是没保存的 x0 槽）。
- **汇编器不认 `1f`/`1b` 数字标签**：请用命名标签。
- **`.align 16` 是 2^16 字节**：想按字节对齐请用 `.balign`。
