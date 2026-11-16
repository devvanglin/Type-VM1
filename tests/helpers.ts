/** Shared helpers for the Type-VM1 test suite. */

import { assemble, type AssembleOptions } from "../src/asm/assembler.ts";
import { Bus } from "../src/vm/memory.ts";
import { Cpu } from "../src/vm/cpu.ts";
import { Machine } from "../src/vm/machine.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { projectRoot } from "../src/cli.ts";

export interface RunResult {
  cpu: Cpu;
  bus: Bus;
  regs: number[];
  trap: { cause: number; tval: number; epc: number; interrupt: boolean } | null;
  steps: number;
}

/** Assemble a snippet, run it for at most `limit` instructions and return the hart. */
export function runSnippet(source: string, limit = 5000, stopPc?: number): RunResult {
  const result = assemble(source, { file: "test.asm" });
  const bus = new Bus();
  bus.load(result.base, result.image);
  const cpu = new Cpu(bus);
  cpu.reset(result.entry);
  let trap: RunResult["trap"] = null;
  let steps = 0;
  cpu.onTrap = (info) => {
    if (trap === null) trap = info;
  };
  const endPc = stopPc ?? 0;
  while (steps < limit) {
    if (endPc !== 0 && cpu.pc === endPc) break;
    const status = cpu.step();
    steps++;
    if (status === "wfi" || status === "halt") break;
  }
  return { cpu, bus, regs: Array.from(cpu.regs), trap, steps };
}

export interface KernelOutput {
  text: string;
  machine: Machine;
  state: string;
}

/** Boot the built kernel image and feed it console input. */
export function runKernel(input: string, options: { maxInstructions?: number } = {}): KernelOutput {
  const kernel = new Uint8Array(readFileSync(join(projectRoot, "build/kernel.bin")));
  const disk = new Uint8Array(readFileSync(join(projectRoot, "build/disk.img")));
  let text = "";
  const machine = new Machine({ kernel, disk, onOutput: (chunk) => { text += chunk; } });
  machine.feed(input);
  machine.runSync({ maxInstructions: options.maxInstructions ?? 30_000_000 });
  return { text: text.replace(/\r/g, ""), machine, state: machine.state };
}

export function assembleOk(source: string, options?: AssembleOptions) {
  return assemble(source, options);
}
