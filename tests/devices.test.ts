import { test } from "node:test";
import assert from "node:assert/strict";
import { Bus } from "../src/vm/memory.ts";
import { Clint, GoldfishRtc, Plic, SystemControl, Uart, VirtioBlk } from "../src/vm/devices.ts";
import { Cpu } from "../src/vm/cpu.ts";

const UART_BASE = 0x10000000;
const CLINT_BASE = 0x02000000;
const PLIC_BASE = 0x0c000000;
const VIRTIO_BASE = 0x10001000;
const SYS_BASE = 0x10003000;
const RTC_BASE = 0x10100000;

function makeBus(diskSize = 4096) {
  const bus = new Bus();
  const output: number[] = [];
  const uart = new Uart(UART_BASE, (b) => output.push(b));
  const clint = new Clint(CLINT_BASE);
  const plic = new Plic(PLIC_BASE);
  const sys = new SystemControl(SYS_BASE);
  const rtc = new GoldfishRtc(RTC_BASE);
  const disk = new Uint8Array(diskSize);
  const virtio = new VirtioBlk(VIRTIO_BASE, disk, bus, () => {});
  bus.addDevice(clint);
  bus.addDevice(plic);
  bus.addDevice(uart);
  bus.addDevice(virtio);
  bus.addDevice(sys);
  bus.addDevice(rtc);
  return { bus, uart, clint, plic, sys, rtc, virtio, disk, output };
}

test("uart transmits bytes and queues input", () => {
  const { bus, output, uart } = makeBus();
  bus.write8(UART_BASE, 0x48);
  bus.write8(UART_BASE, 0x69);
  assert.deepEqual(output, [0x48, 0x69]);
  assert.equal(bus.read8(UART_BASE + 5) & 0x20, 0x20); // transmitter empty
  assert.equal(bus.read8(UART_BASE + 5) & 0x01, 0); // no data waiting
  uart.receive(0x41);
  assert.equal(bus.read8(UART_BASE + 5) & 0x01, 1);
  assert.equal(bus.read8(UART_BASE), 0x41);
  assert.equal(bus.read8(UART_BASE + 5) & 0x01, 0);
});

test("uart interrupt line follows IER and the receive queue", () => {
  const { bus, uart } = makeBus();
  assert.equal(uart.line(), false);
  uart.receive(0x7a);
  assert.equal(uart.line(), false); // interrupts not enabled yet
  bus.write8(UART_BASE + 1, 0x01);
  assert.equal(uart.line(), true);
  assert.equal(bus.read8(UART_BASE), 0x7a);
  assert.equal(uart.line(), false);
});

test("clint timer compare registers are 64-bit", () => {
  const { bus, clint } = makeBus();
  bus.write32(CLINT_BASE + 0x4000, 0xffffffff);
  bus.write32(CLINT_BASE + 0x4004, 1);
  assert.equal(clint.mtimecmp, 0x1ffffffff);
  clint.setTime(0x1fffffff0);
  assert.equal(clint.timerPending(), false);
  clint.setTime(0x1ffffffff);
  assert.equal(clint.timerPending(), true);
  assert.equal(bus.read32(CLINT_BASE + 0xbff8), 0xffffffff);
  assert.equal(bus.read32(CLINT_BASE + 0xbffc), 1);
});

test("plic priorities, enables, claims and completions", () => {
  const { bus, plic } = makeBus();
  bus.write32(PLIC_BASE + 4 * 1, 3); // priority of source 1
  bus.write32(PLIC_BASE + 0x2000, 0x2); // enable source 1
  bus.write32(PLIC_BASE + 0x200000, 0); // threshold
  assert.equal(plic.hartLine(), false);
  plic.setLine(1, true);
  assert.equal(plic.hartLine(), true);
  assert.equal(bus.read32(PLIC_BASE + 0x200004), 1); // claim
  assert.equal(plic.hartLine(), false);
  plic.setLine(1, false);
  bus.write32(PLIC_BASE + 0x200004, 1); // complete
  assert.equal(plic.hartLine(), false);
});

test("system control registers drive poweroff and reset", () => {
  const { bus, sys } = makeBus();
  bus.write32(SYS_BASE, 7);
  assert.equal(bus.read32(SYS_BASE), 7);
  bus.write32(SYS_BASE + 4, 0x5555);
  assert.equal(sys.poweroff, true);
  const second = makeBus();
  second.bus.write32(SYS_BASE + 4, 0x7777);
  assert.equal(second.sys.reset, true);
});

test("goldfish rtc reports a plausible unix time", () => {
  const { rtc } = makeBus();
  const seconds = rtc.read(4, 4) + rtc.read(0, 4) * 4294967296;
  const now = Math.floor(Date.now() / 1000);
  assert.ok(Math.abs(seconds - now) < 5);
});

test("virtio-blk modern handshake and identity registers", () => {
  const { bus } = makeBus(64 * 512);
  assert.equal(bus.read32(VIRTIO_BASE + 0x000), 0x74726976);
  assert.equal(bus.read32(VIRTIO_BASE + 0x004), 2); // modern
  assert.equal(bus.read32(VIRTIO_BASE + 0x008), 2); // block device
  assert.equal(bus.read32(VIRTIO_BASE + 0x100), 64); // capacity in sectors
  bus.write32(VIRTIO_BASE + 0x014, 1);
  assert.equal(bus.read32(VIRTIO_BASE + 0x010), 1); // VIRTIO_F_VERSION_1
});

test("virtio-blk performs a read request through the descriptor chain", () => {
  const { bus, disk, virtio } = makeBus(16 * 512);
  for (let i = 0; i < 512; i++) disk[i] = i & 0xff;

  const DESC = 0x80001000;
  const AVAIL = 0x80002000;
  const USED = 0x80003000;
  const HDR = 0x80000200;
  const BUF = 0x80004000;
  const STATUS = 0x80000300;

  // Descriptor chain: header (read-only) -> data (device writes) -> status.
  bus.write32(DESC + 0, HDR);
  bus.write32(DESC + 4, 0);
  bus.write32(DESC + 8, 16);
  bus.write16(DESC + 12, 1);
  bus.write16(DESC + 14, 1);
  bus.write32(DESC + 16, BUF);
  bus.write32(DESC + 20, 0);
  bus.write32(DESC + 24, 512);
  bus.write16(DESC + 28, 3);
  bus.write16(DESC + 30, 2);
  bus.write32(DESC + 32, STATUS);
  bus.write32(DESC + 36, 0);
  bus.write32(DESC + 40, 1);
  bus.write16(DESC + 44, 0);
  bus.write16(DESC + 46, 0);

  bus.write32(HDR, 0); // VIRTIO_BLK_T_IN
  bus.write32(HDR + 8, 1); // sector 1
  bus.write32(AVAIL + 2, 1);
  bus.write16(AVAIL + 4, 0); // head index

  bus.write32(VIRTIO_BASE + 0x030, 0);
  bus.write32(VIRTIO_BASE + 0x038, 8);
  bus.write32(VIRTIO_BASE + 0x074, DESC);
  bus.write32(VIRTIO_BASE + 0x078, 0);
  bus.write32(VIRTIO_BASE + 0x080, AVAIL);
  bus.write32(VIRTIO_BASE + 0x084, 0);
  bus.write32(VIRTIO_BASE + 0x090, USED);
  bus.write32(VIRTIO_BASE + 0x094, 0);
  bus.write32(VIRTIO_BASE + 0x044, 1);
  bus.write32(VIRTIO_BASE + 0x070, 15);
  bus.write32(VIRTIO_BASE + 0x050, 1); // notify

  assert.equal(bus.read8(STATUS), 0); // success
  assert.equal(bus.read16(USED + 2), 1); // used index advanced
  assert.equal(bus.read32(USED + 4), 0); // head id
  assert.equal(bus.read32(USED + 8), 512); // bytes written
  assert.equal(bus.read8(BUF), disk[512]);
  assert.equal(bus.read8(BUF + 511), disk[1023]);
  assert.equal(bus.read32(VIRTIO_BASE + 0x060), 1); // interrupt status set
  assert.equal(virtio.line(), true);
  bus.write32(VIRTIO_BASE + 0x064, 1);
  assert.equal(virtio.line(), false);
});

test("bus faults on unmapped access and misaligned device access", () => {
  const { bus } = makeBus();
  assert.throws(() => bus.read32(0x00001000), /access fault/);
  assert.throws(() => bus.write32(0xdeadbe00, 1), /access fault/);
  assert.throws(() => bus.read32(UART_BASE + 2), /access fault/); // misaligned
  // Misalignment on RAM is tolerated by the bus; the CPU raises the architectural
  // exception before this code is ever reached (see the cpu tests).
  assert.equal(bus.read32(0x80000001) >>> 0, bus.read8(0x80000001));
});

test("cpu raises misaligned load and store exceptions", () => {
  const { bus } = makeBus();
  bus.load(0x80000000, new Uint8Array([
    // lw a0, 1(zero)  -> load address misaligned
    0x03, 0x25, 0x10, 0x00,
    // sw a0, 2(zero)  -> store address misaligned
    0x23, 0x21, 0xa0, 0x00,
  ]));
  const cpu = new Cpu(bus);
  cpu.reset(0x80000000);
  cpu.mtvec = 0x80000000;
  cpu.step();
  assert.equal(cpu.mcause, 4);
  assert.equal(cpu.mtval, 1);
  cpu.mepc = 0x80000004;
  cpu.pc = 0x80000004;
  cpu.step();
  assert.equal(cpu.mcause, 6);
  assert.equal(cpu.mtval, 2);
});

test("cpu instruction fetch faults when the pc leaves memory", () => {
  const { bus } = makeBus();
  const cpu = new Cpu(bus);
  cpu.reset(0x90000000);
  cpu.step();
  assert.equal(cpu.mcause, 1); // instruction access fault
  assert.equal(cpu.mtval, 0x90000000);
});
