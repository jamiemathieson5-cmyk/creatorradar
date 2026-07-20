/**
 * Headed Chrome login helper — export TikLeap cookies for Get leads.
 * Forces a dedicated Chrome profile + remote debugging (won't reuse your
 * everyday Chrome window).
 */
const fs = require("fs");
const path = require("path");
const { spawn, execSync } = require("child_process");
const http = require("http");
const net = require("net");
const readline = require("readline");
const {
  profileDir,
  cookiesPath,
  exportCookiesFromSession,
} = require("../server/tikleap");

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
];

const DEVTOOLS_URL_RE = /DevTools listening on (ws:\/\/[^\s]+)/;

function findChrome() {
  if (
    process.env.LEAD_FINDER_CHROME &&
    fs.existsSync(process.env.LEAD_FINDER_CHROME)
  ) {
    return process.env.LEAD_FINDER_CHROME;
  }
  for (const c of CHROME_CANDIDATES) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on("error", reject);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function reserveFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
    server.on("error", reject);
  });
}

/** Stop any Chrome still holding the TikLeap profile lock. */
function releaseProfileLock(userDataDir) {
  try {
    execSync(
      `pkill -f ${JSON.stringify(`--user-data-dir=${userDataDir}`)} || true`,
      { stdio: "ignore" }
    );
  } catch {
    // ignore
  }
  for (const name of [
    "SingletonLock",
    "SingletonSocket",
    "SingletonCookie",
  ]) {
    try {
      fs.unlinkSync(path.join(userDataDir, name));
    } catch {
      // ignore
    }
  }
}

class CdpSession {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      let msg;
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || "CDP error"));
        else resolve(msg.result);
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      // ignore
    }
  }
}

async function askEnter(prompt) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  await new Promise((resolve) => {
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

async function waitForDebugger(port, child, timeoutMs = 25000) {
  const started = Date.now();
  let stderrBuf = "";
  if (child.stderr) {
    child.stderr.on("data", (chunk) => {
      stderrBuf += chunk.toString("utf8");
      if (stderrBuf.length > 64_000) stderrBuf = stderrBuf.slice(-48_000);
    });
  }
  if (child.stdout) {
    child.stdout.on("data", (chunk) => {
      stderrBuf += chunk.toString("utf8");
    });
  }

  while (Date.now() - started < timeoutMs) {
    if (child.exitCode != null) {
      throw new Error(
        `Chrome exited before debugging started (code=${child.exitCode}). ` +
          `Detail: ${stderrBuf.slice(-400) || "(no output)"}`
      );
    }
    const match = DEVTOOLS_URL_RE.exec(stderrBuf);
    if (match) return match[1].trim();
    try {
      const version = await httpGetJson(
        `http://127.0.0.1:${port}/json/version`
      );
      if (version?.webSocketDebuggerUrl) return version.webSocketDebuggerUrl;
    } catch {
      // keep waiting
    }
    await sleep(200);
  }
  throw new Error(
    `Could not attach to Chrome debugging port ${port}. ` +
      `Quit any leftover “TikLeap login” Chrome windows, then retry. ` +
      `Detail: ${stderrBuf.slice(-400) || "(no DevTools output — Chrome may have reused your main browser)"}`
  );
}

async function main() {
  const chromePath = findChrome();
  if (!chromePath) {
    console.error("Chrome not found. Install Google Chrome and retry.");
    process.exit(1);
  }

  const userDataDir = profileDir();
  fs.mkdirSync(userDataDir, { recursive: true });
  console.log("Releasing any previous TikLeap Chrome profile lock…");
  releaseProfileLock(userDataDir);
  await sleep(500);

  const port = await reserveFreePort();
  const args = [
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
    "--remote-allow-origins=*",
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=Translate",
    "--new-window",
    "https://www.tikleap.com/",
  ];

  console.log(`Chrome: ${chromePath}`);
  console.log(`Profile: ${userDataDir}`);
  console.log(`Debug port: ${port}`);
  console.log("");
  console.log("1) A SEPARATE Chrome window opens (not your everyday Chrome).");
  console.log("2) Log into TikLeap with Premium in THAT window.");
  console.log("3) Open any creator profile and confirm history is NOT ???");
  console.log("4) Return here and press Enter to save cookies.\n");

  const child = spawn(chromePath, args, {
    stdio: ["ignore", "pipe", "pipe"],
    // Keep attached to this process group so we can see DevTools logs.
    detached: false,
  });

  let wsUrl;
  try {
    wsUrl = await waitForDebugger(port, child);
  } catch (error) {
    try {
      child.kill("SIGKILL");
    } catch {
      // ignore
    }
    console.error(error.message || error);
    process.exit(1);
  }

  console.log("Attached to Chrome debug port.\n");
  await askEnter("Press Enter after Premium login is ready… ");

  const session = new CdpSession(wsUrl);
  await session.connect();

  let sessionId = null;
  try {
    const targets = await httpGetJson(`http://127.0.0.1:${port}/json/list`);
    const page =
      (Array.isArray(targets) &&
        targets.find(
          (t) => t.type === "page" && /tikleap\.com/i.test(t.url || "")
        )) ||
      (Array.isArray(targets) && targets.find((t) => t.type === "page"));

    if (page?.id) {
      const attached = await session.send("Target.attachToTarget", {
        targetId: page.id,
        flatten: true,
      });
      sessionId = attached.sessionId;
    }
  } catch {
    // fall through to createTarget
  }

  if (!sessionId) {
    const created = await session.send("Target.createTarget", {
      url: "https://www.tikleap.com/",
    });
    const attached = await session.send("Target.attachToTarget", {
      targetId: created.targetId,
      flatten: true,
    });
    sessionId = attached.sessionId;
  }

  const exported = await exportCookiesFromSession(session, sessionId);
  session.close();

  if (!exported.count) {
    console.error(
      "No TikLeap cookies captured. Stay on tikleap.com while logged in in the debug Chrome window, then retry."
    );
    process.exit(1);
  }

  console.log(
    `Saved ${exported.count} cookie(s) → ${cookiesPath()}\n` +
      `You can close the TikLeap Chrome window. Then hard-refresh CreatorRadar and Get leads.`
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
