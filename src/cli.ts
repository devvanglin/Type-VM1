#!/usr/bin/env node
/** Type-VM1 command line interface.
 *
 *   node src/cli.ts run [options]      boot the machine in a terminal
 *   node src/cli.ts build              assemble the kernel, programs and disk
 *   node src/cli.ts web [options]      serve the web terminal
 *   node src/cli.ts script FILE        feed a script of shell lines headlessly
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Machine } from "./vm/machine.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const projectRoot = join(here, "..");

export interface MachineArtifacts {
  kernel: Uint8Array;
  disk: Uint8Array;
}

export function loadArtifacts(root = projectRoot): MachineArtifacts {
  const kernelPath = join(root, "build", "kernel.bin");
  const diskPath = join(root, "build", "disk.img");
  if (!existsSync(kernelPath) || !existsSync(diskPath)) {
    throw new Error("build artifacts are missing; run 'node src/cli.ts build' first");
  }
  return {
    kernel: new Uint8Array(readFileSync(kernelPath)),
    disk: new Uint8Array(readFileSync(diskPath)),
  };
}

export function createMachine(root = projectRoot, onOutput?: (text: string) => void): Machine {
  const artifacts = loadArtifacts(root);
  return new Machine({ kernel: artifacts.kernel, disk: artifacts.disk, onOutput });
}

function usage(): void {
  console.log(`Type-VM1 — a RISC-V RV32IM virtual machine written in TypeScript

usage:
  node src/cli.ts build                 assemble kernel, programs and disk image
  node src/cli.ts run [options]         boot the machine in this terminal
  node src/cli.ts web [options]         serve the browser terminal
  node src/cli.ts script FILE           run a script of shell commands

options for run:
  --artifacts DIR      directory holding kernel.bin and disk.img (default: build)
  --trace              print every executed instruction (very verbose)
  --no-color           disable ANSI colours in the banner
  --help               show this message
`);
}

async function cmdBuild(): Promise<void> {
  const { buildAll } = await import("../scripts/build.ts");
  const summary = buildAll();
  console.log("kernel    :", `${summary.kernelSize} bytes, ${summary.kernelInstructions} instructions`);
  console.log("programs  :", summary.programs.map((p) => `${p.name} (${p.size} bytes)`).join(", "));
  console.log("disk image:", `${summary.diskSize} bytes`);
  console.log("files     :", summary.files.map((f) => f.name).join(", "));
}

async function cmdScript(file: string): Promise<void> {
  const machine = createMachine(projectRoot, (text) => process.stdout.write(text));
  const lines = readFileSync(resolve(file), "utf8").split(/\r?\n/).filter((l, i, all) => l.length > 0 || i < all.length - 1);
  const script = lines.join("\n") + "\n";
  const startedAt = Date.now();
  machine.feed(script);
  await machine.run({ maxInstructions: 400_000_000, timeoutMs: 120_000 });
  const stats = machine.stats();
  console.log("\n--- machine stopped ---");
  console.log(`state: ${machine.state}  exit: ${machine.exitCode}`);
  console.log(`instructions: ${stats.instructions.toLocaleString()}  virtual time: ${(stats.mtime / 1000).toFixed(3)} s`);
  console.log(`disk requests: ${stats.diskRequests}  bytes read: ${stats.bytesRead}  bytes written: ${stats.bytesWritten}`);
  console.log(`host time: ${Date.now() - startedAt} ms`);
}

async function cmdRun(args: string[]): Promise<void> {
  const machine = createMachine(projectRoot, (text) => process.stdout.write(text));
  if (args.includes("--trace")) {
    let count = 0;
    machine.cpu.onStep = (pc, inst) => {
      count++;
      if (count < 20000) console.log(`0x${pc.toString(16)}  0x${inst.toString(16).padStart(8, "0")}`);
    };
  }

  console.log("\u001b[36mType-VM1 — RISC-V RV32IM virtual machine\u001b[0m");
  console.log("\u001b[90m(exit with Ctrl-] )\u001b[0m");

  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.setEncoding("utf8");
  process.stdin.resume();
  process.stdin.on("data", (chunk: string) => {
    if (chunk.includes("\u001d")) {
      restoreAndExit(0);
      return;
    }
    machine.feed(chunk);
  });

  const onSignal = () => restoreAndExit(0);
  process.on("SIGINT", () => {
    machine.feed("\u0003");
  });
  process.on("SIGTERM", onSignal);
  process.on("exit", () => {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  });

  function restoreAndExit(code: number): void {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdout.write("\n");
    const stats = machine.stats();
    console.error(`[machine halted: ${stats.instructions.toLocaleString()} instructions, virtual time ${(stats.mtime / 1_000_000).toFixed(3)} s]`);
    process.exit(code);
  }

  const state = await machine.run({ maxInstructions: 500_000_000 });
  const stats = machine.stats();
  console.log(`\n--- machine ${state} (exit ${machine.exitCode}) ---`);
  console.log(`instructions: ${stats.instructions.toLocaleString()}  virtual time: ${(stats.mtime / 1e6).toFixed(3)} s`);
  restoreAndExit(machine.exitCode === 0 ? 0 : 1);
}

async function cmdWeb(args: string[]): Promise<void> {
  const { startWebServer } = await import("./host/server.ts");
  let port = 8080;
  let host = "127.0.0.1";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" && args[i + 1]) port = Number(args[++i]);
    else if (args[i] === "--host" && args[i + 1]) host = args[++i];
  }
  await startWebServer({ port, host });
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "build":
      await cmdBuild();
      break;
    case "run":
      await cmdRun(rest);
      break;
    case "web":
      await cmdWeb(rest);
      break;
    case "script":
      if (!rest[0]) {
        console.error("script requires a file argument");
        process.exit(2);
      }
      await cmdScript(rest[0]);
      break;
    case "--help":
    case "-h":
    case undefined:
      usage();
      break;
    default:
      console.error(`unknown command '${command}'`);
      usage();
      process.exit(2);
  }
}

const isMain = process.argv[1] !== undefined && process.argv[1].replace(/\\/g, "/").endsWith("src/cli.ts");
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
