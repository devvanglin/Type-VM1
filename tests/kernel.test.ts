import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildAll } from "../scripts/build.ts";
import { parseTvfs } from "../src/host/tvfs.ts";
import { Machine } from "../src/vm/machine.ts";
import { projectRoot } from "../src/cli.ts";
import { runKernel } from "./helpers.ts";

before(() => {
  buildAll();
});

test("the disk image is a valid TVFS volume with the demo files", () => {
  const disk = new Uint8Array(readFileSync(join(projectRoot, "build/disk.img")));
  const { entries, files } = parseTvfs(disk);
  const names = entries.map((e) => e.name);
  for (const expected of ["README.TXT", "NOTES.TXT", "LICENSE", "HELLO.TVX", "FIB.TVX", "CRASH.TVX", "TEST.TVX"]) {
    assert.ok(names.includes(expected), `missing ${expected}`);
  }
  const hello = files.get("HELLO.TVX")!;
  assert.equal(String.fromCharCode(...hello.slice(0, 4)), "TVX1");
});

test("the kernel boots and reports the platform", () => {
  const { text, state } = runKernel("\n", { maxInstructions: 3_000_000 });
  assert.match(text, /Type-VM1/);
  assert.match(text, /RV32IM, machine \+ user mode/);
  assert.match(text, /disk     : virtio-blk, capacity 2048 sectors/);
  assert.match(text, /filesystem: TVFS mounted, \d+ files/);
  assert.match(text, /tinyvm> /);
  assert.equal(state, "running");
});

test("help lists the shell commands", () => {
  const { text } = runKernel("help\n", { maxInstructions: 3_000_000 });
  for (const cmd of ["help", "info", "ls", "cat FILE", "run FILE", "echo TEXT", "date", "uptime", "sleep MS", "mem ADDR", "disk", "irq", "test", "clear", "reboot", "halt"]) {
    assert.ok(text.includes(cmd), `help does not mention ${cmd}`);
  }
});

test("ls shows the disk contents and cat prints a file", () => {
  const { text } = runKernel("ls\ncat README.TXT\n", { maxInstructions: 8_000_000 });
  assert.match(text, /README\.TXT\s+1002 bytes/);
  assert.match(text, /total: 8/);
  assert.match(text, /Type-VM1 demo disk/);
  assert.match(text, /Everything you see is emulated/);
});

test("user programs run in user mode and exit cleanly", () => {
  const { text } = runKernel("run HELLO\n", { maxInstructions: 8_000_000 });
  assert.match(text, /Hello from user mode!/);
  assert.match(text, /program exited with code 0/);
});

test("fibonacci is computed with syscalls from user mode", () => {
  const { text } = runKernel("run FIB\n", { maxInstructions: 8_000_000 });
  assert.match(text, /1 1 2 3 5 8 13 21 34 55 89 144/);
});

test("a user-mode fault is caught by the kernel instead of killing it", () => {
  const { text, state } = runKernel("run CRASH\nls\n", { maxInstructions: 12_000_000 });
  assert.match(text, /\[fault\] program terminated, cause 7/);
  assert.match(text, /program exited with code 4294967295/);
  assert.match(text, /README\.TXT/); // the shell survived and listed the directory
  assert.equal(state, "running");
});

test("missing programs and commands are reported", () => {
  const { text } = runKernel("run NOPE\nfrobnicate\ncat MISSING.TXT\n", { maxInstructions: 6_000_000 });
  assert.match(text, /no such program: NOPE\.TVX/);
  assert.match(text, /unknown command: frobnicate/);
  assert.match(text, /no such file: MISSING\.TXT/);
});

test("the kernel self test passes", () => {
  const { text } = runKernel("test\n", { maxInstructions: 15_000_000 });
  assert.match(text, /result   : 6 passed, 0 failed/);
  assert.match(text, /\[ok\]   user mode program/);
});

test("sleep uses the CLINT timer and wakes up", () => {
  const { text } = runKernel("sleep 250\n", { maxInstructions: 20_000_000 });
  assert.match(text, /slept 250 ms \(virtual clock now \d+ ticks\)/);
});

test("echo, mem, disk and irq produce sane output", () => {
  const { text } = runKernel("echo hello world\nmem 0x80000000 2\ndisk\nirq\n", { maxInstructions: 6_000_000 });
  assert.match(text, /hello world/);
  assert.match(text, /0x80000000: 0x[0-9a-f]{8}/);
  assert.match(text, /virtio-blk capacity: 2048 sectors/);
  assert.match(text, /mie      : 0x00000880/);
});

test("hexdump prints an annotated hex dump", () => {
  const { text } = runKernel("hexdump README.TXT 32\n", { maxInstructions: 8_000_000 });
  assert.match(text, /^00000000: 54 79 70 65 .*\|Type-VM1/m);
}); 

test("halt powers the machine off with exit code 0", () => {
  const { text, state, machine } = runKernel("halt\n", { maxInstructions: 4_000_000 });
  assert.match(text, /powering off/);
  assert.equal(state, "halted");
  assert.equal(machine.exitCode, 0);
});

test("input is echoed and backspace edits the line", () => {
  const { text } = runKernel("echo abc\u007f\u007fd\n", { maxInstructions: 4_000_000 });
  // "abc", two backspaces (remove "bc"), then "d" -> the line becomes "ad".
  assert.ok(text.includes("tinyvm> echo abc\b \b\b \bd"), "the line editor echoes erase sequences");
  assert.ok(text.includes("\nad\n"), "the edited command runs as 'ad'");
});

test("rebooting resets the machine", () => {
  const kernel = new Uint8Array(readFileSync(join(projectRoot, "build/kernel.bin")));
  const disk = new Uint8Array(readFileSync(join(projectRoot, "build/disk.img")));
  let text = "";
  const machine = new Machine({ kernel, disk, onOutput: (chunk) => { text += chunk; } });
  machine.feed("reboot\n");
  machine.runSync({ maxInstructions: 4_000_000 });
  assert.equal(machine.state, "reset");
  assert.match(text, /rebooting \.\.\./);
});
