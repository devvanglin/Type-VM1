/** Build the guest kernel, user programs and the TVFS disk image. */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assembleFile } from "../src/asm/assembler.ts";
import { buildTvfs, type DiskFile } from "../src/host/tvfs.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const buildDir = join(root, "build");

export interface BuildSummary {
  kernelSize: number;
  kernelInstructions: number;
  programs: { name: string; size: number }[];
  diskSize: number;
  files: DiskFile[];
}

function buildKernel(): { size: number; instructions: number } {
  const result = assembleFile(join(root, "guest/kernel/kernel.asm"), { listing: true });
  writeFileSync(join(buildDir, "kernel.bin"), result.image);
  writeFileSync(join(buildDir, "kernel.lst"), result.listing);
  const symbols: Record<string, string> = {};
  for (const [name, value] of result.symbols) symbols[name] = `0x${value.toString(16)}`;
  writeFileSync(join(buildDir, "kernel.sym.json"), JSON.stringify(symbols, null, 2));
  return { size: result.image.length, instructions: result.instrCount };
}

function buildPrograms(): { files: DiskFile[]; summary: { name: string; size: number }[] } {
  const dir = join(root, "guest/user");
  const files: DiskFile[] = [];
  const summary: { name: string; size: number }[] = [];
  mkdirSync(join(buildDir, "user"), { recursive: true });
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".asm")) continue;
    const result = assembleFile(join(dir, file), { listing: true });
    const name = file.replace(/\.asm$/, "").toUpperCase() + ".TVX";
    const image = new Uint8Array(16 + result.image.length);
    image.set([0x54, 0x56, 0x58, 0x31], 0); // "TVX1"
    const view = new DataView(image.buffer);
    view.setUint32(4, (result.entry - result.base) >>> 0, true);
    view.setUint32(8, result.image.length, true);
    view.setUint32(12, 1, true);
    image.set(result.image, 16);
    writeFileSync(join(buildDir, "user", name), image);
    writeFileSync(join(buildDir, "user", file.replace(/\.asm$/, ".lst")), result.listing);
    files.push({ name, data: image });
    summary.push({ name, size: image.length });
  }
  return { files, summary };
}

function buildDisk(programs: DiskFile[]): { size: number; files: DiskFile[] } {
  const diskDir = join(root, "guest/disk");
  const files: DiskFile[] = [...programs];
  for (const file of readdirSync(diskDir).sort()) {
    const data = readFileSync(join(diskDir, file));
    files.push({ name: file.toUpperCase(), data: new Uint8Array(data) });
  }
  const image = buildTvfs(files, 2048);
  writeFileSync(join(buildDir, "disk.img"), image);
  return { size: image.length, files };
}

export function buildAll(): BuildSummary {
  mkdirSync(buildDir, { recursive: true });
  const kernel = buildKernel();
  const programs = buildPrograms();
  const disk = buildDisk(programs.files);
  return {
    kernelSize: kernel.size,
    kernelInstructions: kernel.instructions,
    programs: programs.summary,
    diskSize: disk.size,
    files: disk.files,
  };
}

const isMain = process.argv[1] !== undefined && process.argv[1].replace(/\\/g, "/").endsWith("scripts/build.ts");
if (isMain) {
  const summary = buildAll();
  console.log(`kernel    : ${summary.kernelSize} bytes, ${summary.kernelInstructions} instructions`);
  console.log(`programs  : ${summary.programs.map((p) => `${p.name}(${p.size})`).join(", ")}`);
  console.log(`disk image: ${summary.diskSize} bytes, files: ${summary.files.map((f) => f.name).join(", ")}`);
}
