/** The Type-VM1 platform: memory map, device wiring, virtual clock and run loop. */

import { Cpu } from "./cpu.ts";
import { Clint, GoldfishRtc, Plic, SystemControl, Uart, VirtioBlk, VIRTIO_IRQ } from "./devices.ts";
import { Bus, RAM_BASE, RAM_SIZE } from "./memory.ts";

export const MAP = {
  ramBase: RAM_BASE,
  ramSize: RAM_SIZE,
  clint: 0x02000000,
  plic: 0x0c000000,
  uart: 0x10000000,
  virtio: 0x10001000,
  sysctl: 0x10003000,
  rtc: 0x10100000,
  /** Where user-mode programs are loaded by the guest kernel. */
  userBase: 0x80400000,
  userStackTop: 0x80500000,
} as const;

/** Instructions per CLINT tick.  The virtual timer runs at 1 MHz, the CPU at 10 MIPS. */
export const INSTRUCTIONS_PER_TICK = 10;

export type MachineState = "running" | "halted" | "reset" | "stalled";

export interface MachineOptions {
  kernel: Uint8Array;
  kernelBase?: number;
  kernelEntry?: number;
  disk?: Uint8Array;
  onOutput?: (text: string) => void;
  sliceInstructions?: number;
}

export class Machine {
  bus: Bus;
  cpu: Cpu;
  uart: Uart;
  clint: Clint;
  plic: Plic;
  virtio: VirtioBlk;
  rtc: GoldfishRtc;
  sys: SystemControl;
  state: MachineState = "running";
  exitCode = 0;
  idleTicks = 0;
  outputBytes = 0;
  private onOutput: (text: string) => void;
  private sliceInstructions: number;
  private wfiCount = 0;

  constructor(options: MachineOptions) {
    this.onOutput = options.onOutput ?? (() => {});
    this.sliceInstructions = options.sliceInstructions ?? 20000;
    this.bus = new Bus(MAP.ramSize, MAP.ramBase);

    this.plic = new Plic(MAP.plic);
    this.uart = new Uart(MAP.uart, (byte) => this.emitByte(byte), () => {
      this.plic.setLine(10, this.uart.line());
    });
    this.clint = new Clint(MAP.clint);
    const disk = options.disk ?? new Uint8Array(64 * 1024);
    this.virtio = new VirtioBlk(MAP.virtio, disk, this.bus, () => {
      this.plic.setLine(VIRTIO_IRQ, this.virtio.line());
    });
    this.rtc = new GoldfishRtc(MAP.rtc);
    this.sys = new SystemControl(MAP.sysctl);
    this.bus.addDevice(this.clint);
    this.bus.addDevice(this.plic);
    this.bus.addDevice(this.uart);
    this.bus.addDevice(this.virtio);
    this.bus.addDevice(this.sys);
    this.bus.addDevice(this.rtc);

    const base = options.kernelBase ?? MAP.ramBase;
    if (options.kernel.length > MAP.ramSize) throw new Error("kernel image does not fit in RAM");
    this.bus.load(base, options.kernel);
    this.cpu = new Cpu(this.bus);
    this.cpu.reset(options.kernelEntry ?? base);
    this.updateClock();
  }

  private emitByte(byte: number): void {
    this.outputBytes++;
    this.onOutput(String.fromCharCode(byte & 0xff));
  }

  /** Feed console input into the UART receive queue. */
  feed(text: string | Uint8Array): void {
    if (typeof text === "string") {
      for (let i = 0; i < text.length; i++) this.uart.receive(text.charCodeAt(i) & 0xff);
    } else {
      for (const b of text) this.uart.receive(b);
    }
  }

  get totalInstructions(): number {
    return this.cpu.steps;
  }

  get mtime(): number {
    return this.clint.mtime;
  }

  private updateClock(): void {
    const time = Math.floor(this.cpu.steps / INSTRUCTIONS_PER_TICK) + this.idleTicks;
    this.clint.setTime(time);
    this.cpu.time = time;
    let mip = 0;
    if (this.clint.timerPending()) mip |= 0x80;
    if (this.plic.hartLine()) mip |= 0x800;
    if (this.clint.msip !== 0) mip |= 0x8;
    this.cpu.setMip(mip);
  }

  /** Fast-forward virtual time to the next timer deadline while halted in WFI. */
  private handleWfi(): void {
    const now = Math.floor(this.cpu.steps / INSTRUCTIONS_PER_TICK) + this.idleTicks;
    const deadline = this.clint.mtimecmp;
    if (deadline > now && deadline - now < 100_000_000) {
      this.idleTicks += deadline - now;
    } else {
      this.idleTicks += 1000;
    }
    this.wfiCount++;
    this.updateClock();
  }

  /** Run up to `budget` instructions.  Returns the machine state. */
  executeSlice(budget = this.sliceInstructions): MachineState {
    for (let i = 0; i < budget; i++) {
      if ((i & 31) === 0) this.updateClock();
      const status = this.cpu.step();
      if (status === "wfi") {
        this.handleWfi();
        if (this.wfiCount > 100_000) {
          this.state = "stalled";
          return this.state;
        }
        continue;
      }
      this.wfiCount = 0;
      if (this.sys.poweroff) {
        this.exitCode = this.sys.exitCode;
        this.state = "halted";
        return this.state;
      }
      if (this.sys.reset) {
        this.state = "reset";
        return this.state;
      }
      if (this.sys.yieldRequested) {
        this.sys.yieldRequested = false;
        return this.state;
      }
    }
    this.updateClock();
    return this.state;
  }

  /** Run the machine, yielding to the host event loop between slices. */
  async run(options: { maxInstructions?: number; timeoutMs?: number; sliceInstructions?: number } = {}): Promise<MachineState> {
    const slice = options.sliceInstructions ?? this.sliceInstructions;
    const deadline = options.timeoutMs !== undefined ? Date.now() + options.timeoutMs : undefined;
    const limit = options.maxInstructions;
    while (this.state === "running") {
      if (limit !== undefined && this.cpu.steps >= limit) break;
      if (deadline !== undefined && Date.now() > deadline) break;
      this.executeSlice(slice);
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    return this.state;
  }

  /** Run synchronously until the machine stops (useful for scripted tests). */
  runSync(options: { maxInstructions?: number; timeoutMs?: number; sliceInstructions?: number } = {}): MachineState {
    const deadline = options.timeoutMs !== undefined ? Date.now() + options.timeoutMs : undefined;
    const limit = options.maxInstructions ?? 200_000_000;
    while (this.state === "running" && this.cpu.steps < limit) {
      if (deadline !== undefined && Date.now() > deadline) break;
      this.executeSlice(options.sliceInstructions ?? 100_000);
    }
    return this.state;
  }

  stats(): {
    instructions: number;
    mtime: number;
    outputBytes: number;
    diskRequests: number;
    bytesRead: number;
    bytesWritten: number;
  } {
    return {
      instructions: this.cpu.steps,
      mtime: this.clint.mtime,
      outputBytes: this.outputBytes,
      diskRequests: this.virtio.requests,
      bytesRead: this.virtio.bytesRead,
      bytesWritten: this.virtio.bytesWritten,
    };
  }
}
