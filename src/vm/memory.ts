/** Physical memory map, RAM and MMIO dispatch. */

export const RAM_BASE = 0x80000000;
export const RAM_SIZE = 16 * 1024 * 1024;

export type AccessKind = "instr" | "load" | "store";

export class BusFault extends Error {
  kind: AccessKind;
  addr: number;

  constructor(kind: AccessKind, addr: number) {
    super(`${kind} access fault at 0x${(addr >>> 0).toString(16)}`);
    this.name = "BusFault";
    this.kind = kind;
    this.addr = addr >>> 0;
  }
}

export interface Device {
  name: string;
  base: number;
  size: number;
  read(offset: number, width: number): number;
  write(offset: number, width: number, value: number): void;
}

export class Bus {
  ram: Uint8Array;
  ramBase: number;
  devices: Device[] = [];

  constructor(ramSize = RAM_SIZE, ramBase = RAM_BASE) {
    this.ram = new Uint8Array(ramSize);
    this.ramBase = ramBase >>> 0;
  }

  get ramEnd(): number {
    return (this.ramBase + this.ram.length) >>> 0;
  }

  addDevice(dev: Device): void {
    this.devices.push(dev);
    this.devices.sort((a, b) => a.base - b.base);
  }

  findDevice(addr: number): Device | undefined {
    for (const d of this.devices) {
      if (addr >= d.base && addr < d.base + d.size) return d;
    }
    return undefined;
  }

  read8(addr: number): number {
    const a = addr >>> 0;
    if (a >= this.ramBase && a < this.ramEnd) return this.ram[a - this.ramBase];
    const d = this.findDevice(a);
    if (!d) throw new BusFault("load", a);
    return d.read(a - d.base, 1) & 0xff;
  }

  read16(addr: number): number {
    const a = addr >>> 0;
    if (a >= this.ramBase && a + 1 < this.ramEnd && (a & 1) === 0) {
      const o = a - this.ramBase;
      return this.ram[o] | (this.ram[o + 1] << 8);
    }
    if (a >= this.ramBase && a + 1 < this.ramEnd) {
      return this.read8(a) | (this.read8(a + 1) << 8);
    }
    const d = this.findDevice(a);
    if (!d) throw new BusFault("load", a);
    if ((a & 1) !== 0) throw new BusFault("load", a);
    return d.read(a - d.base, 2) & 0xffff;
  }

  read32(addr: number): number {
    const a = addr >>> 0;
    if (a >= this.ramBase && a + 3 < this.ramEnd && (a & 3) === 0) {
      const o = a - this.ramBase;
      return (this.ram[o] | (this.ram[o + 1] << 8) | (this.ram[o + 2] << 16) | (this.ram[o + 3] << 24)) >>> 0;
    }
    if (a >= this.ramBase && a + 3 < this.ramEnd) {
      return (this.read8(a) | (this.read8(a + 1) << 8) | (this.read8(a + 2) << 16) | (this.read8(a + 3) << 24)) >>> 0;
    }
    const d = this.findDevice(a);
    if (!d) throw new BusFault("load", a);
    if ((a & 3) !== 0) throw new BusFault("load", a);
    return d.read(a - d.base, 4) >>> 0;
  }

  write8(addr: number, value: number): void {
    const a = addr >>> 0;
    if (a >= this.ramBase && a < this.ramEnd) { this.ram[a - this.ramBase] = value & 0xff; return; }
    const d = this.findDevice(a);
    if (!d) throw new BusFault("store", a);
    d.write(a - d.base, 1, value & 0xff);
  }

  write16(addr: number, value: number): void {
    const a = addr >>> 0;
    if (a >= this.ramBase && a + 1 < this.ramEnd && (a & 1) === 0) {
      const o = a - this.ramBase;
      this.ram[o] = value & 0xff;
      this.ram[o + 1] = (value >>> 8) & 0xff;
      return;
    }
    if (a >= this.ramBase && a + 1 < this.ramEnd) {
      this.write8(a, value);
      this.write8(a + 1, value >>> 8);
      return;
    }
    const d = this.findDevice(a);
    if (!d) throw new BusFault("store", a);
    if ((a & 1) !== 0) throw new BusFault("store", a);
    d.write(a - d.base, 2, value & 0xffff);
  }

  write32(addr: number, value: number): void {
    const a = addr >>> 0;
    if (a >= this.ramBase && a + 3 < this.ramEnd && (a & 3) === 0) {
      const o = a - this.ramBase;
      this.ram[o] = value & 0xff;
      this.ram[o + 1] = (value >>> 8) & 0xff;
      this.ram[o + 2] = (value >>> 16) & 0xff;
      this.ram[o + 3] = (value >>> 24) & 0xff;
      return;
    }
    if (a >= this.ramBase && a + 3 < this.ramEnd) {
      this.write8(a, value);
      this.write8(a + 1, value >>> 8);
      this.write8(a + 2, value >>> 16);
      this.write8(a + 3, value >>> 24);
      return;
    }
    const d = this.findDevice(a);
    if (!d) throw new BusFault("store", a);
    if ((a & 3) !== 0) throw new BusFault("store", a);
    d.write(a - d.base, 4, value >>> 0);
  }

  /** Load a flat image into RAM (used by the kernel loader). */
  load(addr: number, data: Uint8Array): void {
    const a = addr >>> 0;
    if (a < this.ramBase || a + data.length > this.ramEnd) {
      throw new RangeError(`image 0x${a.toString(16)}+${data.length} does not fit in RAM`);
    }
    this.ram.set(data, a - this.ramBase);
  }
}
