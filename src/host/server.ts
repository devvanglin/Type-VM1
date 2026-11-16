/** HTTP server that hosts the Type-VM1 web terminal.
 *
 * The page is a dependency-free ES module that talks to the machine over a
 * server-sent-events stream (output) and a POST endpoint (input).  Starting a
 * session creates a fresh virtual machine; reloading the page gives a brand
 * new machine, as if you had pressed the reset button.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Machine } from "../vm/machine.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const publicDir = join(root, "public");

interface Session {
  id: string;
  machine: Machine;
  clients: Set<ServerResponse>;
  pending: string[];
  timer: NodeJS.Timeout | null;
  created: number;
}

const sessions = new Map<string, Session>();

function loadArtifacts(): { kernel: Uint8Array; disk: Uint8Array } {
  const kernelPath = join(root, "build", "kernel.bin");
  const diskPath = join(root, "build", "disk.img");
  if (!existsSync(kernelPath) || !existsSync(diskPath)) {
    throw new Error("build artifacts missing: run 'node src/cli.ts build'");
  }
  return {
    kernel: new Uint8Array(readFileSync(kernelPath)),
    disk: new Uint8Array(readFileSync(diskPath)),
  };
}

/** Drop sessions that nobody is watching and that have been idle for a while. */
function sweepSessions(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.clients.size === 0 && now - session.created > 10 * 60_000) {
      sessions.delete(id);
    }
  }
}

function createSession(): Session {
  const artifacts = loadArtifacts();
  const session: Session = {
    id: randomUUID(),
    machine: null as unknown as Machine,
    clients: new Set(),
    pending: [],
    timer: null,
    created: Date.now(),
  };
  session.machine = new Machine({
    kernel: artifacts.kernel,
    disk: artifacts.disk,
    onOutput: (text) => {
      session.pending.push(text);
      if (!session.timer) scheduleFlush(session);
    },
  });
  return session;
}

function scheduleFlush(session: Session): void {
  session.timer = setTimeout(() => {
    session.timer = null;
    flush(session);
  }, 8);
}

function flush(session: Session): void {
  if (session.pending.length === 0) return;
  const payload = session.pending.join("");
  session.pending = [];
  const frame = `data: ${JSON.stringify({ type: "output", text: payload })}\n\n`;
  for (const client of session.clients) client.write(frame);
}

/** Pump the machine between host frames so the browser stays interactive. */
function tick(session: Session): void {
  const machine = session.machine;
  if (machine.state !== "running") {
    flush(session);
    broadcast(session, { type: "state", state: machine.state, exitCode: machine.exitCode });
    if (session.timer) {
      clearTimeout(session.timer);
      session.timer = null;
    }
    return;
  }
  const started = Date.now();
  while (Date.now() - started < 12 && machine.state === "running") {
    machine.executeSlice(20_000);
  }
  setImmediate(() => tick(session));
}

function broadcast(session: Session, message: unknown): void {
  const frame = `data: ${JSON.stringify(message)}\n\n`;
  for (const client of session.clients) client.write(frame);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function serveStatic(res: ServerResponse, path: string): void {
  const file = join(publicDir, path === "/" ? "index.html" : path);
  if (!file.startsWith(publicDir) || !existsSync(file)) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
    return;
  }
  const ext = file.slice(file.lastIndexOf("."));
  res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream", "cache-control": "no-store" });
  res.end(readFileSync(file));
}

export interface ServerOptions {
  port: number;
  host: string;
  /** Called once the server is listening (used by tests). */
  onListening?: (url: string) => void;
  /** Stop after this many milliseconds (used by tests). */
  autoStopMs?: number;
}

export function startWebServer(options: ServerOptions): Promise<{ close: () => void; url: string }> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    try {
      if (url.pathname === "/api/session" && req.method === "POST") {
        const session = createSession();
        sessions.set(session.id, session);
        setImmediate(() => tick(session));
        sendJson(res, 200, { id: session.id });
        return;
      }
      if (url.pathname === "/api/stream" && req.method === "GET") {
        const session = sessions.get(url.searchParams.get("id") ?? "");
        if (!session) {
          sendJson(res, 404, { error: "no such session" });
          return;
        }
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        res.write(`data: ${JSON.stringify({ type: "hello", id: session.id })}\n\n`);
        session.clients.add(res);
        const keepAlive = setInterval(() => res.write(": ping\n\n"), 15_000);
        if (session.pending.length > 0) flush(session);
        req.on("close", () => {
          clearInterval(keepAlive);
          session.clients.delete(res);
        });
        return;
      }
      if (url.pathname === "/api/input" && req.method === "POST") {
        const body = await readBody(req);
        const { id, data } = JSON.parse(body) as { id: string; data: string };
        const session = sessions.get(id);
        if (!session) {
          sendJson(res, 404, { error: "no such session" });
          return;
        }
        session.machine.feed(data);
        sendJson(res, 200, { ok: true });
        return;
      }
      if (url.pathname === "/api/status" && req.method === "GET") {
        const session = sessions.get(url.searchParams.get("id") ?? "");
        if (!session) {
          sendJson(res, 404, { error: "no such session" });
          return;
        }
        const machine = session.machine;
        sendJson(res, 200, {
          state: machine.state,
          exitCode: machine.exitCode,
          pc: `0x${machine.cpu.pc.toString(16)}`,
          mode: machine.cpu.mode === 3 ? "M" : "U",
          stats: machine.stats(),
        });
        return;
      }
      serveStatic(res, url.pathname);
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  const sweeper = setInterval(sweepSessions, 60_000);
  sweeper.unref?.();

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(options.port, options.host, () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : options.port;
      const url = `http://${options.host}:${actualPort}`;
      console.log(`Type-VM1 web terminal: ${url}`);
      options.onListening?.(url);
      resolve({
        close: () => {
          clearInterval(sweeper);
          for (const session of sessions.values()) {
            for (const client of session.clients) client.end();
          }
          sessions.clear();
          server.close();
        },
        url,
      });
    });
  });
}
