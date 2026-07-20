require("./wsPolyfill");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const net = require("net");
const { extractCandidatesFromPayload } = require("./leadsParse");
const {
  MANUAL_REFRESH_LIMIT,
  MIN_DIAMONDS_L30,
  MAX_DIAMONDS_L30,
  MAX_DIAMONDS_CURRENT_MONTH,
  MAX_TIKLEAP_CHROME_TABS,
  resolveTikleapLookupWorkers,
} = require("./constants");
const {
  updateRefreshProgress,
  isRefreshProgressStuck,
} = require("./refreshProgress");
const {
  buildUserDetailUrls,
  profileUrlForUsername,
  parseUserDetailPayload,
  parseRegionFromProfileHtml,
  isConfirmedGbEvidence,
  classifyResolveOutcome,
  summarizeLookupResponse,
} = require("./regionResolve");
const {
  isGbRegion,
  isNonGbRegion,
  hasUkFlagEmoji,
  hasConfirmedNonGbEvidence,
  hasPositiveGbEvidence,
} = require("./regionFilter");
const {
  createTikleapClient,
  launchTikleapChrome,
  minimizeChromeWindow,
  createBackgroundTarget,
  isPreferredDiamondBand,
  isDiamondsKnown,
  isInactiveDiamondsL30,
  shouldKeepForDiamonds,
  hasLoginProfile,
  cookiesPath,
  profileDir,
} = require("./tikleap");
const { recordScrapedUids } = require("./scrapedUids");
const { addLeads } = require("./store");

function usernameKey(username) {
  return String(username || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

/**
 * Chrome for Testing / headless-shell first (no macOS GUI registration),
 * then regular Chrome / Chromium / Edge.
 */
const CHROME_CANDIDATES = [
  path.join(
    os.homedir(),
    "chrome-headless-shell",
    "chrome-headless-shell"
  ),
  path.join(
    os.homedir(),
    ".cache",
    "puppeteer",
    "chrome-headless-shell"
  ),
  "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];

const FEED_URL_HINTS = [
  "/webcast/feed",
  "channel_id=86",
  "tiktok_live_suggested",
  "/live/recommend",
  "/webcast/room/recommend",
  "related_live",
  "live/room",
];

const DEVTOOLS_URL_RE = /DevTools listening on (ws:\/\/[^\s]+)/;
const DEBUG_PORT_RE = /ws:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):(\d+)\//;

const CURSOR_TRANSFORM_HINT =
  "Chrome crashes when launched from Cursor on this Mac (TransformProcessType / HIServices). " +
  "Run the server from Terminal.app outside Cursor: cd lead-finder && ./start.sh — then use Refresh.";

function findChromeBinaries() {
  const found = [];
  const seen = new Set();

  const add = (candidate) => {
    if (!candidate || seen.has(candidate)) return;
    seen.add(candidate);
    if (fs.existsSync(candidate)) found.push(candidate);
  };

  if (process.env.LEAD_FINDER_CHROME) add(process.env.LEAD_FINDER_CHROME);
  if (process.env.LEAD_FINDER_CHROME_PATH) add(process.env.LEAD_FINDER_CHROME_PATH);
  if (process.env.CHROME_PATH) add(process.env.CHROME_PATH);
  if (process.env.GOOGLE_CHROME_BIN) add(process.env.GOOGLE_CHROME_BIN);
  add("/usr/bin/chromium");
  add("/usr/bin/chromium-browser");
  add("/usr/bin/google-chrome-stable");

  // Puppeteer / Playwright cache layouts vary by version — scan shallowly.
  const cacheRoots = [
    path.join(os.homedir(), ".cache", "puppeteer"),
    path.join(os.homedir(), "Library", "Caches", "ms-playwright"),
  ];
  for (const root of cacheRoots) {
    try {
      if (!fs.existsSync(root)) continue;
      for (const entry of fs.readdirSync(root)) {
        const base = path.join(root, entry);
        add(path.join(base, "chrome-headless-shell"));
        add(path.join(base, "chrome-headless-shell-mac-arm64", "chrome-headless-shell"));
        add(path.join(base, "chrome-headless-shell-mac-x64", "chrome-headless-shell"));
        add(path.join(base, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"));
        add(path.join(base, "chrome-mac", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"));
      }
    } catch {
      // ignore
    }
  }

  for (const candidate of CHROME_CANDIDATES) add(candidate);
  return found;
}

function findChrome() {
  return findChromeBinaries()[0] || null;
}

function isHeadlessShell(binaryPath) {
  return /chrome-headless-shell/i.test(String(binaryPath || ""));
}

function httpGetJson(url, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.setTimeout(Math.max(250, Number(timeoutMs) || 2500), () => {
      req.destroy(new Error(`HTTP timeout after ${timeoutMs}ms`));
    });
    req.on("error", reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function reserveFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : null;
      server.close((err) => {
        if (err) reject(err);
        else if (!port) reject(new Error("Could not reserve a free local port."));
        else resolve(port);
      });
    });
    server.on("error", reject);
  });
}

function snippet(text, max = 800) {
  const cleaned = String(text || "")
    .replace(/\x1b\[[0-9;]*m/g, "")
    .trim();
  if (!cleaned) return "";
  if (cleaned.length <= max) return cleaned;
  return `…${cleaned.slice(-max)}`;
}

/**
 * Strip Electron/Cursor/VS Code env that makes Chrome think it is inside
 * another GUI app (responsible process = Cursor → TransformProcessType abort).
 */
function sanitizedChromeEnv() {
  const env = {};
  const keepExact = new Set([
    "HOME",
    "USER",
    "LOGNAME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TZ",
    "DISPLAY",
    "XPC_FLAGS",
    "XPC_SERVICE_NAME",
    "SSH_AUTH_SOCK",
  ]);

  for (const [key, value] of Object.entries(process.env)) {
    if (value == null) continue;
    if (/^ELECTRON_/i.test(key)) continue;
    if (/^CURSOR_/i.test(key)) continue;
    if (/^VSCODE_/i.test(key)) continue;
    if (/^TERM_PROGRAM/i.test(key)) continue;
    if (/^__CF/i.test(key) && /vscode|cursor|electron/i.test(String(value))) continue;
    if (keepExact.has(key) || key === "PATH" || key.startsWith("LC_")) {
      env[key] = value;
    }
  }

  env.PATH =
    process.env.PATH ||
    "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin";
  env.HOME = process.env.HOME || os.homedir();
  env.TMPDIR = process.env.TMPDIR || os.tmpdir();

  // Explicitly clear — empty string can still confuse some Chromium builds.
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ASAR;

  return env;
}

function looksLikeCursorHosted() {
  if (process.env.CURSOR_SANDBOX || process.env.CURSOR_AGENT) return true;
  if (/Cursor\.app/i.test(process.execPath || "")) return true;
  if (/Cursor\.app/i.test(process.env.VSCODE_PID ? process.execPath : "")) return true;
  try {
    // Parent often remains a Cursor agent shell even when env is cleaned.
    const ppid = process.ppid;
    if (!ppid) return false;
  } catch {
    // ignore
  }
  return /Cursor\.app/i.test(process.execPath || "");
}

function buildChromeArgs({ port, userDataDir, headlessMode, extraFlags = [] }) {
  const headlessFlag =
    headlessMode === "old"
      ? "--headless"
      : headlessMode === "shell"
        ? "--headless=new"
        : "--headless=new";

  return [
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${userDataDir}`,
    headlessFlag,
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-extensions",
    "--disable-features=Translate,BackForwardCache",
    "--disable-component-update",
    "--mute-audio",
    "--lang=en-GB",
    "--window-size=1440,900",
    ...extraFlags,
    "about:blank",
  ];
}

function killProcessTree(child) {
  if (!child?.pid) return;
  try {
    // Kill the whole process group started with detached:true.
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
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
    this.events = new Map();
  }

  async connect(timeoutMs = 12000) {
    this.ws = new WebSocket(this.wsUrl);

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        try {
          this.ws?.close();
        } catch {
          // ignore
        }
        reject(new Error(`CDP WebSocket connect timeout after ${timeoutMs}ms`));
      }, Math.max(1000, Number(timeoutMs) || 12000));
      this.ws.addEventListener(
        "open",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true }
      );
      this.ws.addEventListener(
        "error",
        (err) => {
          clearTimeout(timer);
          reject(err || new Error("CDP WebSocket error"));
        },
        { once: true }
      );
    });

    this.ws.addEventListener("message", (event) => {
      let msg;
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }

      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (timer) clearTimeout(timer);
        if (msg.error) reject(new Error(msg.error.message || "CDP error"));
        else resolve(msg.result);
        return;
      }

      if (msg.method) {
        const handlers = this.events.get(msg.method) || [];
        for (const handler of handlers) {
          handler(msg.params || {}, msg.sessionId);
        }
      }
    });
  }

  on(method, handler) {
    const list = this.events.get(method) || [];
    list.push(handler);
    this.events.set(method, list);
  }

  off(method, handler) {
    const list = this.events.get(method) || [];
    this.events.set(
      method,
      list.filter((h) => h !== handler)
    );
  }

  send(method, params = {}, sessionId, timeoutMs = 30000) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timeout after ${timeoutMs}ms`));
      }, Math.max(1000, Number(timeoutMs) || 30000));
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.ws.send(JSON.stringify(payload));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  close() {
    for (const [, pending] of this.pending) {
      if (pending?.timer) clearTimeout(pending.timer);
      try {
        pending?.reject?.(new Error("CDP session closed"));
      } catch {
        // ignore
      }
    }
    this.pending.clear();
    try {
      this.ws?.close();
    } catch {
      // ignore
    }
  }
}

function looksLikeFeedUrl(url) {
  const lower = String(url || "").toLowerCase();
  return FEED_URL_HINTS.some((hint) => lower.includes(hint));
}

/** Prefer the paginated GB suggested webcast feed over related-live noise. */
function isPreferredSuggestedFeedUrl(url) {
  const lower = String(url || "").toLowerCase();
  return (
    lower.includes("/webcast/feed") &&
    (lower.includes("channel_id=86") || lower.includes("channel_id%3d86"))
  );
}

function feedUrlWithMaxTime(feedUrl, maxTime, { stripSignatures = false } = {}) {
  const u = new URL(feedUrl);
  if (maxTime != null && maxTime !== "") {
    u.searchParams.set("max_time", String(maxTime));
  }
  if (stripSignatures) {
    // Some TikTok page hooks resign unsigned webcast URLs; others need the
    // original query. Caller retries with stripSignatures after status 10011.
    for (const key of [
      "X-Bogus",
      "X-Gnarly",
      "x-bogus",
      "x-gnarly",
      "_signature",
    ]) {
      u.searchParams.delete(key);
    }
  }
  return u.toString();
}

function collectCandidatesFromPayload(payload, seen) {
  const extracted = extractCandidatesFromPayload(payload);
  const seenUids = seen.uids || (seen.uids = new Set());
  const candidates = [];
  for (const candidate of extracted.candidates) {
    if (!candidate) continue;
    const uname = usernameKey(candidate.username);
    // Only skip already-handled handles. Do NOT mark seen here —
    // acceptWithTikleap owns that, and pre-marking made every feed
    // candidate fail the seen.has() gate (0 TikLeap lookups).
    if (!uname || seen.has(uname) || seen.has(candidate.username)) continue;
    if (candidate.userId) {
      if (seenUids.has(candidate.userId)) continue;
      seenUids.add(candidate.userId);
    }
    candidates.push(candidate);
  }
  return {
    candidates,
    rawSeen: extracted.rawSeen,
    hasMore: extracted.hasMore,
    nextMaxTime: extracted.nextMaxTime,
  };
}

function extractUniqueIdsFromHtml(_html, _limit, _seen) {
  // HTML scrape has no follower counts. Suggested-feed JSON does
  // (owner.follow_info.follower_count), so refuse username-only fallbacks —
  // unknowns cannot be verified as ≥ MIN_FOLLOWER_COUNT.
  return [];
}

function sanitizeLeadForStore(lead) {
  if (!lead || typeof lead !== "object") return lead;
  const {
    secUid: _secUid,
    lastVideoAt: _lastVideoAt,
    needsRegionResolve: _needsRegionResolve,
    confirmed: _confirmed,
    ...rest
  } = lead;
  return rest;
}

/**
 * Try one Chrome launch strategy. Resolves with a live debug session handle,
 * or throws after cleanup.
 */
async function tryLaunchStrategy({
  chromePath,
  headlessMode,
  detached,
  viaShell,
  extraFlags,
  timeoutMs,
}) {
  const preferredPort = await reserveFreePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lead-finder-chrome-"));
  // Keep stderr log outside user-data-dir so cleanup can still leave a breadcrumb on failure.
  const logPath = path.join(
    os.tmpdir(),
    `lead-finder-chrome-${process.pid}-${Date.now()}.log`
  );
  const logStream = fs.createWriteStream(logPath, { flags: "a" });

  const args = buildChromeArgs({
    port: preferredPort,
    userDataDir,
    headlessMode,
    extraFlags,
  });

  let stderrBuf = "";
  let stdoutBuf = "";
  let exitInfo = null;
  let spawnError = null;
  let chrome = null;

  const append = (chunk, which) => {
    const text = chunk.toString("utf8");
    if (which === "stderr") stderrBuf += text;
    else stdoutBuf += text;
    try {
      logStream.write(text);
    } catch {
      // ignore
    }
    if (stderrBuf.length > 64_000) stderrBuf = stderrBuf.slice(-48_000);
    if (stdoutBuf.length > 16_000) stdoutBuf = stdoutBuf.slice(-12_000);
  };

  const cleanupLaunch = ({ keepLog = false } = {}) => {
    try {
      logStream.end();
    } catch {
      // ignore
    }
    killProcessTree(chrome);
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    if (!keepLog) {
      try {
        fs.unlinkSync(logPath);
      } catch {
        // ignore
      }
    }
  };

  const spawnOpts = {
    stdio: ["ignore", "pipe", "pipe"],
    env: sanitizedChromeEnv(),
    detached: Boolean(detached),
  };

  try {
    if (viaShell) {
      // Break out of Cursor's process group via a login shell + setsid-like detach.
      const quoted = [chromePath, ...args]
        .map((part) => `'${String(part).replace(/'/g, `'\\''`)}'`)
        .join(" ");
      chrome = spawn("/bin/zsh", ["-lc", quoted], spawnOpts);
    } else {
      chrome = spawn(chromePath, args, spawnOpts);
    }
  } catch (error) {
    cleanupLaunch({ keepLog: true });
    throw new Error(`Failed to spawn Chrome at ${chromePath}: ${error.message}`);
  }

  if (detached) {
    try {
      chrome.unref();
    } catch {
      // ignore
    }
  }

  chrome.on("error", (error) => {
    spawnError = error;
  });
  chrome.on("exit", (code, signal) => {
    exitInfo = { code, signal };
  });
  chrome.stderr.on("data", (chunk) => append(chunk, "stderr"));
  chrome.stdout.on("data", (chunk) => append(chunk, "stdout"));

  const classifyFail = (reason) => {
    const detail = snippet(stderrBuf) || snippet(stdoutBuf);
    const aborted =
      exitInfo?.signal === "SIGABRT" ||
      /SIGABRT|Abort trap|TransformProcessType/i.test(`${reason}\n${detail}`);
    const exitBit = exitInfo
      ? ` (exit code=${exitInfo.code}, signal=${exitInfo.signal})`
      : "";
    const spawnBit = spawnError ? ` Spawn error: ${spawnError.message}.` : "";
    const hint = aborted ? ` ${CURSOR_TRANSFORM_HINT}` : "";
    const err = new Error(
      `${reason}${exitBit}.${spawnBit}${hint}${
        detail ? ` Chrome output: ${detail}` : ""
      } Log: ${logPath}`
    );
    err.code = aborted ? "CHROME_TRANSFORM_ABORT" : "CHROME_LAUNCH_FAILED";
    err.logPath = logPath;
    cleanupLaunch({ keepLog: true });
    throw err;
  };

  const started = Date.now();
  let wsUrl = null;
  let debugPort = preferredPort;

  while (Date.now() - started < timeoutMs) {
    if (spawnError) {
      classifyFail(`Failed to spawn Chrome at ${chromePath}: ${spawnError.message}`);
    }
    if (exitInfo) {
      classifyFail("Chrome exited before opening its remote debugging port");
    }

    const match = DEVTOOLS_URL_RE.exec(stderrBuf);
    if (match) {
      wsUrl = match[1].trim();
      const portMatch = DEBUG_PORT_RE.exec(wsUrl);
      if (portMatch) debugPort = Number(portMatch[1]);
      break;
    }
    await sleep(100);
  }

  if (!wsUrl) {
    const pollDeadline = Date.now() + 4000;
    while (Date.now() < pollDeadline) {
      if (exitInfo || spawnError) break;
      try {
        const version = await httpGetJson(
          `http://127.0.0.1:${debugPort}/json/version`
        );
        if (version?.webSocketDebuggerUrl) {
          wsUrl = version.webSocketDebuggerUrl;
          break;
        }
      } catch {
        // keep waiting
      }
      await sleep(150);
    }
  }

  if (!wsUrl) {
    classifyFail(
      `Could not connect to local Chrome debugging port (tried ${debugPort}, waited ${timeoutMs}ms)`
    );
  }

  try {
    const version = await httpGetJson(
      `http://127.0.0.1:${debugPort}/json/version`
    );
    if (version?.webSocketDebuggerUrl) {
      wsUrl = version.webSocketDebuggerUrl;
    }
  } catch {
    // stderr-parsed URL is still usable.
  }

  return {
    chrome,
    wsUrl,
    debugPort,
    userDataDir,
    logPath,
    strategy: {
      chromePath,
      headlessMode,
      detached,
      viaShell,
      extraFlags,
    },
    getStderr: () => stderrBuf,
    cleanup: () => cleanupLaunch({ keepLog: false }),
  };
}

/**
 * Launch Chrome and wait until its DevTools websocket is ready.
 * Tries multiple binaries and spawn strategies to avoid macOS
 * TransformProcessType aborts when the parent is Cursor.
 */
const TIKTOK_FEED_PROFILE_DIR = path.join(
  __dirname,
  "..",
  "data",
  "chrome-tiktok-feed-profile"
);

/**
 * Opt-in second Chrome for TikTok Live suggested-feed only.
 * Normal Get-leads reuses chrome-tikleap-profile (a Live tab) instead.
 * Uses data/chrome-tiktok-feed-profile when separateTikTokChrome=true.
 * Default: --headless=new. Set LEAD_FINDER_HEADED=1 for a visible window.
 */
async function launchTikTokFeedChrome({ timeoutMs = 25000 } = {}) {
  const chromePath = findChrome();
  if (!chromePath) {
    throw new Error(
      "Google Chrome not found for TikTok Live feed scrape."
    );
  }

  fs.mkdirSync(TIKTOK_FEED_PROFILE_DIR, { recursive: true });
  // Drop stale SingletonLock if a prior run died mid-scrape.
  try {
    for (const name of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
      try {
        fs.unlinkSync(path.join(TIKTOK_FEED_PROFILE_DIR, name));
      } catch {
        // ignore
      }
    }
    // Non-blocking — execSync pkill can stall the event loop (Railway 502s).
    await new Promise((resolve) => {
      const killer = spawn(
        "pkill",
        ["-f", `--user-data-dir=${TIKTOK_FEED_PROFILE_DIR}`],
        { stdio: "ignore" }
      );
      const done = () => resolve();
      killer.on("error", done);
      killer.on("close", done);
      setTimeout(done, 1500).unref?.();
    });
  } catch {
    // ignore
  }
  await sleep(350);

  const headed =
    process.env.LEAD_FINDER_HEADED === "1" ||
    process.env.LEAD_FINDER_HEADED === "true";
  const port = await reserveFreePort();
  const args = [
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
    "--remote-allow-origins=*",
    `--user-data-dir=${TIKTOK_FEED_PROFILE_DIR}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=Translate",
    "--window-size=1200,900",
  ];
  // Containers (Railway/Docker) typically need no-sandbox for Chromium.
  if (
    process.env.LEAD_FINDER_CHROME_NO_SANDBOX === "1" ||
    process.env.LEAD_FINDER_CHROME_NO_SANDBOX === "true" ||
    process.env.RAILWAY_ENVIRONMENT ||
    fs.existsSync("/.dockerenv")
  ) {
    args.push("--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage");
  }
  if (headed) {
    args.push("--window-position=-1400,200", "--new-window");
  } else {
    args.push("--headless=new", "--disable-gpu");
  }
  args.push("about:blank");

  const child = spawn(chromePath, args, {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  let stderrBuf = "";
  if (child.stderr) {
    child.stderr.on("data", (chunk) => {
      stderrBuf += chunk.toString("utf8");
      if (stderrBuf.length > 64_000) stderrBuf = stderrBuf.slice(-48_000);
    });
  }

  const started = Date.now();
  let wsUrl = null;
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode != null) {
      const err = new Error(
        `TikTok feed Chrome exited early (code=${child.exitCode}). ${stderrBuf.slice(-300)}`
      );
      err.code = "CHROME_LAUNCH_FAILED";
      throw err;
    }
    const match = DEVTOOLS_URL_RE.exec(stderrBuf);
    if (match) {
      wsUrl = match[1].trim();
      break;
    }
    try {
      const version = await httpGetJson(
        `http://127.0.0.1:${port}/json/version`
      );
      if (version?.webSocketDebuggerUrl) {
        wsUrl = version.webSocketDebuggerUrl;
        break;
      }
    } catch {
      // wait
    }
    await sleep(200);
  }

  if (!wsUrl) {
    try {
      if (child.pid) process.kill(child.pid, "SIGKILL");
    } catch {
      // ignore
    }
    const err = new Error(
      "Could not attach to TikTok feed Chrome. Quit leftover feed Chrome windows and retry."
    );
    err.code = "CHROME_LAUNCH_FAILED";
    throw err;
  }

  console.log(
    `[browserFetcher] TikTok feed Chrome ready headless=${headed ? "false" : "new"}` +
      ` profile=${TIKTOK_FEED_PROFILE_DIR}`
  );

  return {
    chrome: child,
    wsUrl,
    debugPort: port,
    userDataDir: TIKTOK_FEED_PROFILE_DIR,
    headless: !headed,
    cleanup: () => {
      try {
        if (child.pid) process.kill(child.pid, "SIGKILL");
      } catch {
        // ignore
      }
      for (const name of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
        try {
          fs.unlinkSync(path.join(TIKTOK_FEED_PROFILE_DIR, name));
        } catch {
          // ignore
        }
      }
    },
  };
}

async function launchChromeDebug({ timeoutMs = 18000 } = {}) {
  const binaries = findChromeBinaries();
  if (!binaries.length) {
    throw new Error(
      "Google Chrome not found. Install Chrome, then restart Lead Finder (preferably from Terminal.app: cd lead-finder && ./start.sh)."
    );
  }

  const strategies = [];
  for (const chromePath of binaries) {
    const shellish = isHeadlessShell(chromePath);
    const modes = shellish ? ["shell"] : ["new", "old"];
    for (const headlessMode of modes) {
      strategies.push({
        chromePath,
        headlessMode,
        detached: true,
        viaShell: false,
        extraFlags: [],
      });
      // Detached + shell wrapper can break Cursor's responsible-process chain.
      strategies.push({
        chromePath,
        headlessMode,
        detached: true,
        viaShell: true,
        extraFlags: [],
      });
      if (process.env.LEAD_FINDER_CHROME_NO_SANDBOX === "1") {
        strategies.push({
          chromePath,
          headlessMode,
          detached: true,
          viaShell: false,
          extraFlags: ["--no-sandbox", "--disable-setuid-sandbox"],
        });
      }
    }
  }

  // Last resort: non-detached (helps when process-group kill is awkward).
  strategies.push({
    chromePath: binaries[0],
    headlessMode: isHeadlessShell(binaries[0]) ? "shell" : "new",
    detached: false,
    viaShell: false,
    extraFlags: [],
  });

  const errors = [];
  let sawTransformAbort = false;

  for (const strategy of strategies) {
    try {
      return await tryLaunchStrategy({ ...strategy, timeoutMs });
    } catch (error) {
      if (error?.code === "CHROME_TRANSFORM_ABORT") sawTransformAbort = true;
      errors.push(
        `${strategy.chromePath} headless=${strategy.headlessMode}` +
          `${strategy.detached ? " detached" : ""}${strategy.viaShell ? " viaShell" : ""}: ${
            error.message.split(" Chrome output:")[0]
          }`
      );
    }
  }

  const summary = errors.slice(0, 4).join(" | ");
  const err = new Error(
    sawTransformAbort || looksLikeCursorHosted()
      ? `${CURSOR_TRANSFORM_HINT} Attempts: ${summary}`
      : `Could not start Chrome for lead refresh. Attempts: ${summary}`
  );
  err.code = sawTransformAbort ? "CHROME_TRANSFORM_ABORT" : "CHROME_LAUNCH_FAILED";
  throw err;
}

async function fetchViaChrome({
  limit = MANUAL_REFRESH_LIMIT,
  // TikLeap L28 gate needs a longer budget to reach 200 keeps (parallel tabs).
  timeoutMs = 1500000,
  maxPages = 2500,
  resolveConcurrency = 10,
  tikleapWorkers = 12,
  /**
   * `strict_tikleap_gb` — TikTok feed: TikLeap GB + L30/month gates when
   * TikLeap has country; if TikLeap misses, keep when feed signals GB/UK.
   * `feed_gb` — Railway/deploy path: feed GB/UK signals only, no TikLeap;
   * unknown diamonds kept; TikLeap-dependent diamond/month gates skipped.
   * `uk_first_fallback` — legacy fast path (not used by current primary).
   */
  confirmMode: initialConfirmMode = "uk_first_fallback",
  /** Usernames already kept / in CRM — skip without TikLeap lookup. */
  excludeUsernames = [],
  /** Progress display: keepers already held from TikLeap primary. */
  progressBaseKept = 0,
  /** Progress display: overall Get-leads target (defaults to limit). */
  progressLimit = null,
  /** Progress phase label while scraping the suggested feed. */
  progressPhase = null,
  /** Shared keeper coordinator for the ordered pipeline (P3 after TikLeap). */
  sharedKeepers = null,
  /** Shared TikLeap client (chrome-tikleap-profile); do not launch/cleanup. */
  tikleapClient: externalTikleapClient = null,
  tikleapOwnedExternally = false,
  /**
   * Reuse an already-open Chrome (same chrome-tikleap-profile browser) for the
   * TikTok Live tab. Preferred normal path — avoids a second Chrome instance.
   */
  browserSession: externalBrowserSession = null,
  /**
   * Opt-in / feed-only: launch data/chrome-tiktok-feed-profile.
   * Required for `feed_gb` (no TikLeap Chrome). For full mode, leave false
   * and pass browserSession unless intentionally using a second Chrome.
   */
  separateTikTokChrome = false,
} = {}) {
  const cap = Math.max(0, Math.floor(Number(limit)) || 0) || MANUAL_REFRESH_LIMIT;
  limit = cap;
  const concurrency = Math.max(
    1,
    Math.min(16, Math.floor(Number(resolveConcurrency)) || 10)
  );
  const workerN = Math.max(
    1,
    Math.min(
      Math.max(1, MAX_TIKLEAP_CHROME_TABS - 1),
      Math.floor(
        Number.isFinite(Number(tikleapWorkers)) && Number(tikleapWorkers) > 0
          ? Number(tikleapWorkers)
          : resolveTikleapLookupWorkers()
      )
    )
  );
  const baseKept = Math.max(0, Math.floor(Number(progressBaseKept)) || 0);
  const overallLimit = Math.max(
    limit + baseKept,
    Math.floor(Number(progressLimit)) || limit + baseKept
  );
  const feedGbOnly = initialConfirmMode === "feed_gb";
  const strictTikleapGb =
    initialConfirmMode === "strict_tikleap_gb" || feedGbOnly;
  const parallelMode = Boolean(sharedKeepers);
  // Feed-only always uses the dedicated TikTok feed profile (no TikLeap Chrome).
  // Otherwise only launch a second Chrome when explicitly requested AND no shared session.
  const useSeparateTikTokChrome =
    feedGbOnly || (Boolean(separateTikTokChrome) && !externalBrowserSession);
  const reuseSharedBrowser = Boolean(externalBrowserSession) && !feedGbOnly;
  const scrapePhase =
    progressPhase ||
    (parallelMode || strictTikleapGb || feedGbOnly ? "tiktok_feed" : "scraping");
  if (!feedGbOnly && !hasLoginProfile() && !externalTikleapClient) {
    const err = new Error(
      `TikLeap Premium login required for UK scrape ` +
        `(L30 ${MIN_DIAMONDS_L30.toLocaleString()}–${MAX_DIAMONDS_L30.toLocaleString()} when known; unknown L30 kept). ` +
        `Run ./scripts/tikleap-login.sh, log in with Premium, then Get leads again. ` +
        `(profile ${profileDir()} / cookies ${cookiesPath()})`
    );
    err.code = "TIKLEAP_SESSION_REQUIRED";
    throw err;
  }

  if (!parallelMode) {
    updateRefreshProgress({
      phase: strictTikleapGb ? scrapePhase : "starting",
      limit: overallLimit,
      maxPages,
      timeoutMs,
      leads: baseKept,
      pages: 0,
      rawSeen: 0,
      hasMore: true,
      lookups: 0,
      countryHits: 0,
      gbHits: 0,
      tikleapKept: baseKept,
      tikleapSkipped: 0,
    });
  }
  /** TikTok Live browser session (temp profile when separate; else TikLeap Chrome). */
  let browserSession = null;
  let sessionId = null;
  /** @type {Awaited<ReturnType<typeof launchTikleapChrome>>|null} */
  let tikleapLaunch = null;
  /** @type {Awaited<ReturnType<typeof launchChromeDebug>>|null} */
  let tiktokLaunch = null;
  /** @type {ReturnType<typeof createTikleapClient>|null} */
  let tikleapClient = externalTikleapClient || null;

  const seen = new Set();
  for (const name of excludeUsernames || []) {
    const key = usernameKey(name);
    if (key) seen.add(key);
  }
  /** Keepers: known L30 in 1K–150K, or unknown/masked L30 (kept anyway). */
  const preferred = [];
  const secondary = [];
  const leads = [];
  const resolveQueue = [];
  const resolveCache = new Map();
  let rawSeen = 0;
  let feedHits = 0;
  let pagesFetched = 0;
  let pendingBodies = 0;
  let capturedFeedUrl = "";
  let hasMore = true;
  let nextMaxTime = null;
  let activeResolvers = 0;
  let tikleapPending = 0;
  let tikleapKept = 0;
  let tikleapSkipped = 0;
  let tikleapFatal = null;
  let lookups = 0;
  let countryHits = 0;
  let gbHits = 0;
  let lookupDiagLogged = 0;
  let monthOverCapSkipped = 0;
  let countrySkipped = 0;

  const syncLeads = () => {
    if (parallelMode) {
      leads.length = 0;
      leads.push(
        ...sharedKeepers
          .getLeads()
          .filter((l) => l.source === "tiktok_live_suggested")
      );
      return;
    }
    leads.length = 0;
    const pref = preferred.slice(0, limit);
    leads.push(...pref);
    if (leads.length < limit) {
      leads.push(...secondary.slice(0, limit - leads.length));
    }
  };

  const preferredFull = () =>
    parallelMode ? sharedKeepers.isFull() : preferred.length >= limit;
  /**
   * Fast path by default: TikTok country XHRs are too slow/sparse to hit 200
   * in 6 minutes. Reject foreign signals; keep clean GB-feed unknowns.
   * @type {'strict' | 'uk_first_fallback' | 'strict_tikleap_gb'}
   */
  let confirmMode = strictTikleapGb
    ? "strict_tikleap_gb"
    : "uk_first_fallback";
  let fallbackNotice = strictTikleapGb
    ? parallelMode
      ? "TikTok Live suggested-feed (P3) — TikLeap GB + L30/month gates when known; feed GB/UK signals keep when TikLeap has no data."
      : "TikTok Live suggested-feed — TikLeap GB + L30/month gates when known; feed GB/UK signals keep when TikLeap has no data."
    : "Fast UK-first mode — skipping slow country lookups so Get leads can fill toward 200.";
  // After the initial passive capture, ingest only from explicit in-page
  // pagination so Network.loadingFinished does not double-count those bodies.
  let useNetworkIngest = true;

  const publishProgress = (phase = scrapePhase) => {
    syncLeads();
    if (parallelMode) {
      sharedKeepers.setFeedStats({
        rawSeen,
        pages: Math.max(feedHits, pagesFetched),
        tikleapSkipped,
        queueSize: resolveQueue.length + tikleapPending,
        resolving: activeResolvers + tikleapPending,
      });
      return;
    }
    updateRefreshProgress({
      phase: strictTikleapGb ? scrapePhase : phase,
      limit: overallLimit,
      maxPages,
      timeoutMs,
      leads: baseKept + leads.length,
      pages: Math.max(feedHits, pagesFetched),
      rawSeen,
      hasMore:
        hasMore ||
        resolveQueue.length > 0 ||
        activeResolvers > 0 ||
        tikleapPending > 0,
      lookups,
      countryHits,
      gbHits,
      queueSize: resolveQueue.length + tikleapPending,
      resolving: activeResolvers + tikleapPending,
      confirmMode,
      tikleapKept: baseKept + tikleapKept,
      tikleapSkipped,
    });
  };

  const cleanup = () => {
    if (!tikleapOwnedExternally && !reuseSharedBrowser) {
      try {
        tikleapLaunch?.cleanup();
      } catch {
        // ignore
      }
    }
    try {
      tiktokLaunch?.cleanup();
    } catch {
      // ignore
    }
    try {
      // Never close a shared TikLeap browser — orchestrator owns cleanup.
      if (useSeparateTikTokChrome && browserSession && !reuseSharedBrowser) {
        browserSession.close();
      }
    } catch {
      // ignore
    }
    tikleapLaunch = null;
    tiktokLaunch = null;
    if (!reuseSharedBrowser) browserSession = null;
    sessionId = null;
  };

  const rememberFeedUrl = (url) => {
    if (!looksLikeFeedUrl(url)) return;
    if (
      !capturedFeedUrl ||
      isPreferredSuggestedFeedUrl(url) ||
      (!isPreferredSuggestedFeedUrl(capturedFeedUrl) &&
        url.includes("/webcast/feed"))
    ) {
      capturedFeedUrl = url;
    }
  };

  /**
   * True when suggested-feed payload / profile text already looks GB/UK
   * (trusted region/country fields, UK flags, UK name phrases, .uk handle).
   * Viewer locale is never treated as country (see regionFilter).
   */
  const feedAppearsGbUk = (cand) => {
    if (!cand) return false;
    if (hasConfirmedNonGbEvidence(cand)) return false;
    if (isConfirmedGbEvidence(cand)) return true;
    if (hasPositiveGbEvidence(cand)) return true;
    return isGbRegion(cand.region);
  };

  /**
   * Region-ok candidate → TikLeap L30 diamond gate → preferred/secondary buckets.
   * In `feed_gb` mode (no TikLeap client): keep on feed GB/UK signals only;
   * unknown diamonds kept; skip TikLeap diamond/month gates.
   * @param {'confirmed'|'uk_first'|'strict_tikleap_gb'|'feed_gb'} mode
   */
  const acceptWithTikleap = (candidate, mode) => {
    if (preferredFull() || !candidate) return false;
    if (!tikleapClient && !feedGbOnly) return false;
    const uname = usernameKey(candidate.username);
    if (!uname || seen.has(uname)) return false;
    if (parallelMode && sharedKeepers.shouldSkip(uname)) {
      seen.add(uname);
      return false;
    }

    let region = null;
    let regionSource = candidate.regionSource || null;
    let confirmed = false;
    const strict = mode === "strict_tikleap_gb" || mode === "feed_gb";

    if (mode === "confirmed") {
      if (!isConfirmedGbEvidence(candidate)) return false;
      region = isGbRegion(candidate.region) ? candidate.region : "GB";
      regionSource = candidate.regionSource || "api";
      confirmed = true;
    } else if (strict) {
      // Pre-reject clear non-GB; TikLeap may still confirm GB or miss.
      if (
        hasConfirmedNonGbEvidence({
          region: candidate.region,
          displayName: candidate.displayName,
          username: candidate.username,
          bio: candidate.bio || "",
        })
      ) {
        seen.add(uname);
        return false;
      }
      if (isNonGbRegion(candidate.region)) {
        seen.add(uname);
        return false;
      }
      region = null;
      regionSource = null;
      confirmed = false;
    } else {
      if (
        hasConfirmedNonGbEvidence({
          region: candidate.region,
          displayName: candidate.displayName,
          username: candidate.username,
          bio: candidate.bio || "",
        })
      ) {
        seen.add(uname);
        return false;
      }
      if (isNonGbRegion(candidate.region)) {
        seen.add(uname);
        return false;
      }
      region = isGbRegion(candidate.region) ? candidate.region : null;
      regionSource = region ? candidate.regionSource || "api" : "feed_gb";
      confirmed = Boolean(region);
    }

    /** Apply feed GB/UK signals when TikLeap has no usable country. */
    const applyFeedGbFallback = (reason) => {
      if (!feedAppearsGbUk(candidate)) return false;
      region = isGbRegion(candidate.region) ? candidate.region : "GB";
      const blob = [
        candidate.displayName,
        candidate.username,
        candidate.bio || "",
      ]
        .filter(Boolean)
        .join(" ");
      regionSource =
        candidate.regionSource ||
        (hasUkFlagEmoji(blob) ? "flag" : "feed_gb_signal");
      confirmed = isConfirmedGbEvidence({
        ...candidate,
        region,
        regionSource,
      });
      console.log(
        `[browserFetcher] keep @${candidate.username}: TikLeap miss (${reason})` +
          ` — feed GB/UK signal (regionSource=${regionSource})`
      );
      return true;
    };

    /**
     * Persist keeper / inactive after region + diamond decision.
     * @param {{ diamondsL30?: unknown, diamondsL28?: unknown, masked?: boolean, maxMonthDiamonds?: unknown }} tl
     */
    const finalizeKeep = (tl) => {
      const diamonds =
        tl.diamondsL30 != null ? tl.diamondsL30 : tl.diamondsL28;
      const diamondsUnknown =
        Boolean(tl.masked) || !isDiamondsKnown(diamonds);

      const nowIso = new Date().toISOString();
      const floor = diamondsUnknown ? null : Math.floor(Number(diamonds));
      const leadBase = {
        ...candidate,
        region,
        regionSource,
        confirmed,
        needsRegionResolve: false,
        diamondsL30: floor,
        diamondsL28: floor,
        diamondsL30At: diamondsUnknown ? null : nowIso,
        diamondsL28At: diamondsUnknown ? null : nowIso,
        maxMonthDiamonds:
          tl.maxMonthDiamonds != null &&
          Number.isFinite(Number(tl.maxMonthDiamonds))
            ? Math.floor(Number(tl.maxMonthDiamonds))
            : null,
        source: strict ? "tiktok_live_suggested" : candidate.source,
      };

      if (!shouldKeepForDiamonds(diamonds, { masked: Boolean(tl.masked) })) {
        // Known L30 < 500 → Inactive / lost (no New keeper slot).
        if (isInactiveDiamondsL30(diamonds)) {
          const inactiveLead = sanitizeLeadForStore(leadBase);
          if (parallelMode) sharedKeepers.noteRejected(uname);
          try {
            addLeads([inactiveLead], { ignoreQuota: true, live: true });
          } catch (error) {
            console.warn(
              `[browserFetcher] inactive persist failed for @${candidate.username}:`,
              error?.message || error
            );
          }
          console.log(
            `[browserFetcher] inactive @${candidate.username}: L30=` +
              `${Math.floor(Number(diamonds)).toLocaleString()} < 500`
          );
          return;
        }
        tikleapSkipped += 1;
        if (parallelMode) sharedKeepers.noteRejected(uname);
        // Known out-of-band (500–999 or over-cap) — burn UID on feed path.
        if (!strict && isDiamondsKnown(diamonds) && candidate.userId) {
          try {
            recordScrapedUids([candidate.userId]);
          } catch {
            // ignore
          }
        }
        return;
      }

      const lead = sanitizeLeadForStore(leadBase);
      if (parallelMode) {
        if (!sharedKeepers.tryClaim(uname, lead)) {
          tikleapSkipped += 1;
          return;
        }
        seen.add(uname);
        if (confirmed || region) gbHits += 1;
        tikleapKept += 1;
        syncLeads();
        return;
      }
      if (diamondsUnknown || isPreferredDiamondBand(diamonds)) {
        if (preferred.length < limit) preferred.push(lead);
      } else if (secondary.length < limit) {
        secondary.push(lead);
      } else {
        tikleapSkipped += 1;
        return;
      }
      if (confirmed || region) gbHits += 1;
      tikleapKept += 1;
      syncLeads();
    };

    // Mark handled before async lookup so later pages do not re-enqueue.
    seen.add(uname);
    if (parallelMode && !sharedKeepers.beginLookup(uname)) return false;

    // Feed-only (Railway): no TikLeap — keep when feed signals GB/UK;
    // unknown diamonds kept; skip TikLeap-dependent diamond/month gates.
    if (feedGbOnly) {
      if (!applyFeedGbFallback("no_tikleap")) {
        tikleapSkipped += 1;
        if (parallelMode) sharedKeepers.noteRejected(uname);
        console.log(
          `[browserFetcher] skip @${candidate.username}: feed-only mode, no GB/UK signal`
        );
        return false;
      }
      finalizeKeep({
        diamondsL30: null,
        diamondsL28: null,
        masked: false,
        maxMonthDiamonds: null,
      });
      return true;
    }

    tikleapPending += 1;
    publishProgress(strict ? scrapePhase : "resolving");
    Promise.resolve()
      .then(() =>
        tikleapClient.lookup(candidate.username, {
          needCountry: strict,
        })
      )
      .then((tl) => {
        if (tl.sessionDead) {
          tikleapSkipped += 1;
          if (!tikleapFatal) {
            tikleapFatal = new Error(
              "TikLeap session blocked (Cloudflare/login). " +
                "Re-run ./scripts/tikleap-login.sh with Premium in the headed window, then Get leads again."
            );
            tikleapFatal.code = "TIKLEAP_SESSION_DEAD";
          }
          return;
        }

        if (tl.monthOverCap) {
          monthOverCapSkipped += 1;
          tikleapSkipped += 1;
          if (parallelMode) sharedKeepers.noteRejected(uname);
          const cur =
            tl.currentMonthDiamonds != null
              ? Number(tl.currentMonthDiamonds)
              : Number(tl.maxMonthDiamonds);
          console.log(
            `[browserFetcher] skip @${candidate.username}: current-month over-cap` +
              ` (currentMonth=${
                Number.isFinite(cur) ? Math.floor(cur).toLocaleString() : "?"
              } ≥ ${MAX_DIAMONDS_CURRENT_MONTH.toLocaleString()})`
          );
          return;
        }

        if (strict) {
          if (tl.country && isNonGbRegion(tl.country)) {
            countrySkipped += 1;
            tikleapSkipped += 1;
            countryHits += 1;
            if (parallelMode) sharedKeepers.noteRejected(uname);
            console.log(
              `[browserFetcher] skip @${candidate.username}: TikLeap country=${tl.country} (non-GB)`
            );
            return;
          }
          if (tl.country && isGbRegion(tl.country)) {
            countryHits += 1;
            region = "GB";
            regionSource = "tikleap_country";
            confirmed = true;
          } else {
            // No TikLeap country (missing profile / masked / unparsed).
            const missReason =
              tl.source || (tl.masked ? "masked" : "no_country");
            if (!applyFeedGbFallback(missReason)) {
              countrySkipped += 1;
              tikleapSkipped += 1;
              console.log(
                `[browserFetcher] skip @${candidate.username}: no TikLeap country` +
                  ` (${missReason}) and no feed GB/UK signal`
              );
              return;
            }
          }
        }

        finalizeKeep(tl);
      })
      .catch((error) => {
        if (strict && applyFeedGbFallback("lookup_error")) {
          finalizeKeep({
            diamondsL30: null,
            masked: false,
            maxMonthDiamonds: null,
          });
          return;
        }
        tikleapSkipped += 1;
        console.warn(
          `[browserFetcher] TikLeap lookup failed for @${candidate.username}: ${
            error.message || error
          }`
        );
      })
      .finally(() => {
        if (parallelMode) sharedKeepers.endLookup(uname);
        tikleapPending = Math.max(0, tikleapPending - 1);
        publishProgress(strict ? scrapePhase : "resolving");
      });
    return true;
  };

  const acceptConfirmed = (candidate) => acceptWithTikleap(candidate, "confirmed");

  /** UK-first fallback: reject foreign signals; allow clean GB-feed unknowns. */
  const acceptUkFirst = (candidate) => acceptWithTikleap(candidate, "uk_first");

  const acceptStrictTikleapGb = (candidate) =>
    acceptWithTikleap(candidate, feedGbOnly ? "feed_gb" : "strict_tikleap_gb");

  const enableUkFirstFallback = (reason) => {
    // Strict TikLeap-GB / feed-only modes never soften to unverified feed unknowns.
    if (strictTikleapGb || feedGbOnly) return;
    if (confirmMode === "uk_first_fallback") return;
    confirmMode = "uk_first_fallback";
    fallbackNotice = reason;
    console.warn(`[browserFetcher] ${reason}`);
    // Flush queued candidates under the fallback gate (no more country XHRs).
    const pending = resolveQueue.splice(0, resolveQueue.length);
    for (const candidate of pending) {
      if (preferredFull()) break;
      if (candidate.confirmed || isConfirmedGbEvidence(candidate)) {
        acceptConfirmed(candidate);
      } else {
        acceptUkFirst(candidate);
      }
    }
    publishProgress(scrapePhase);
  };

  let fetchTextInBrowser = async () => null;

  const resolveCandidateRegion = async (candidate) => {
    const cacheKey = candidate.userId || candidate.username;
    if (resolveCache.has(cacheKey)) {
      return resolveCache.get(cacheKey);
    }

    const blob = [candidate.displayName, candidate.username, candidate.bio || ""]
      .filter(Boolean)
      .join(" ");
    if (hasUkFlagEmoji(blob)) {
      const hit = {
        region: "GB",
        regionSource: "flag",
        outcome: "gb",
        hadCountry: true,
      };
      resolveCache.set(cacheKey, hit);
      return hit;
    }
    if (isGbRegion(candidate.region) && candidate.regionSource === "api") {
      const hit = {
        region: candidate.region,
        regionSource: "api",
        outcome: "gb",
        hadCountry: true,
      };
      resolveCache.set(cacheKey, hit);
      return hit;
    }
    if (isNonGbRegion(candidate.region) && candidate.regionSource === "api") {
      const hit = {
        region: candidate.region,
        regionSource: "api",
        outcome: "non_gb",
        hadCountry: true,
      };
      resolveCache.set(cacheKey, hit);
      return hit;
    }

    // After fallback, do not spend budget on country XHRs.
    if (confirmMode === "uk_first_fallback") {
      const hit = {
        region: null,
        regionSource: null,
        outcome: "unknown",
        hadCountry: false,
        userId: candidate.userId || "",
      };
      resolveCache.set(cacheKey, hit);
      return hit;
    }

    lookups += 1;
    let resolved = {
      region: null,
      regionSource: null,
      outcome: "unknown",
      hadCountry: false,
      userId: candidate.userId || "",
    };

    const detailUrls = buildUserDetailUrls(candidate.username, candidate.userId);
    for (const url of detailUrls) {
      const page = await fetchTextInBrowser(url);
      let payload = null;
      if (page?.text) {
        try {
          payload = JSON.parse(page.text);
        } catch {
          payload = null;
        }
      }
      if (lookupDiagLogged < 4) {
        lookupDiagLogged += 1;
        const summary = summarizeLookupResponse(page, payload);
        console.log(
          `[browserFetcher] region lookup diag #${lookupDiagLogged}` +
            ` @${candidate.username}: status=${summary.status}` +
            (summary.err ? ` err=${summary.err}` : "") +
            (summary.statusCode != null ? ` apiStatus=${summary.statusCode}` : "") +
            ` bytes=${summary.textLen} keys=${summary.keys || "-"}` +
            ` region=${summary.region || "none"}`
        );
      }
      if (!page || page.status !== 200 || !page.text || !payload) continue;
      const parsed = parseUserDetailPayload(payload);
      if (parsed.userId && !resolved.userId) resolved.userId = parsed.userId;
      if (parsed.region) {
        resolved = {
          region: parsed.region,
          regionSource: "user_detail",
          outcome: classifyResolveOutcome(parsed.region),
          hadCountry: true,
          userId: parsed.userId || resolved.userId,
        };
        break;
      }
    }

    if (!resolved.hadCountry) {
      const profileUrl = profileUrlForUsername(candidate.username);
      if (profileUrl) {
        const page = await fetchTextInBrowser(profileUrl);
        if (page?.status === 200 && page.text) {
          const parsed = parseRegionFromProfileHtml(page.text, candidate.username);
          if (parsed.userId && !resolved.userId) resolved.userId = parsed.userId;
          if (parsed.region) {
            resolved = {
              region: parsed.region,
              regionSource: "profile",
              outcome: classifyResolveOutcome(parsed.region),
              hadCountry: true,
              userId: parsed.userId || resolved.userId,
            };
          }
        }
      }
    }

    if (resolved.hadCountry) countryHits += 1;
    resolveCache.set(cacheKey, resolved);

    // TikTok omitted country everywhere — switch to UK-first fallback (can hit 200).
    if (lookups >= 24 && countryHits === 0) {
      enableUkFirstFallback(
        "TikTok omitted creator country on signed lookups — switching to UK-first fallback (reject foreign signals; allow clean GB-feed unknowns)."
      );
    }

    return resolved;
  };

  const pumpResolvers = () => {
    while (
      activeResolvers < concurrency &&
      resolveQueue.length > 0 &&
      !preferredFull()
    ) {
      const candidate = resolveQueue.shift();
      activeResolvers += 1;
      Promise.resolve()
        .then(async () => {
          if (candidate.confirmed || isConfirmedGbEvidence(candidate)) {
            acceptConfirmed(candidate);
            return;
          }
          if (confirmMode === "uk_first_fallback") {
            acceptUkFirst(candidate);
            return;
          }
          const resolved = await resolveCandidateRegion(candidate);
          if (confirmMode === "uk_first_fallback") {
            // Probe flipped mid-flight — accept under fallback.
            if (!resolved?.hadCountry || resolved.outcome !== "gb") {
              acceptUkFirst(candidate);
              return;
            }
          }
          if (!resolved?.hadCountry || resolved.outcome !== "gb") return;
          acceptConfirmed({
            ...candidate,
            region: resolved.region,
            regionSource: resolved.regionSource,
            userId: resolved.userId || candidate.userId,
            confirmed: true,
            needsRegionResolve: false,
          });
        })
        .catch(() => {})
        .finally(() => {
          activeResolvers -= 1;
          publishProgress("resolving");
          pumpResolvers();
        });
    }
  };

  const enqueueCandidates = (candidates) => {
    for (const candidate of candidates) {
      if (preferredFull() || tikleapFatal) break;
      // Strict feed fallback: TikLeap alone verifies GB + diamonds.
      if (confirmMode === "strict_tikleap_gb") {
        acceptStrictTikleapGb(candidate);
        continue;
      }
      if (candidate.confirmed || isConfirmedGbEvidence(candidate)) {
        acceptConfirmed(candidate);
        continue;
      }
      // Fast mode: ingest immediately (no per-creator XHR country resolve).
      if (confirmMode === "uk_first_fallback") {
        acceptUkFirst(candidate);
        continue;
      }
      if (resolveQueue.length >= Math.max(limit * 4, 120)) break;
      resolveQueue.push(candidate);
    }
    if (confirmMode === "strict") pumpResolvers();
    publishProgress(
      pagesFetched > 0
        ? scrapePhase
        : strictTikleapGb
          ? scrapePhase
          : "starting"
    );
  };

  const ingestPayload = (payload, { updateCursor = true } = {}) => {
    if (preferredFull() || tikleapFatal) return;
    const extracted = collectCandidatesFromPayload(payload, seen);
    rawSeen += extracted.rawSeen;
    feedHits += 1;
    if (updateCursor) {
      if (extracted.nextMaxTime != null) nextMaxTime = extracted.nextMaxTime;
      if (
        Object.prototype.hasOwnProperty.call(payload?.extra || {}, "has_more")
      ) {
        hasMore = extracted.hasMore;
      }
    }
    enqueueCandidates(extracted.candidates);
  };

  const waitForResolvers = async (deadline) => {
    while (
      (activeResolvers > 0 ||
        resolveQueue.length > 0 ||
        tikleapPending > 0) &&
      !preferredFull() &&
      !tikleapFatal &&
      Date.now() < deadline
    ) {
      pumpResolvers();
      publishProgress("resolving");
      await sleep(80);
    }
    // Drain in-flight TikLeap lookups even if preferred is full.
    while (tikleapPending > 0 && Date.now() < deadline) {
      publishProgress("resolving");
      await sleep(80);
    }
  };

  try {
    if (reuseSharedBrowser) {
      // Normal path: open tiktok.com/live in a tab of the shared TikLeap Chrome.
      console.log(
        `[browserFetcher] Reusing shared Chrome for TikTok Live tab` +
          ` (${workerN} TikLeap lookup tabs` +
          (strictTikleapGb ? ", strict TikLeap-GB" : "") +
          ")…"
      );
      if (!tikleapClient) {
        const err = new Error(
          "Shared-browser TikTok feed requires an external tikleapClient."
        );
        err.code = "TIKLEAP_SESSION_REQUIRED";
        throw err;
      }
      browserSession = externalBrowserSession;
      const created = await createBackgroundTarget(browserSession, "about:blank");
      const attached = await browserSession.send("Target.attachToTarget", {
        targetId: created.targetId,
        flatten: true,
      });
      sessionId = attached.sessionId;
      // createTarget / attach can restore UI — remimize via CDP on scrape window only.
      try {
        await minimizeChromeWindow(browserSession, [created.targetId], {
          force: true,
        });
      } catch {
        // ignore
      }
    } else if (useSeparateTikTokChrome) {
      // Feed-only (Railway) or opt-in second Chrome: chrome-tiktok-feed-profile.
      console.log(
        `[browserFetcher] Starting TikTok feed Chrome` +
          ` (profile ${TIKTOK_FEED_PROFILE_DIR}` +
          (feedGbOnly
            ? ", feed_gb — no TikLeap"
            : `, ${workerN} TikLeap lookup tabs`) +
          (strictTikleapGb && !feedGbOnly ? ", strict TikLeap-GB" : "") +
          ")…"
      );
      if (!feedGbOnly && !tikleapClient) {
        const err = new Error(
          "separateTikTokChrome with TikLeap gates requires an external tikleapClient."
        );
        err.code = "TIKLEAP_SESSION_REQUIRED";
        throw err;
      }
      tiktokLaunch = await launchTikTokFeedChrome({ timeoutMs: 25000 });
      browserSession = new CdpSession(tiktokLaunch.wsUrl);
      await browserSession.connect();
      const created = await createBackgroundTarget(browserSession, "about:blank");
      const attached = await browserSession.send("Target.attachToTarget", {
        targetId: created.targetId,
        flatten: true,
      });
      sessionId = attached.sessionId;
    } else {
      // Solo path: one Chrome — TikTok Live tab + TikLeap worker tabs.
      console.log(
        `[browserFetcher] Starting single Chrome (${workerN} TikLeap tabs + 1 TikTok Live tab` +
          (strictTikleapGb ? ", strict TikLeap-GB" : "") +
          ")…"
      );
      tikleapLaunch = await launchTikleapChrome({ workers: workerN });
      browserSession = tikleapLaunch.browserSession;
      tikleapClient = createTikleapClient(
        browserSession,
        tikleapLaunch.sessionIds || [tikleapLaunch.sessionId],
        { maxSettleMs: 1400 }
      );
      const tikleapReady = await tikleapClient.ensureReady();
      if (!tikleapReady.ok) {
        const err = new Error(tikleapReady.reason || "TikLeap login required.");
        err.code = "TIKLEAP_SESSION_REQUIRED";
        throw err;
      }

      const created = await createBackgroundTarget(browserSession, "about:blank");
      const attached = await browserSession.send("Target.attachToTarget", {
        targetId: created.targetId,
        flatten: true,
      });
      sessionId = attached.sessionId;
      // createTarget can unminimize — remimize; launch guard also watches.
      try {
        await tikleapLaunch.minimizeOnce?.({ force: true });
      } catch {
        // ignore
      }
    }

    fetchTextInBrowser = async (url) => {
      const expression = `(async () => {
        const target = ${JSON.stringify(url)};
        const viaXhr = () => new Promise((resolve) => {
          try {
            const xhr = new XMLHttpRequest();
            xhr.open("GET", target, true);
            xhr.withCredentials = true;
            xhr.timeout = 12000;
            xhr.setRequestHeader("Accept", "application/json, text/html, */*");
            xhr.onload = () => resolve({
              status: xhr.status || 0,
              text: String(xhr.responseText || "")
            });
            xhr.onerror = () => resolve({ status: 0, text: "", error: "xhr network error" });
            xhr.ontimeout = () => resolve({ status: 0, text: "", error: "xhr timeout" });
            xhr.send();
          } catch (err) {
            resolve({
              status: 0,
              text: "",
              error: String(err && err.message ? err.message : err)
            });
          }
        });
        const viaFetch = async () => {
          try {
            const res = await fetch(target, {
              credentials: "include",
              headers: {
                Accept: "application/json, text/html, */*",
                Referer: "https://www.tiktok.com/live"
              }
            });
            if (!res) return { status: 0, text: "", error: "fetch returned empty" };
            return { status: res.status || 0, text: await res.text() };
          } catch (err) {
            return {
              status: 0,
              text: "",
              error: String(err && err.message ? err.message : err)
            };
          }
        };
        const xhrResult = await viaXhr();
        if (xhrResult.status === 200 && xhrResult.text) return xhrResult;
        const fetchResult = await viaFetch();
        if (fetchResult.status === 200 && fetchResult.text) return fetchResult;
        return xhrResult.error ? xhrResult : fetchResult;
      })()`;
      const evaluated = await browserSession.send(
        "Runtime.evaluate",
        {
          expression,
          awaitPromise: true,
          returnByValue: true,
        },
        sessionId
      );
      return evaluated?.result?.value || null;
    };

    const interestingRequests = new Map();

    browserSession.on("Network.requestWillBeSent", (params) => {
      rememberFeedUrl(params?.request?.url || "");
    });

    browserSession.on("Network.responseReceived", (params) => {
      const url = params?.response?.url || "";
      const requestId = params?.requestId;
      if (!requestId || !looksLikeFeedUrl(url)) return;
      interestingRequests.set(requestId, url);
      rememberFeedUrl(url);
    });

    browserSession.on("Network.loadingFinished", async (params, eventSessionId) => {
      const requestId = params?.requestId;
      if (!requestId || !interestingRequests.has(requestId)) return;
      // Only ingest feed responses from the main Live tab session.
      if (eventSessionId && eventSessionId !== sessionId) return;
      const responseUrl = interestingRequests.get(requestId) || "";
      interestingRequests.delete(requestId);
      if (!useNetworkIngest) return;
      pendingBodies += 1;
      try {
        if (preferredFull() || tikleapFatal) return;
        const bodyResult = await browserSession.send(
          "Network.getResponseBody",
          { requestId },
          sessionId
        );
        const text = bodyResult.base64Encoded
          ? Buffer.from(bodyResult.body, "base64").toString("utf8")
          : bodyResult.body;
        const payload = JSON.parse(text);
        ingestPayload(payload, {
          updateCursor:
            isPreferredSuggestedFeedUrl(responseUrl) ||
            responseUrl.includes("/webcast/feed"),
        });
      } catch {
        // Body may be unavailable or non-JSON.
      } finally {
        pendingBodies = Math.max(0, pendingBodies - 1);
      }
    });

    await browserSession.send("Network.enable", {}, sessionId);
    await browserSession.send("Page.enable", {}, sessionId);

    await browserSession.send(
      "Page.navigate",
      { url: "https://www.tiktok.com/live?lang=en-GB" },
      sessionId
    );
    // Live nav / media can restore the scrape window — remimize without storms.
    try {
      if (tikleapLaunch?.minimizeOnce) {
        await tikleapLaunch.minimizeOnce({ force: true });
      } else {
        await minimizeChromeWindow(browserSession, null, { force: true });
      }
    } catch {
      // ignore
    }

    const started = Date.now();
    const initialWaitMs = Math.min(18000, timeoutMs);
    // Wait for a *paginated* suggested-feed hit (channel_id=86 + max_time).
    // Do not stop on the first thin related-live response.
    while (Date.now() - started < initialWaitMs) {
      if (preferredFull() || tikleapFatal) break;
      if (
        nextMaxTime &&
        capturedFeedUrl &&
        isPreferredSuggestedFeedUrl(capturedFeedUrl) &&
        pendingBodies === 0 &&
        interestingRequests.size === 0
      ) {
        break;
      }
      if ((Date.now() - started) % 2000 < 250) {
        try {
          await browserSession.send(
            "Runtime.evaluate",
            {
              expression:
                "window.scrollBy(0, Math.max(700, window.innerHeight * 0.85));",
            },
            sessionId
          );
        } catch {
          // ignore
        }
      }
      await sleep(200);
    }

    // If we only got a non-preferred URL, keep network ingest a bit longer.
    if (
      !nextMaxTime ||
      !capturedFeedUrl ||
      !isPreferredSuggestedFeedUrl(capturedFeedUrl)
    ) {
      const extendUntil = Date.now() + 8000;
      while (Date.now() < extendUntil) {
        if (nextMaxTime && isPreferredSuggestedFeedUrl(capturedFeedUrl || "")) {
          break;
        }
        try {
          await browserSession.send(
            "Runtime.evaluate",
            {
              expression:
                "window.scrollBy(0, Math.max(900, window.innerHeight));",
            },
            sessionId
          );
        } catch {
          // ignore
        }
        await sleep(400);
      }
    }

    useNetworkIngest = false;

    const fetchFeedPageInBrowser = async (url) => {
      // Prefer XHR — TikTok's patched fetch sometimes resolves undefined in headless.
      const expression = `(async () => {
        const target = ${JSON.stringify(url)};
        const viaXhr = () => new Promise((resolve) => {
          try {
            const xhr = new XMLHttpRequest();
            xhr.open("GET", target, true);
            xhr.withCredentials = true;
            xhr.timeout = 15000;
            xhr.setRequestHeader("Accept", "application/json, text/plain, */*");
            xhr.onload = () => resolve({
              status: xhr.status || 0,
              text: String(xhr.responseText || "")
            });
            xhr.onerror = () => resolve({ status: 0, text: "", error: "xhr network error" });
            xhr.ontimeout = () => resolve({ status: 0, text: "", error: "xhr timeout" });
            xhr.send();
          } catch (err) {
            resolve({
              status: 0,
              text: "",
              error: String(err && err.message ? err.message : err)
            });
          }
        });
        const viaFetch = async () => {
          try {
            const res = await fetch(target, {
              credentials: "include",
              headers: {
                Accept: "application/json, text/plain, */*",
                Referer: "https://www.tiktok.com/live"
              }
            });
            if (!res) return { status: 0, text: "", error: "fetch returned empty" };
            return { status: res.status || 0, text: await res.text() };
          } catch (err) {
            return {
              status: 0,
              text: "",
              error: String(err && err.message ? err.message : err)
            };
          }
        };
        const xhrResult = await viaXhr();
        if (xhrResult.status === 200 && xhrResult.text) return xhrResult;
        const fetchResult = await viaFetch();
        if (fetchResult.status === 200 && fetchResult.text) return fetchResult;
        return xhrResult.error ? xhrResult : fetchResult;
      })()`;
      const evaluated = await browserSession.send(
        "Runtime.evaluate",
        {
          expression,
          awaitPromise: true,
          returnByValue: true,
        },
        sessionId
      );
      return evaluated?.result?.value || null;
    };

    // Headless scroll rarely paginates TikTok Live; drive the signed webcast
    // feed ourselves with max_time using the page's cookie/session context.
    pagesFetched = feedHits;
    publishProgress("scraping");
    let stagnantPages = 0;
    let lastConsumedCursor = null;
    let consecutiveFetchFailures = 0;
    let sessionRecoveries = 0;
    /** Pages ingested with zero TikLeap starts — abort dead feed thrash. */
    let pagesWithoutTikleapStart = 0;
    const tikleapStartsBeforePage = () => tikleapKept + tikleapSkipped + tikleapPending;

    const refreshSignedFeedSession = async () => {
      // Soft reload to obtain a freshly signed webcast/feed URL, then resume
      // pagination from the existing max_time cursor.
      const savedCursor = nextMaxTime;
      const beforeUrl = capturedFeedUrl;
      console.log(
        `[browserFetcher] refreshing signed feed session (cursor=${savedCursor || "none"})…`
      );
      try {
        await browserSession.send("Page.reload", { ignoreCache: true }, sessionId);
      } catch {
        try {
          await browserSession.send(
            "Page.navigate",
            { url: "https://www.tiktok.com/live?lang=en-GB" },
            sessionId
          );
        } catch {
          return false;
        }
      }
      try {
        tikleapLaunch?.scheduleRemimize?.("feedReload");
      } catch {
        // ignore
      }

      const waitUntil = Date.now() + 2800;
      while (Date.now() < waitUntil) {
        if (
          capturedFeedUrl &&
          capturedFeedUrl !== beforeUrl &&
          isPreferredSuggestedFeedUrl(capturedFeedUrl)
        ) {
          break;
        }
        if (
          capturedFeedUrl &&
          capturedFeedUrl !== beforeUrl &&
          capturedFeedUrl.includes("/webcast/feed")
        ) {
          break;
        }
        await sleep(100);
      }
      await sleep(80);

      if (savedCursor != null) nextMaxTime = savedCursor;
      hasMore = true;
      sessionRecoveries += 1;
      consecutiveFetchFailures = 0;
      return Boolean(capturedFeedUrl);
    };

    const loadFeedPage = async (cursor) => {
      let pageResult = null;
      let payload = null;
      for (const stripSignatures of [false, true]) {
        const pageUrl = feedUrlWithMaxTime(capturedFeedUrl, cursor, {
          stripSignatures,
        });
        try {
          pageResult = await fetchFeedPageInBrowser(pageUrl);
        } catch (error) {
          console.warn(
            `[browserFetcher] in-page feed fetch failed: ${error.message}`
          );
          return { pageResult: null, payload: null };
        }
        if (!pageResult || pageResult.error || pageResult.status !== 200) {
          continue;
        }
        try {
          payload = JSON.parse(pageResult.text);
        } catch {
          payload = null;
          continue;
        }
        const statusCode = Number(payload.status_code || 0);
        if (statusCode === 10011 && !stripSignatures) {
          payload = null;
          continue;
        }
        break;
      }
      return { pageResult, payload };
    };

    syncLeads();
    console.log(
      `[browserFetcher] initial capture: ${leads.length}/${limit} leads` +
        ` mode=${confirmMode}` +
        ` (${rawSeen} raw, ${feedHits} feed hits, cursor=${nextMaxTime || "none"},` +
        ` url=${capturedFeedUrl ? "yes" : "no"}, tikleap=${tikleapKept} kept/${tikleapSkipped} skipped)`
    );
    if (confirmMode === "uk_first_fallback" && fallbackNotice) {
      console.warn(`[browserFetcher] ${fallbackNotice}`);
    }
    console.warn(
      `[browserFetcher] TikLeap L30 gate on (${MIN_DIAMONDS_L30.toLocaleString()}–${MAX_DIAMONDS_L30.toLocaleString()} diamonds).`
    );

    // Adaptive pacing: stay aggressive while healthy; ease off on errors.
    let pageDelayMs = 0;
    let pagesSinceRefresh = 0;

    while (
      !preferredFull() &&
      !tikleapFatal &&
      Date.now() - started < timeoutMs &&
      pagesFetched < maxPages &&
      stagnantPages < 24 &&
      !isRefreshProgressStuck()
    ) {
      if (isRefreshProgressStuck()) break;
      if (!capturedFeedUrl) {
        try {
          await browserSession.send(
            "Runtime.evaluate",
            {
              expression:
                "window.scrollBy(0, Math.max(900, document.body.scrollHeight / 3));",
            },
            sessionId
          );
        } catch {
          // ignore
        }
        await sleep(350);
        stagnantPages += 1;
        continue;
      }

      if (!nextMaxTime) {
        console.warn("[browserFetcher] no max_time cursor — stopping pagination");
        break;
      }

      const cursor = nextMaxTime;
      // Same cursor after a successful page means the feed is not advancing.
      if (
        lastConsumedCursor != null &&
        String(cursor) === String(lastConsumedCursor)
      ) {
        console.warn("[browserFetcher] max_time cursor did not advance — stopping");
        break;
      }

      // Proactive refresh rarely — full Live reloads are expensive.
      if (pagesSinceRefresh >= 60 && sessionRecoveries < 8) {
        await refreshSignedFeedSession();
        pagesSinceRefresh = 0;
      }

      const { pageResult, payload } = await loadFeedPage(cursor);

      if (!payload) {
        consecutiveFetchFailures += 1;
        pageDelayMs = Math.min(120, pageDelayMs + 20);
        console.warn(
          `[browserFetcher] feed page status=${pageResult?.status || 0}` +
            (pageResult?.error ? ` error=${pageResult.error}` : "") +
            ` — failure ${consecutiveFetchFailures}`
        );
        // Quick retry before burning time on a Live reload.
        if (consecutiveFetchFailures < 4) {
          await sleep(120 + consecutiveFetchFailures * 80);
          continue;
        }
        if (sessionRecoveries < 8) {
          const ok = await refreshSignedFeedSession();
          pagesSinceRefresh = 0;
          if (!ok) await sleep(200);
          continue;
        }
        // Dead signed session: stop burning the parallel budget at 0 keepers.
        console.warn(
          `[browserFetcher] feed xhr dead after ${sessionRecoveries} session refreshes` +
            ` / ${consecutiveFetchFailures} failures — stopping feed pagination` +
            ` (tikleap=${tikleapKept}/${tikleapSkipped}, pending=${tikleapPending})`
        );
        break;
      }

      consecutiveFetchFailures = 0;
      pageDelayMs = Math.max(0, pageDelayMs - 10);
      pagesFetched += 1;
      pagesSinceRefresh += 1;
      lastConsumedCursor = cursor;

      if (payload.status_code && Number(payload.status_code) !== 0) {
        console.warn(
          `[browserFetcher] feed status_code=${payload.status_code} — stopping pagination`
        );
        break;
      }

      const startsBefore = tikleapStartsBeforePage();
      const beforeRaw = rawSeen;
      ingestPayload(payload, { updateCursor: true });
      if (rawSeen > beforeRaw) {
        stagnantPages = 0;
      } else {
        stagnantPages += 1;
      }
      if (tikleapStartsBeforePage() > startsBefore) {
        pagesWithoutTikleapStart = 0;
      } else {
        pagesWithoutTikleapStart += 1;
      }
      // Feed paging but never verifying — do not spin for 15+ minutes at 0 lookups.
      if (
        pagesFetched >= 25 &&
        pagesWithoutTikleapStart >= 20 &&
        tikleapPending === 0 &&
        tikleapKept === 0 &&
        tikleapSkipped === 0
      ) {
        console.warn(
          `[browserFetcher] feed produced ${pagesFetched} pages / ${rawSeen} raw` +
            ` with 0 TikLeap lookups — stopping feed path early`
        );
        break;
      }

      publishProgress("resolving");

      syncLeads();
      if (
        pagesFetched <= 3 ||
        pagesFetched % 10 === 0 ||
        preferredFull() ||
        !hasMore
      ) {
        const tlStats = tikleapClient?.stats?.() || {};
        console.log(
          `[browserFetcher] page ${pagesFetched}: ${leads.length}/${limit} leads` +
            ` mode=${confirmMode} (${rawSeen} raw, lookups=${lookups}, countryHits=${countryHits},` +
            ` tikleap=${tikleapKept}/${tikleapSkipped},` +
            ` queue=${resolveQueue.length}+${tikleapPending}` +
            (tlStats.workers ? ` workers=${tlStats.workers}` : "") +
            `, hasMore=${hasMore}, max_time=${nextMaxTime || "none"})`
        );
      }

      // Keep TikLeap workers fed but don't bury them under a 100+ backlog while
      // the feed keeps paging — drain when the pending queue gets deep.
      const workerCap = tikleapClient?.concurrency || workerN;
      if (tikleapPending >= workerCap * 6 && !preferredFull()) {
        await waitForResolvers(
          Math.min(Date.now() + 8000, started + timeoutMs)
        );
      }

      if (!hasMore) break;
      if (pageDelayMs > 0) await sleep(pageDelayMs);
    }

    // Finish in-flight region lookups / TikLeap lookups within the remaining budget.
    await waitForResolvers(started + timeoutMs);

    if (tikleapFatal) throw tikleapFatal;

    syncLeads();
    publishProgress("resolving");
    console.log(
      `[browserFetcher] done: ${leads.length}/${limit} leads mode=${confirmMode}, rawSeen=${rawSeen},` +
        ` lookups=${lookups}, countryHits=${countryHits}, gbHits=${gbHits},` +
        ` tikleapKept=${tikleapKept}, tikleapSkipped=${tikleapSkipped},` +
        ` monthOverCap=${monthOverCapSkipped}, countrySkip=${countrySkipped},` +
        ` preferred=${preferred.length}, secondary=${secondary.length},` +
        ` feedHits=${feedHits}, pages=${pagesFetched}, elapsed=${Date.now() - started}ms` +
        (hasMore ? " (feed still had more)" : " (feed exhausted or no cursor)")
    );
    if (!strictTikleapGb) {
      console.log(
        `[browserFetcher] region probe: ${countryHits}/${lookups} lookups returned a country field` +
          ` (${lookups ? Math.round((countryHits / lookups) * 100) : 0}%);` +
          ` mode=${confirmMode}` +
          (fallbackNotice ? ` — ${fallbackNotice}` : "")
      );
    }

    if (!leads.length) {
      if (!nextMaxTime || !capturedFeedUrl) {
        const err = new Error(
          "Chrome opened Live but did not capture a signed suggested-feed cursor (max_time). " +
            "Run the server from Terminal.app (cd lead-finder && ./start.sh), then Get leads again."
        );
        err.code = "FEED_CURSOR_MISSING";
        throw err;
      }
      if (strictTikleapGb) {
        // Soft empty — primary keepers may still be returned by the orchestrator.
        return {
          leads: [],
          pages: Math.max(feedHits, pagesFetched, 1),
          rawSeen,
          lookups,
          countryHits,
          gbHits,
          tikleapKept: 0,
          tikleapSkipped,
          monthOverCapSkipped,
          countrySkipped,
          confirmMode,
          fallbackNotice:
            `TikTok suggested-feed found no GB keepers` +
            ` (TikLeap-verified or feed GB/UK signal; skipped ${tikleapSkipped}:` +
            ` current-month-over-cap ${monthOverCapSkipped}, country ${countrySkipped}).`,
          source: "tiktok_live_suggested_chrome",
          inventoryExhausted: true,
          chromeStrategy: {
            mode: reuseSharedBrowser
              ? "shared_tikleap_browser_live_tab"
              : useSeparateTikTokChrome
                ? "separate_tiktok_feed_profile"
                : "single_tikleap_profile",
            headless: !(
              process.env.LEAD_FINDER_HEADED === "1" ||
              process.env.LEAD_FINDER_HEADED === "true"
            ),
            tikleapWorkers: workerN,
          },
        };
      }
      throw new Error(
        `Chrome scraped the live feed but found no UK creators with TikLeap L30 diamonds ${MIN_DIAMONDS_L30.toLocaleString()}–${MAX_DIAMONDS_L30.toLocaleString()}` +
          ` (tikleap skipped ${tikleapSkipped}). Confirm Premium history is visible, re-run ./scripts/tikleap-login.sh if needed.`
      );
    }

    return {
      leads: leads.slice(0, limit).map((lead) => sanitizeLeadForStore(lead)),
      pages: Math.max(feedHits, pagesFetched, 1),
      rawSeen,
      lookups,
      countryHits,
      gbHits,
      tikleapKept,
      tikleapSkipped,
      monthOverCapSkipped,
      countrySkipped,
      confirmMode,
      fallbackNotice: strictTikleapGb
        ? `TikTok suggested-feed added ${leads.length}` +
          ` (TikLeap GB or feed GB/UK signal; current-month-over-cap ${monthOverCapSkipped},` +
          ` country-skip ${countrySkipped}).`
        : fallbackNotice,
      source: "tiktok_live_suggested_chrome",
      inventoryExhausted: !hasMore || stagnantPages >= 24,
      chromeStrategy: {
        mode: reuseSharedBrowser
          ? "shared_tikleap_browser_live_tab"
          : useSeparateTikTokChrome
            ? "separate_tiktok_feed_profile"
            : "single_tikleap_profile",
        headless: !(
          process.env.LEAD_FINDER_HEADED === "1" ||
          process.env.LEAD_FINDER_HEADED === "true"
        ),
        tikleapWorkers: workerN,
      },
    };
  } finally {
    cleanup();
  }
}

module.exports = {
  fetchViaChrome,
  findChrome,
  findChromeBinaries,
  launchChromeDebug,
  CURSOR_TRANSFORM_HINT,
};
