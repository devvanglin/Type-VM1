# RV32IM 汇编器

`src/asm/` 是一个两遍扫描的汇编器，输入文本，输出扁平的二进制镜像和符号表。

```ts
import { assemble, assembleFile } from "./src/asm/assembler.ts";
const result = assembleFile("guest/kernel/kernel.asm", { listing: true });
result.image;      // Uint8Array
result.symbols;    // Map<string, number>
result.entry;      // _start 或镜像基址
result.listing;    // 带地址和机器码的列表
```

## 指令集

完整 RV32I + M：

- `lui auipc jal jalr beq bne blt bge bltu bgeu lb lh lw lbu lhu sb sh sw
  addi slti sltiu xori ori andi slli srli srai add sub sll slt sltu xor srl sra or and
  fence fence.i ecall ebreak mret wfi`
- M 扩展：`mul mulh mulhsu mulhu div divu rem remu`
- CSR：`csrrw csrrs csrrc csrrwi csrrsi csrrci`

## 伪指令

| 伪指令 | 展开 |
| --- | --- |
| `li rd, imm` | 12 位直接 `addi`，否则 `lui` + `addi` |
| `la rd, sym` | `auipc` + `addi`（PC 相对） |
| `mv rd, rs` / `not` / `neg` | `addi` / `xori -1` / `sub rd, x0, rs` |
| `nop` / `ret` / `j target` / `jr rs` | `addi x0,x0,0` / `jalr x0,0(ra)` / `jal x0` / `jalr x0,0(rs)` |
| `call sym` / `tail sym` | `auipc ra/\t1` + `jalr` |
| `beqz bnez blez bgez bltz bgtz` | 单条条件分支 |
| `bgt ble bgtu bleu` | 交换两个源寄存器的条件分支 |
| `seqz snez sltz sgtz` | `sltiu` / `sltu` / `slt` |
| `csrr csrw csrs csrc csrwi csrsi csrci` | CSR 伪指令 |
| `rdcycle rdtime rdinstret` | CSR 读 |

## 指示符

```
.org expr               设定地址（只能向前）
.balign n / .align n    按字节 / 2^n 对齐
.byte .half .word .long .dword
.ascii .asciz .string
.space n [, fill] / .zero n
.equ name, expr / .set
.section .text|.data|.rodata|.bss   （仅作分组标记，不影响输出）
.global .globl .type .size .file .ident .option .local （忽略）
.include "file"
.macro name params...  ...  .endm
```

## 表达式

十进制/十六进制/二进制/八进制字面量、字符字面量（`'a'`）、符号、
一元 `+ - ~`，二元 `* / % + - << >> & ^ |`（C 优先级）。

`.equ` 可以引用尚未定义的符号，只要最后能解出值（支持前向引用和递归展开，循环定义会报错）。

## 宏

```asm
.macro PUTC reg
  li t0, 0x10000000
  sb \reg, 0(t0)
.endm

  PUTC a0
```

- `\name` 替换参数；
- `\@` 生成每次展开唯一的编号，用来写宏内标签：

```asm
.macro WAIT
wait_\@:
  j wait_\@
.endm
```

## 代码松弛

第一遍布局时按 4 字节预留所有分支。如果某条条件分支的目标超出 ±4 KiB，
第二遍会把它改写成“取反分支 + `jal`”的 8 字节形式：

```
beq a0, a1, far        bne a0, a1, +8
                       jal x0, far
```

大小变化会移动后续标签，所以布局和松弛循环到不再变化为止（最多 200 轮）。

## 错误信息

所有错误都是 `AsmError`，带 `file:line`：

```
kernel.asm:123: immediate out of range: 4096 (allowed -2048..2047)
kernel.asm:88: undefined symbol(s): missing_label
kernel.asm:41: duplicate label 'loop'
```
