/** Capture screenshots of the web terminal with a headless browser.
 *
 * A tiny dependency-free CDP client (raw WebSocket over node:net) drives
 * Chrome: it opens the page, types a few shell commands, and saves a PNG.
 *
 *   node scripts/screenshot.ts --out docs/web-terminal.png --port 8150
 */

import { spawn, type ChildProcess } from "node:child_process";
import { connect as netConnect, type Socket } from "node:net";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

class WebSocketClient {
  private socket: Socket;
  private buffer = Buffer.alloc(0);
  private onMessage: (text: string) => void;
  private onOpen: () => void;

  constructor(port: number, path: string, onOpen: () => void, onMessage: (text: string) => void) {
    this.onOpen = onOpen;
    this.onMessage = onMessage;
    if (process.env.TYPEVM_DEBUG) console.error("[cdp] connecting", port, path);
    this.socket = netConnect(port, "127.0.0.1");
    this.socket.on("error", (error) => { if (process.env.TYPEVM_DEBUG) console.error("[cdp] socket error", error.message); });
    this.socket.on("data", (chunk) => {
      if (process.env.TYPEVM_DEBUG) console.error("[cdp] raw bytes", chunk.length, chunk.subarray(0, 40).toString("hex"));
      this.receive(chunk);
    });
    this.socket.on("connect", () => {
      const key = Buffer.from(Math.random().toString(16).slice(2)).toString("base64");
      this.socket.write(
        `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
    });
  }

  private handshaked = false;
  private queue: string[] = [];

  private receive(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (!this.handshaked) {
      const end = this.buffer.indexOf("\r\n\r\n");
      if (end < 0) return;
      const statusLine = this.buffer.subarray(0, end).toString("utf8").split("\r\n")[0];
      if (process.env.TYPEVM_DEBUG) console.error("[cdp]", statusLine);
      this.buffer = this.buffer.subarray(end + 4);
      this.handshaked = true;
      this.onOpen();
      const queued = this.queue;
      this.queue = [];
      for (const message of queued) this.writeFrame(message);
    }
    for (;;) {
      if (this.buffer.length < 2) return;
      const second = this.buffer[1];
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        length = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }
      if (this.buffer.length < offset + length) return;
      const payload = this.buffer.subarray(offset, offset + length);
      this.buffer = this.buffer.subarray(offset + length);
      this.onMessage(payload.toString("utf8"));
    }
  }

  send(text: string): void {
    if (!this.handshaked) {
      this.queue.push(text);
      return;
    }
    this.writeFrame(text);
  }

  private writeFrame(text: string): void {
    const payload = Buffer.from(text, "utf8");
    const mask = Buffer.from([1, 2, 3, 4]);
    let header: Buffer;
    if (payload.length < 126) {
      header = Buffer.from([0x81, 0x80 | payload.length]);
    } else if (payload.length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    const masked = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4];
    const frame = Buffer.concat([header, mask, masked]);
    if (process.env.TYPEVM_DEBUG) console.error("[cdp] write frame", frame.subarray(0, 8).toString("hex"));
    this.socket.write(frame);
  }

  close(): void {
    this.socket.destroy();
  }
}

async function waitFor(fn: () => Promise<boolean>, timeoutMs = 20000, intervalMs = 150): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("timed out waiting for condition");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const getArg = (name: string, fallback: string): string => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  const out = getArg("--out", join(root, "docs/web-terminal.png"));
  const port = Number(getArg("--port", "8150"));
  const debugPort = Number(getArg("--debug-port", "9222"));

  const chrome = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!chrome) throw new Error("no chrome/edge binary found");

  const server = spawn(process.execPath, [join(root, "src/cli.ts"), "web", "--port", String(port)], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (d) => process.stdout.write(String(d)));

  await waitFor(async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      return res.ok;
    } catch {
      return false;
    }
  });

  const profile = join(process.env.TEMP ?? "/tmp", "type-vm1-chrome-profile");
  const browser: ChildProcess = spawn(chrome, [
    "--headless=old",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    "--no-sandbox",
    "--mute-audio",
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${debugPort}`,
    "--window-size=1280,860",
    "about:blank",
  ], { stdio: "ignore" });

  let target: { webSocketDebuggerUrl: string } | undefined;
  await waitFor(async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const list = (await res.json()) as { type: string; webSocketDebuggerUrl: string }[];
      target = list.find((t) => t.type === "page");
      return target !== undefined;
    } catch {
      return false;
    }
  });
  if (!target) throw new Error("no debug target");

  const url = new URL(target.webSocketDebuggerUrl);
  let nextId = 0;
  const pending = new Map<number, (value: unknown) => void>();
  const client = new WebSocketClient(
    Number(url.port),
    url.pathname,
    () => {},
    (text) => {
      if (process.env.TYPEVM_DEBUG) console.error("[cdp] <<", text.slice(0, 120));
      const message = JSON.parse(text) as { id?: number; result?: unknown };
      if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id)!(message.result);
        pending.delete(message.id);
      }
    },
  );

  const call = (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, resolve);
      if (process.env.TYPEVM_DEBUG) console.error("[cdp] >>", method, id);
      client.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 15000);
    });
  };

  await new Promise((r) => setTimeout(r, 300));
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
  await call("Page.navigate", { url: `http://127.0.0.1:${port}/` });
  await new Promise((r) => setTimeout(r, 2500));

  // Type a short demo session into the emulated console.
  const typeText = async (text: string): Promise<void> => {
    for (const ch of text) {
      const key = ch === "\r" ? "Enter" : ch;
      await call("Input.dispatchKeyEvent", { type: "keyDown", key, text: ch === "\r" ? "\r" : ch });
      await call("Input.dispatchKeyEvent", { type: "keyUp", key });
      await new Promise((r) => setTimeout(r, 12));
    }
  };
  const commands = getArg("--commands", "ls,run HELLO,run FIB,test").split(",").map((c) => c.trim()).filter(Boolean);
  await call("Runtime.evaluate", { expression: "document.getElementById('screen').focus()" });
  for (const command of commands) {
    await typeText(command + "\r");
    await new Promise((r) => setTimeout(r, 1100));
  }

  const shot = (await call("Page.captureScreenshot", { format: "png" })) as { data: string };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(shot.data, "base64"));
  console.log(`screenshot written to ${out}`);

  client.close();
  browser.kill();
  server.kill();
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
