/** Emulated devices: 16550 UART, CLINT timer, PLIC, virtio-mmio block disk, goldfish RTC, system control. */

import type { Bus, Device } from "./memory.ts";

// ---------------------------------------------------------------------------
// UART 16550-compatible console
// ---------------------------------------------------------------------------

export class Uart implements Device {
  name = "uart0";
  base: number;
  size = 0x100;
  private ier = 0;
  private lcr = 0;
  private mcr = 0;
  private scr = 0;
  private rx: number[] = [];
  tx: (byte: number) => void;
  onLineChange: () => void;

  constructor(base: number, tx: (byte: number) => void, onLineChange: () => void = () => {}) {
    this.base = base;
    this.tx = tx;
    this.onLineChange = onLineChange;
  }

  receive(byte: number): void {
    if (this.rx.length > 4096) this.rx.shift();
    this.rx.push(byte & 0xff);
    this.onLineChange();
  }

  get hasData(): boolean {
    return this.rx.length > 0;
  }

  /** Interrupt line: receive-data-available with IER bit 0 enabled. */
  line(): boolean {
    return this.rx.length > 0 && (this.ier & 0x01) !== 0;
  }

  read(offset: number, _width: number): number {
    switch (offset & 7) {
      case 0: {
        const b = this.rx.length > 0 ? (this.rx.shift() as number) : 0;
        if (this.rx.length === 0) this.onLineChange();
        return b;
      }
      case 1: return this.ier;
      case 2: return this.line() ? 0x04 : 0xc1;
      case 3: return this.lcr;
      case 4: return this.mcr;
      case 5: return 0x60 | (this.rx.length > 0 ? 0x01 : 0x00);
      case 6: return 0xb0;
      case 7: return this.scr;
      default: return 0;
    }
  }

  write(offset: number, _width: number, value: number): void {
    switch (offset & 7) {
      case 0:
        this.tx(value & 0xff);
        break;
      case 1:
        this.ier = value & 0x0f;
        this.onLineChange();
        break;
      case 2:
        // FCR: the emulated FIFOs are always "enabled"; never discard input.
        break;
      case 3: this.lcr = value & 0xff; break;
      case 4: this.mcr = value & 0xff; break;
      case 7: this.scr = value & 0xff; break;
      default: break;
    }
  }
}

// ---------------------------------------------------------------------------
// CLINT (timer + software interrupt registers)
// ---------------------------------------------------------------------------

export class Clint implements Device {
  name = "clint";
  base: number;
  size = 0x10000;
  mtimecmp = 0xffffffffffff;
  msip = 0;
  mtime = 0;

  constructor(base: number) {
    this.base = base;
  }

  setTime(t: number): void {
    this.mtime = t;
  }

  timerPending(): boolean {
    return this.mtime >= this.mtimecmp;
  }

  read(offset: number, _width: number): number {
    switch (offset) {
      case 0x0000: return this.msip;
      case 0x4000: return this.mtimecmp & 0xffffffff;
      case 0x4004: return Math.floor(this.mtimecmp / 4294967296) & 0xffffffff;
      case 0xbff8: return this.mtime & 0xffffffff;
      case 0xbffc: return Math.floor(this.mtime / 4294967296) & 0xffffffff;
      default: return 0;
    }
  }

  write(offset: number, _width: number, value: number): void {
    const v = value >>> 0;
    switch (offset) {
      case 0x0000: this.msip = v & 1; break;
      case 0x4000: this.mtimecmp = Math.floor(this.mtimecmp / 4294967296) * 4294967296 + v; break;
      case 0x4004: this.mtimecmp = v * 4294967296 + (this.mtimecmp % 4294967296); break;
      case 0xbff8: this.mtime = Math.floor(this.mtime / 4294967296) * 4294967296 + v; break;
      case 0xbffc: this.mtime = v * 4294967296 + (this.mtime % 4294967296); break;
      default: break;
    }
  }
}

// ---------------------------------------------------------------------------
// PLIC (platform-level interrupt controller, single hart context)
// ---------------------------------------------------------------------------

const PLIC_MAX_SOURCES = 32;

export class Plic implements Device {
  name = "plic";
  base: number;
  size = 0x1000000;
  private priority = new Uint32Array(PLIC_MAX_SOURCES);
  private enabled = 0;
  private threshold = 0;
  private claimed = new Set<number>();
  private lines = new Set<number>();
  onLineChange: () => void;

  constructor(base: number, onLineChange: () => void = () => {}) {
    this.base = base;
    this.onLineChange = onLineChange;
  }

  setLine(id: number, high: boolean): void {
    if (high) this.lines.add(id);
    else {
      this.lines.delete(id);
      this.claimed.delete(id);
    }
    this.onLineChange();
  }

  private pendingBits(): number {
    let bits = 0;
    for (const id of this.lines) {
      if (!this.claimed.has(id)) bits |= 1 << id;
    }
    return bits >>> 0;
  }

  private bestPending(): number {
    let best = 0;
    let bestPriority = this.threshold;
    for (const id of this.lines) {
      if (this.claimed.has(id)) continue;
      if ((this.enabled & (1 << id)) === 0) continue;
      const p = this.priority[id];
      if (p > bestPriority) {
        bestPriority = p;
        best = id;
      }
    }
    return best;
  }

  hartLine(): boolean {
    return this.bestPending() !== 0;
  }

  read(offset: number, _width: number): number {
    if (offset >= 0x200000) {
      if (offset === 0x200000) return this.threshold;
      if (offset === 0x200004) {
        const id = this.bestPending();
        if (id !== 0) {
          this.claimed.add(id);
          this.onLineChange();
        }
        return id;
      }
      return 0;
    }
    if (offset >= 0x2000 && offset < 0x2100) {
      return (offset - 0x2000) * 8 === 0 ? this.enabled : 0;
    }
    if (offset >= 0x1000 && offset < 0x1080) {
      return offset === 0x1000 ? this.pendingBits() : 0;
    }
    if (offset < 0x1000) {
      const id = offset >>> 2;
      return id < PLIC_MAX_SOURCES ? this.priority[id] : 0;
    }
    return 0;
  }

  write(offset: number, _width: number, value: number): void {
    const v = value >>> 0;
    if (offset === 0x200000) { this.threshold = v; this.onLineChange(); return; }
    if (offset === 0x200004) {
      this.claimed.delete(v);
      this.onLineChange();
      return;
    }
    if (offset >= 0x2000 && offset < 0x2100) {
      this.enabled = v;
      this.onLineChange();
      return;
    }
    if (offset < 0x1000 && (offset & 3) === 0) {
      const id = offset >>> 2;
      if (id < PLIC_MAX_SOURCES) {
        this.priority[id] = v & 7;
        this.onLineChange();
      }
    }
  }
}

// ---------------------------------------------------------------------------
// virtio-mmio block device (modern, version 2)
// ---------------------------------------------------------------------------

export const VIRTIO_IRQ = 1;

const VIRTIO_STATUS_ACKNOWLEDGE = 1;
const VIRTIO_STATUS_DRIVER = 2;
const VIRTIO_STATUS_DRIVER_OK = 4;
const VIRTIO_STATUS_FEATURES_OK = 8;

const VIRTQ_DESC_F_NEXT = 1;
const VIRTQ_DESC_F_WRITE = 2;

const VIRTIO_BLK_T_IN = 0;
const VIRTIO_BLK_T_OUT = 1;

const SECTOR_SIZE = 512;

export class VirtioBlk implements Device {
  name = "virtio-blk";
  base: number;
  size = 0x1000;
  disk: Uint8Array;
  bus: Bus;
  onLineChange: () => void;

  private status = 0;
  private featuresSel = 0;
  private driverFeatures = 0;
  private queueSel = 0;
  private queueNum = 0;
  private queueReady = 0;
  private queueDesc = 0;
  private queueDriver = 0;
  private queueDevice = 0;
  private interruptStatus = 0;
  private lastAvailIdx = 0;
  private usedIdx = 0;
  private configGeneration = 0;
  /** Set when the driver asks for a reset; the machine recreates the device. */
  resetRequested = false;
  requests = 0;
  bytesRead = 0;
  bytesWritten = 0;

  constructor(base: number, disk: Uint8Array, bus: Bus, onLineChange: () => void) {
    this.base = base;
    this.disk = disk;
    this.bus = bus;
    this.onLineChange = onLineChange;
  }

  get capacitySectors(): number {
    return Math.floor(this.disk.length / SECTOR_SIZE);
  }

  line(): boolean {
    return this.interruptStatus !== 0;
  }

  read(offset: number, _width: number): number {
    if (offset >= 0x100) return this.readConfig(offset - 0x100);
    switch (offset) {
      case 0x000: return 0x74726976;
      case 0x004: return 2;
      case 0x008: return 2;
      case 0x00c: return 0x54595631;
      case 0x010: return this.featuresSel === 0 ? 0 : 1; // VIRTIO_F_VERSION_1
      case 0x014: return this.featuresSel;
      case 0x020: return this.driverFeatures & 0xffffffff;
      case 0x024: return Math.floor(this.driverFeatures / 4294967296) & 0xffffffff;
      case 0x030: return this.queueSel;
      case 0x034: return 8;
      case 0x038: return this.queueNum;
      case 0x03c: return 0;
      case 0x040: return 0;
      case 0x044: return this.queueReady;
      case 0x060: return this.interruptStatus;
      case 0x070: return this.status;
      case 0x074: return this.queueDesc & 0xffffffff;
      case 0x078: return Math.floor(this.queueDesc / 4294967296) & 0xffffffff;
      case 0x080: return this.queueDriver & 0xffffffff;
      case 0x084: return Math.floor(this.queueDriver / 4294967296) & 0xffffffff;
      case 0x090: return this.queueDevice & 0xffffffff;
      case 0x094: return Math.floor(this.queueDevice / 4294967296) & 0xffffffff;
      case 0x0fc: return this.configGeneration;
      default: return 0;
    }
  }

  private readConfig(offset: number): number {
    if (offset === 0) return this.capacitySectors & 0xffffffff;
    if (offset === 4) return Math.floor(this.capacitySectors / 4294967296) & 0xffffffff;
    return 0;
  }

  write(offset: number, _width: number, value: number): void {
    const v = value >>> 0;
    switch (offset) {
      case 0x014: this.featuresSel = v; break;
      case 0x020: this.driverFeatures = (this.driverFeatures & 0xffffffff00000000) + v; break;
      case 0x024: this.driverFeatures = v * 4294967296 + (this.driverFeatures & 0xffffffff); break;
      case 0x030: this.queueSel = v; break;
      case 0x038: this.queueNum = v; break;
      case 0x044:
        this.queueReady = v & 1;
        if (this.queueReady === 0) {
          this.lastAvailIdx = 0;
          this.usedIdx = 0;
        }
        break;
      case 0x050:
        if (this.queueReady) this.processQueue();
        break;
      case 0x064:
        this.interruptStatus &= ~v;
        this.onLineChange();
        break;
      case 0x070:
        this.writeStatus(v);
        break;
      case 0x074: this.queueDesc = (this.queueDesc & 0xffffffff00000000) + v; break;
      case 0x078: this.queueDesc = v * 4294967296 + (this.queueDesc & 0xffffffff); break;
      case 0x080: this.queueDriver = (this.queueDriver & 0xffffffff00000000) + v; break;
      case 0x084: this.queueDriver = v * 4294967296 + (this.queueDriver & 0xffffffff); break;
      case 0x090: this.queueDevice = (this.queueDevice & 0xffffffff00000000) + v; break;
      case 0x094: this.queueDevice = v * 4294967296 + (this.queueDevice & 0xffffffff); break;
      default: break;
    }
  }

  private writeStatus(v: number): void {
    if (v === 0) {
      this.status = 0;
      this.queueReady = 0;
      this.lastAvailIdx = 0;
      this.usedIdx = 0;
      this.driverFeatures = 0;
      return;
    }
    this.status = v & 0xff;
  }

  private processQueue(): void {
    if (this.queueNum === 0 || this.queueDesc === 0 || this.queueDriver === 0 || this.queueDevice === 0) return;
    const bus = this.bus;
    const availIdx = bus.read16(this.queueDriver + 2) & 0xffff;
    let guard = 0;
    while (this.lastAvailIdx !== availIdx && guard++ < 16) {
      const slot = this.lastAvailIdx % this.queueNum;
      const head = bus.read16(this.queueDriver + 4 + slot * 2);
      this.lastAvailIdx = (this.lastAvailIdx + 1) >>> 0;
      let outLength = 0;
      try {
        outLength = this.handleRequest(head);
      } catch {
        outLength = 0;
      }
      const usedSlot = this.usedIdx % this.queueNum;
      bus.write32(this.queueDevice + 4 + usedSlot * 8, head);
      bus.write32(this.queueDevice + 4 + usedSlot * 8 + 4, outLength);
      this.usedIdx = (this.usedIdx + 1) >>> 0;
      bus.write16(this.queueDevice + 2, this.usedIdx & 0xffff);
    }
    if (guard > 0 || this.lastAvailIdx !== availIdx) {
      this.interruptStatus |= 1;
      this.onLineChange();
    }
  }

  private desc(addr: number, i: number): { addr: number; len: number; flags: number; next: number } {
    const base = addr + i * 16;
    const lo = this.bus.read32(base);
    const hi = this.bus.read32(base + 4);
    return {
      addr: lo + hi * 4294967296,
      len: this.bus.read32(base + 8),
      flags: this.bus.read16(base + 12),
      next: this.bus.read16(base + 14),
    };
  }

  private handleRequest(head: number): number {
    const d0 = this.desc(this.queueDesc, head);
    if ((d0.flags & VIRTQ_DESC_F_NEXT) === 0) return 0;
    const d1 = this.desc(this.queueDesc, d0.next);
    if ((d1.flags & VIRTQ_DESC_F_NEXT) === 0) return 0;
    const d2 = this.desc(this.queueDesc, d1.next);
    if (d0.len < 16) return 0;

    const type = this.bus.read32(d0.addr);
    const sectorLow = this.bus.read32(d0.addr + 8);
    const sectorHigh = this.bus.read32(d0.addr + 12);
    const sector = sectorLow + sectorHigh * 4294967296;
    this.requests++;

    let status = 0;
    const capacity = this.capacitySectors;
    if (sector + Math.ceil(d1.len / SECTOR_SIZE) > capacity) {
      status = 1;
    } else if (type === VIRTIO_BLK_T_IN) {
      for (let i = 0; i < d1.len; i++) {
        const idx = sector * SECTOR_SIZE + i;
        const byte = idx < this.disk.length ? this.disk[idx] : 0;
        this.bus.write8(d1.addr + i, byte);
      }
      this.bytesRead += d1.len;
    } else if (type === VIRTIO_BLK_T_OUT) {
      for (let i = 0; i < d1.len; i++) {
        const idx = sector * SECTOR_SIZE + i;
        if (idx < this.disk.length) this.disk[idx] = this.bus.read8(d1.addr + i);
      }
      this.bytesWritten += d1.len;
    } else {
      status = 1;
    }
    this.bus.write8(d2.addr, status);
    return d1.len;
  }
}

// ---------------------------------------------------------------------------
// Goldfish RTC
// ---------------------------------------------------------------------------

export class GoldfishRtc implements Device {
  name = "rtc";
  base: number;
  size = 0x1000;

  constructor(base: number) {
    this.base = base;
  }

  read(offset: number, _width: number): number {
    const seconds = Math.floor(Date.now() / 1000);
    if (offset === 0) return Math.floor(seconds / 4294967296) & 0xffffffff;
    if (offset === 4) return seconds & 0xffffffff;
    return 0;
  }

  write(_offset: number, _width: number, _value: number): void {
    // A real RTC would allow setting the time; the demo clock is host time.
  }
}

// ---------------------------------------------------------------------------
// System control (poweroff / reset / yield)
// ---------------------------------------------------------------------------

export class SystemControl implements Device {
  name = "sysctl";
  base: number;
  size = 0x100;
  exitCode = 0;
  poweroff = false;
  reset = false;
  yieldRequested = false;

  constructor(base: number) {
    this.base = base;
  }

  read(offset: number, _width: number): number {
    switch (offset) {
      case 0x00: return this.exitCode;
      case 0x10: return this.poweroff ? 1 : 0;
      default: return 0;
    }
  }

  write(offset: number, _width: number, value: number): void {
    const v = value >>> 0;
    switch (offset) {
      case 0x00: this.exitCode = v; break;
      case 0x04:
        if (v === 0x5555) this.poweroff = true;
        else if (v === 0x7777) this.reset = true;
        break;
      case 0x08: this.yieldRequested = true; break;
      default: break;
    }
  }
}
