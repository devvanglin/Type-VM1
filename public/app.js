// Type-VM1 web terminal client.
//
// The browser owns a character grid that mirrors what the guest wrote to its
// UART.  Keystrokes go back to the emulated machine over HTTP; output arrives
// through a server-sent-events stream.  The page is deliberately bare: pure
// black, one monospace font, no chrome.  Everything else lives in the guest.

const screen = document.getElementById("screen");

const ROWS = 200;
const COLS = 200;
const BLINK_IDLE_MS = 500;

let sessionId = null;
let source = null;
let grid = [];
let cursorRow = 0;
let cursorCol = 0;
let pendingChar = "";
let renderScheduled = false;
let lastInputAt = 0;
let cursorIdle = false;
let blinkTimer = null;

function blankGrid() {
  grid = [];
  for (let r = 0; r < ROWS; r++) grid.push(new Array(COLS).fill(" "));
  cursorRow = 0;
  cursorCol = 0;
}

function scroll() {
  grid.shift();
  grid.push(new Array(COLS).fill(" "));
  cursorRow = Math.max(0, cursorRow - 1);
}

function newline() {
  cursorRow++;
  if (cursorRow >= ROWS) scroll();
}

function putChar(ch) {
  if (ch === "\r") {
    cursorCol = 0;
    return;
  }
  if (ch === "\n") {
    newline();
    return;
  }
  if (ch === "\b") {
    if (cursorCol > 0) cursorCol--;
    return;
  }
  if (ch === "\u0007") return;

  if (ch === "\u001b") {
    pendingChar = "\u001b";
    return;
  }
  if (pendingChar === "\u001b") {
    if (ch === "[") {
      pendingChar = "\u001b[";
      return;
    }
    pendingChar = "";
  } else if (pendingChar === "\u001b[") {
    pendingChar = "\u001b[" + ch;
    if (/[A-Za-z]/.test(ch)) {
      handleCsi(pendingChar.slice(2));
      pendingChar = "";
    }
    return;
  }

  if (ch === "\t") {
    const next = (Math.floor(cursorCol / 8) + 1) * 8;
    while (cursorCol < next && cursorCol < COLS) grid[cursorRow][cursorCol++] = " ";
    return;
  }
  if (cursorCol >= COLS) {
    cursorCol = 0;
    newline();
  }
  grid[cursorRow][cursorCol++] = ch;
}

function handleCsi(sequence) {
  // Only the handful of sequences the guest actually emits are supported.
  if (sequence === "2J") {
    blankGrid();
  } else if (sequence === "H") {
    cursorRow = 0;
    cursorCol = 0;
  } else if (sequence === "K") {
    for (let c = cursorCol; c < COLS; c++) grid[cursorRow][c] = " ";
  }
}

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function render() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    const rows = [];
    for (let r = 0; r < ROWS; r++) rows.push(grid[r].join("").replace(/\s+$/, ""));
    let lastNonEmpty = ROWS - 1;
    while (lastNonEmpty > 0 && rows[lastNonEmpty] === "") lastNonEmpty--;
    const before = rows.slice(0, cursorRow);
    const line = rows[cursorRow] ?? "";
    const padded = line + " ".repeat(Math.max(0, cursorCol - line.length));
    const head = padded.slice(0, cursorCol);
    const tail = padded.slice(cursorCol + 1);
    const idle = Date.now() - lastInputAt > BLINK_IDLE_MS;
    cursorIdle = idle;
    const cursorChar = (padded[cursorCol] ?? " ") === " " ? " " : escapeHtml(padded[cursorCol]);
    const html =
      before.map(escapeHtml).join("\n") +
      (before.length > 0 ? "\n" : "") +
      escapeHtml(head) +
      '<span class="cursor' + (idle ? " idle" : "") + '">' + cursorChar + "</span>" +
      escapeHtml(tail);
    screen.innerHTML = html;
    screen.scrollTop = screen.scrollHeight;
  });
}

async function start() {
  if (source) source.close();
  blankGrid();
  render();
  try {
    const response = await fetch("/api/session", { method: "POST" });
    const data = await response.json();
    sessionId = data.id;
  } catch {
    screen.textContent = "cannot reach the Type-VM1 host process\n";
    return;
  }
  source = new EventSource(`/api/stream?id=${sessionId}`);
  source.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "output") {
      for (const ch of message.text) putChar(ch);
      render();
    }
  };
  source.onerror = () => {
    // The host went away; say so in the terminal rather than in a banner.
    for (const ch of "\r\n[connection to the host lost]\r\n") putChar(ch);
    render();
  };
  poll();
}

async function send(text) {
  if (!sessionId) return;
  lastInputAt = Date.now();
  render();
  try {
    await fetch("/api/input", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: sessionId, data: text }),
    });
  } catch {
    /* the next poll will notice */
  }
}

async function poll() {
  if (!sessionId) return;
  try {
    const response = await fetch(`/api/status?id=${sessionId}`);
    if (response.ok) {
      const data = await response.json();
      if (data.state === "halted" || data.state === "reset") {
        for (const ch of `\r\n[machine ${data.state}]\r\n`) putChar(ch);
        render();
        sessionId = null;
        if (source) source.close();
        return;
      }
    }
  } catch {
    /* the host process may be restarting */
  }
  setTimeout(poll, 700);
}

const KEY_MAP = {
  Enter: "\r",
  Backspace: "\u007f",
  Tab: "\t",
  Escape: "\u001b",
  ArrowUp: "\u001b[A",
  ArrowDown: "\u001b[B",
  ArrowRight: "\u001b[C",
  ArrowLeft: "\u001b[D",
  Home: "\u001b[H",
  End: "\u001b[F",
  Delete: "\u001b[3~",
};

screen.addEventListener("keydown", (event) => {
  if (event.ctrlKey && !event.altKey && !event.metaKey) {
    const key = event.key.toLowerCase();
    if (key === "c" || key === "l" || key === "u") {
      event.preventDefault();
      send(String.fromCharCode(key.charCodeAt(0) - 96)); // ^C ^L ^U
      return;
    }
  }
  const mapped = KEY_MAP[event.key];
  if (mapped !== undefined) {
    event.preventDefault();
    send(mapped);
    return;
  }
  if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    send(event.key);
  }
});

screen.addEventListener("paste", (event) => {
  event.preventDefault();
  const text = (event.clipboardData || window.clipboardData).getData("text");
  if (text) send(text.replace(/\r?\n/g, "\r"));
});

screen.addEventListener("mousedown", () => screen.focus());
window.addEventListener("focus", () => screen.focus());

// Optional autoplay: /?demo=ls,run%20HELLO,test types the commands once the
// machine has booted.  Used by scripts/screenshot.ts and for demos.
const DEMO_COMMANDS = new URLSearchParams(location.search).get("demo");

async function autoplay(commands) {
  await new Promise((resolve) => setTimeout(resolve, 1800));
  for (const command of commands) {
    for (const ch of command) {
      await send(ch);
      await new Promise((resolve) => setTimeout(resolve, 35));
    }
    await send("\r");
    await new Promise((resolve) => setTimeout(resolve, 900));
  }
}

blankGrid();
render();
start();
screen.focus();

// Blink the cursor only when the idle state actually flips, so an idle page
// does not rewrite the DOM (which would destroy any text selection).
blinkTimer = setInterval(() => {
  const idle = Date.now() - lastInputAt > BLINK_IDLE_MS;
  if (idle !== cursorIdle) render();
}, 300);
void blinkTimer;

if (DEMO_COMMANDS) {
  autoplay(DEMO_COMMANDS.split(",").filter((c) => c.length > 0));
}
