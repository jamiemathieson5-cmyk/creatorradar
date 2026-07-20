/**
 * TikLeap last-30-day diamond lookups for Get leads.
 *
 * Uses the persistent Premium login profile from ./scripts/tikleap-login.sh.
 * TikLeap Chrome defaults to headed + kept minimized (Cloudflare/cf_clearance is
 * unreliable under --headless=new). Window control is CDP-only against the
 * scrape browser's debugging port — never AppleScript/hide on generic
 * "Google Chrome". createTarget uses background:true; a debounced CDP guard
 * remimizes only when windowState is not minimized (no focus-steal storms).
 * The chrome-tikleap-profile instance is reused across Get leads runs and soft
 * server restarts; cleanup disconnects CDP but does not kill Chrome. Opt into
 * headless with LEAD_FINDER_TIKLEAP_HEADLESS=1. TikTok Live feed reuses this
 * same browser (a Live tab). Login: ./scripts/tikleap-login.sh.
 */

require("./wsPolyfill");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const net = require("net");
const { spawn, execSync } = require("child_process");
const {
  MIN_DIAMONDS_L30,
  MAX_DIAMONDS_L30,
  INACTIVE_DIAMONDS_L30,
  MAX_DIAMONDS_CURRENT_MONTH,
  MAX_DIAMONDS_ANY_MONTH,
  MIN_DIAMONDS_L28,
  PREFER_DIAMONDS_L28,
  DEFAULT_TIKLEAP_LOOKUP_WORKERS,
  MAX_TIKLEAP_CHROME_TABS,
} = require("./constants");
const { normalizeRegion, isGbRegion } = require("./regionFilter");

const DATA_DIR = path.join(__dirname, "..", "data");
const COOKIES_PATH =
  process.env.TIKLEAP_COOKIES_PATH ||
  path.join(DATA_DIR, "tikleap-cookies.json");
const PROFILE_DIR =
  process.env.TIKLEAP_USER_DATA_DIR ||
  path.join(DATA_DIR, "chrome-tikleap-profile");
/** Persisted debug port so soft restarts can reconnect without relaunch. */
const DEBUG_META_PATH =
  process.env.TIKLEAP_DEBUG_META_PATH ||
  path.join(DATA_DIR, "chrome-tikleap-debug.json");
const L28_CACHE_PATH =
  process.env.TIKLEAP_L28_CACHE_PATH ||
  path.join(DATA_DIR, "tikleap-l28-cache.json");
/** Reuse L28 results for a week so Get leads does not re-scrape the same handles. */
const L28_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const BLOCKED_RESOURCE_URLS = [
  "*.woff",
  "*.woff2",
  "*.ttf",
  "*.otf",
  "*.png",
  "*.jpg",
  "*.jpeg",
  "*.gif",
  "*.webp",
  "*.svg",
  "*.ico",
  "*.mp4",
  "*.webm",
  "*fonts.googleapis.com*",
  "*fonts.gstatic.com*",
  "*google-analytics.com*",
  "*googletagmanager.com*",
  "*facebook.net*",
  "*hotjar.com*",
];

const CHROME_CANDIDATES = [
  process.env.LEAD_FINDER_CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
].filter(Boolean);

const DEVTOOLS_URL_RE = /DevTools listening on (ws:\/\/[^\s]+)/;
const USD_PER_DIAMOND = 0.005;

const PROFILE_URL = (username) =>
  `https://www.tikleap.com/profile/${encodeURIComponent(
    String(username || "")
      .trim()
      .replace(/^@+/, "")
      .toLowerCase()
  )}`;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function cookiesPath() {
  return COOKIES_PATH;
}

function profileDir() {
  return PROFILE_DIR;
}

function findChrome() {
  for (const c of CHROME_CANDIDATES) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
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

/**
 * Kill ONLY Chrome processes whose argv contain this exact user-data-dir.
 * Never targets the user's default/personal Chrome profile.
 */
function releaseProfileLock(userDataDir) {
  const dir = String(userDataDir || "").trim();
  if (!dir || dir === path.join(os.homedir(), "Library", "Application Support", "Google", "Chrome")) {
    console.warn("[tikleap] Refusing to pkill without an explicit scrape profile dir");
    return;
  }
  try {
    // macOS pkill/pgrep reject patterns that look like flags (leading `--`).
    execSync(
      `pkill -f ${JSON.stringify(`user-data-dir=${dir}`)} || true`,
      { stdio: "ignore" }
    );
  } catch {
    // ignore
  }
  for (const name of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
    try {
      fs.unlinkSync(path.join(dir, name));
    } catch {
      // ignore
    }
  }
  try {
    fs.unlinkSync(DEBUG_META_PATH);
  } catch {
    // ignore
  }
}

function saveDebugMeta(port, wsUrl) {
  ensureDataDir();
  try {
    fs.writeFileSync(
      DEBUG_META_PATH,
      JSON.stringify(
        {
          port: Number(port),
          wsUrl: wsUrl || null,
          profileDir: PROFILE_DIR,
          updatedAt: new Date().toISOString(),
        },
        null,
        2
      ),
      "utf8"
    );
  } catch {
    // ignore
  }
}

function readDebugMeta() {
  try {
    if (!fs.existsSync(DEBUG_META_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(DEBUG_META_PATH, "utf8"));
    const port = Number(raw?.port);
    if (!Number.isFinite(port) || port <= 0) return null;
    return { port, wsUrl: raw?.wsUrl || null, profileDir: raw?.profileDir || null };
  } catch {
    return null;
  }
}

/** Chrome writes DevToolsActivePort inside user-data-dir while debugging is on. */
function readDevToolsActivePort(userDataDir) {
  try {
    const file = path.join(userDataDir, "DevToolsActivePort");
    if (!fs.existsSync(file)) return null;
    const lines = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
    const port = Number(lines[0]);
    if (!Number.isFinite(port) || port <= 0) return null;
    const browserPath = String(lines[1] || "").trim();
    const wsUrl = browserPath
      ? browserPath.startsWith("ws")
        ? browserPath
        : `ws://127.0.0.1:${port}${browserPath.startsWith("/") ? "" : "/"}${browserPath}`
      : null;
    return { port, wsUrl };
  } catch {
    return null;
  }
}

async function probeDebuggerWsUrl(port) {
  const n = Number(port);
  if (!Number.isFinite(n) || n <= 0) return null;
  try {
    const version = await httpGetJson(`http://127.0.0.1:${n}/json/version`);
    return version?.webSocketDebuggerUrl || null;
  } catch {
    return null;
  }
}

function loadCookies() {
  try {
    if (!fs.existsSync(COOKIES_PATH)) return [];
    const raw = JSON.parse(fs.readFileSync(COOKIES_PATH, "utf8"));
    const list = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.cookies)
        ? raw.cookies
        : [];
    return list.filter((c) => c && c.name);
  } catch {
    return [];
  }
}

function saveCookies(cookies) {
  ensureDataDir();
  const list = (Array.isArray(cookies) ? cookies : []).filter(
    (c) => c && c.name
  );
  const tmp = `${COOKIES_PATH}.tmp`;
  fs.writeFileSync(
    tmp,
    JSON.stringify(
      { cookies: list, updatedAt: new Date().toISOString() },
      null,
      2
    ),
    "utf8"
  );
  fs.renameSync(tmp, COOKIES_PATH);
  return list.length;
}

function hasCookieJar() {
  return loadCookies().length > 0 || fs.existsSync(PROFILE_DIR);
}

function hasLoginProfile() {
  return (
    fs.existsSync(PROFILE_DIR) &&
    (fs.existsSync(path.join(PROFILE_DIR, "Default")) ||
      fs.existsSync(path.join(PROFILE_DIR, "Local State")) ||
      loadCookies().some((c) => c.name === "tikleap_session"))
  );
}

/**
 * Light current-month history budget (~4 days/page). Profile seed HTML often
 * already covers recent days; paginate only until current month is known or
 * we hit an older month (history is reverse-chronological).
 */
const CURRENT_MONTH_HISTORY_MAX_PAGES = 10;

/** @type {Map<string, { diamondsL30: number|null, diamondsL28?: number|null, maxMonthDiamonds?: number|null, monthOverCap?: boolean, monthlyKnown?: boolean, masked?: boolean, skipped?: boolean, source?: string|null, at: number }>|null} */
let diskCache = null;
let diskCacheDirty = false;

function loadDiskCache() {
  if (diskCache) return diskCache;
  diskCache = new Map();
  try {
    if (!fs.existsSync(L28_CACHE_PATH)) return diskCache;
    const raw = JSON.parse(fs.readFileSync(L28_CACHE_PATH, "utf8"));
    const entries = raw?.entries && typeof raw.entries === "object" ? raw.entries : raw;
    if (!entries || typeof entries !== "object") return diskCache;
    const now = Date.now();
    for (const [key, value] of Object.entries(entries)) {
      if (!value || typeof value !== "object") continue;
      const at = Number(value.at) || 0;
      if (at && now - at > L28_CACHE_TTL_MS) continue;
      const n =
        value.diamondsL30 != null
          ? Number(value.diamondsL30)
          : value.diamondsL28 != null
            ? Number(value.diamondsL28)
            : null;
      const maxMonth =
        value.maxMonthDiamonds != null ? Number(value.maxMonthDiamonds) : null;
      const currentMonth =
        value.currentMonthDiamonds != null
          ? Number(value.currentMonthDiamonds)
          : null;
      const country = normalizeRegion(value.country) || null;
      diskCache.set(String(key).toLowerCase(), {
        diamondsL30: Number.isFinite(n) ? n : null,
        diamondsL28: Number.isFinite(n) ? n : null,
        maxMonthDiamonds: Number.isFinite(maxMonth) ? maxMonth : null,
        currentMonthDiamonds: Number.isFinite(currentMonth)
          ? currentMonth
          : null,
        currentMonthKey: value.currentMonthKey || null,
        monthGate: value.monthGate || null,
        monthOverCap: Boolean(value.monthOverCap),
        monthlyKnown: Boolean(value.monthlyKnown),
        country,
        countrySource: country ? value.countrySource || "disk_cache" : null,
        masked: Boolean(value.masked),
        skipped: Boolean(value.skipped),
        source: value.source || "disk_cache",
        at,
      });
    }
  } catch {
    // ignore corrupt cache
  }
  return diskCache;
}

function persistDiskCache() {
  if (!diskCacheDirty || !diskCache) return;
  ensureDataDir();
  const entries = {};
  for (const [key, value] of diskCache.entries()) {
    entries[key] = value;
  }
  const tmp = `${L28_CACHE_PATH}.tmp`;
  fs.writeFileSync(
    tmp,
    JSON.stringify({ updatedAt: new Date().toISOString(), entries }, null, 2),
    "utf8"
  );
  fs.renameSync(tmp, L28_CACHE_PATH);
  diskCacheDirty = false;
}

function readDiskCache(username) {
  const key = String(username || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
  if (!key) return null;
  const hit = loadDiskCache().get(key);
  if (!hit) return null;
  if (hit.at && Date.now() - hit.at > L28_CACHE_TTL_MS) {
    loadDiskCache().delete(key);
    diskCacheDirty = true;
    return null;
  }
  return hit;
}

/** Durable premium-mask sources — safe to cache. Transient paint misses are not. */
const DURABLE_MASK_SOURCES = new Set([
  "premium_gate",
  "last_n_masked",
  "period_masked",
]);

function writeDiskCache(username, result) {
  const key = String(username || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
  if (!key || !result) return;
  // Only persist durable outcomes (parsed L30 or clear premium mask).
  if (
    result.sessionDead ||
    result.source === "cloudflare" ||
    result.source === "login_wall" ||
    result.source === "session_dead" ||
    result.source === "unparsed" ||
    result.source == null
  ) {
    return;
  }
  const n =
    result.diamondsL30 != null
      ? Number(result.diamondsL30)
      : result.diamondsL28 != null
        ? Number(result.diamondsL28)
        : NaN;
  // Masked-without-number: only cache durable premium gates (not slow paint).
  if (!Number.isFinite(n)) {
    if (!(result.masked && DURABLE_MASK_SOURCES.has(result.source))) return;
  }
  const maxMonth =
    result.maxMonthDiamonds != null ? Number(result.maxMonthDiamonds) : null;
  const currentMonth =
    result.currentMonthDiamonds != null
      ? Number(result.currentMonthDiamonds)
      : null;
  const country = normalizeRegion(result.country) || null;
  loadDiskCache().set(key, {
    diamondsL30: Number.isFinite(n) ? n : null,
    diamondsL28: Number.isFinite(n) ? n : null,
    maxMonthDiamonds: Number.isFinite(maxMonth) ? maxMonth : null,
    currentMonthDiamonds: Number.isFinite(currentMonth) ? currentMonth : null,
    currentMonthKey: result.currentMonthKey || null,
    monthGate: "current",
    monthOverCap: Boolean(result.monthOverCap),
    monthlyKnown: Boolean(result.monthlyKnown),
    country,
    countrySource: country ? result.countrySource || null : null,
    masked: Boolean(result.masked),
    skipped: Boolean(result.skipped) || !Number.isFinite(n),
    source: result.source || null,
    at: Date.now(),
  });
  diskCacheDirty = true;
  if (loadDiskCache().size % 25 === 0) persistDiskCache();
}

function parseCompactNumber(raw) {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.floor(raw);
  let s = String(raw).trim();
  if (!s || /[?]{2,}/.test(s)) return null;
  s = s.replace(/,/g, "").replace(/\s+/g, "");
  const m = s.match(/^([+-]?\d+(?:\.\d+)?)([kKmMbB])?$/);
  if (!m) {
    const digits = s.replace(/[^\d.]/g, "");
    const n = Number(digits);
    return Number.isFinite(n) ? Math.floor(n) : null;
  }
  let n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const suf = (m[2] || "").toLowerCase();
  if (suf === "k") n *= 1e3;
  else if (suf === "m") n *= 1e6;
  else if (suf === "b") n *= 1e9;
  return Math.floor(n);
}

function dollarsToDiamonds(dollars) {
  if (!Number.isFinite(dollars)) return null;
  return Math.floor(dollars / USD_PER_DIAMOND);
}

function looksMaskedText(text) {
  const s = String(text || "");
  return /\?\?\?/.test(s) || /Visible to Premium/i.test(s);
}

function pickDateMs(item) {
  for (const key of ["date", "day", "period", "time", "timestamp", "ts"]) {
    const v = item[key];
    if (v == null) continue;
    if (typeof v === "number" && Number.isFinite(v)) {
      return v < 1e12 ? v * 1000 : v;
    }
    const s = String(v).trim();
    const dmY = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (dmY) {
      return Date.UTC(Number(dmY[3]), Number(dmY[2]) - 1, Number(dmY[1]));
    }
    const parsed = Date.parse(s);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function pickDiamondField(item) {
  for (const key of [
    "diamonds",
    "diamond",
    "diamond_count",
    "diamondCount",
    "coins",
  ]) {
    if (item[key] != null) {
      const n = parseCompactNumber(item[key]);
      if (n != null) return n;
    }
  }
  for (const key of ["earnings", "earning", "usd", "amount", "revenue"]) {
    if (item[key] != null) {
      const dollars = parseCompactNumber(
        String(item[key]).replace(/^[€£$≈~\s]+/, "")
      );
      if (dollars == null) continue;
      if (dollars >= 50000) return dollars;
      return dollarsToDiamonds(dollars);
    }
  }
  return null;
}

function sumDiamondsFromJson(node, days = 28, depth = 0) {
  if (node == null || depth > 10) return null;
  if (Array.isArray(node)) {
    if (node.length >= 7 && node.length <= 90) {
      const points = [];
      for (const item of node) {
        if (!item || typeof item !== "object") continue;
        const diamonds = pickDiamondField(item);
        if (diamonds == null) continue;
        points.push({ diamonds, dateMs: pickDateMs(item) });
      }
      if (points.length >= 7) {
        points.sort((a, b) => (b.dateMs || 0) - (a.dateMs || 0));
        return points.slice(0, days).reduce((a, p) => a + p.diamonds, 0);
      }
    }
    for (const item of node) {
      const hit = sumDiamondsFromJson(item, days, depth + 1);
      if (hit != null) return hit;
    }
    return null;
  }
  if (typeof node === "object") {
    for (const value of Object.values(node)) {
      if (value && typeof value === "object") {
        const hit = sumDiamondsFromJson(value, days, depth + 1);
        if (hit != null) return hit;
      }
    }
  }
  return null;
}

function scaleDollarsWindowToL30(dollars, periodDays) {
  if (!Number.isFinite(dollars) || !(periodDays > 0)) return null;
  let diamonds = dollars >= 50000 ? dollars : dollarsToDiamonds(dollars);
  if (diamonds == null) return null;
  if (periodDays !== 30) {
    diamonds = Math.floor((diamonds * 30) / periodDays);
  }
  return diamonds;
}

/** @deprecated Use scaleDollarsWindowToL30 */
function scaleDollarsWindowToL28(dollars, periodDays) {
  return scaleDollarsWindowToL30(dollars, periodDays);
}

function withDiamondAliases(result) {
  if (!result || typeof result !== "object") return result;
  const n =
    result.diamondsL30 != null
      ? result.diamondsL30
      : result.diamondsL28 != null
        ? result.diamondsL28
        : null;
  const currentMonth =
    result.currentMonthDiamonds != null
      ? Number(result.currentMonthDiamonds)
      : null;
  const maxMonth =
    result.maxMonthDiamonds != null
      ? Number(result.maxMonthDiamonds)
      : Number.isFinite(currentMonth)
        ? currentMonth
        : null;
  const monthOverCap =
    Boolean(result.monthOverCap) ||
    (Number.isFinite(currentMonth) &&
      currentMonth >= MAX_DIAMONDS_CURRENT_MONTH);
  const country = normalizeRegion(result.country) || null;
  return {
    ...result,
    diamondsL30: n,
    diamondsL28: n,
    currentMonthDiamonds: Number.isFinite(currentMonth) ? currentMonth : null,
    currentMonthKey: result.currentMonthKey || null,
    maxMonthDiamonds: Number.isFinite(maxMonth) ? maxMonth : null,
    monthOverCap,
    monthlyKnown: Boolean(result.monthlyKnown),
    monthGate: result.monthGate || "current",
    country,
    countrySource: country ? result.countrySource || null : null,
    countryIsGb: Boolean(country && isGbRegion(country)),
  };
}

/**
 * Parse creator country from TikLeap profile HTML (rating cup /country/xx,
 * "No N. in …", or UK flag in the profile name).
 * @returns {{ country: string|null, countrySource: string|null }}
 */
function parseCountryFromProfile(text) {
  const raw = String(text || "");
  if (!raw.trim()) return { country: null, countrySource: null };

  const ratingHref =
    raw.match(
      /class="[^"]*profile-rating-score[^"]*"[^>]*href="https?:\/\/(?:www\.)?tikleap\.com\/country\/([a-z0-9-]+)"/i
    ) ||
    raw.match(
      /href="https?:\/\/(?:www\.)?tikleap\.com\/country\/([a-z0-9-]+)"[^>]*class="[^"]*profile-rating-score/i
    );
  if (ratingHref) {
    const country = normalizeRegion(ratingHref[1]);
    if (country) {
      return { country, countrySource: "tikleap_rating" };
    }
  }

  const inCountry = raw.match(
    /No\.?\s*\d+\.?\s+in\s+([A-Za-z][A-Za-z\s.'-]+?)(?:\s*<|\s*$|\s*\n)/i
  );
  if (inCountry) {
    const country = normalizeRegion(inCountry[1].trim());
    if (country) {
      return { country, countrySource: "tikleap_rank_label" };
    }
  }

  const nameBlock = raw.match(
    /class="profile-info-name"[^>]*>([\s\S]*?)<\/div>/i
  );
  if (nameBlock && /🇬🇧/.test(nameBlock[1])) {
    return { country: "GB", countrySource: "tikleap_flag" };
  }
  if (/🇬🇧/.test(raw.slice(0, 4000))) {
    return { country: "GB", countrySource: "tikleap_flag" };
  }

  const anyCountry = raw.match(
    /(?:www\.)?tikleap\.com\/country\/([a-z0-9-]+)/i
  );
  if (anyCountry) {
    const country = normalizeRegion(anyCountry[1]);
    if (country) {
      return { country, countrySource: "tikleap_country_link" };
    }
  }

  return { country: null, countrySource: null };
}

/**
 * Parse daily earnings rows from TikLeap profile / profile-history HTML.
 * Prefers data-original USD (precise); falls back to displayed $ text.
 * @returns {Array<{ date: string, dollars: number, diamonds: number }>}
 */
function parseHistoryPeriodsFromHtml(html) {
  const raw = String(html || "").replace(/\\\//g, "/");
  if (!raw.trim()) return [];
  const out = [];
  const seen = new Set();
  const re =
    /profile-history-date[^>]*>\s*(\d{1,2}\.\d{1,2}\.\d{4})[\s\S]{0,600}?data-original="([\d.]+)"/gi;
  let match;
  while ((match = re.exec(raw))) {
    const date = match[1];
    const dollars = Number(match[2]);
    if (!Number.isFinite(dollars) || seen.has(date)) continue;
    seen.add(date);
    out.push({
      date,
      dollars,
      diamonds: Math.floor(dollars / USD_PER_DIAMOND),
    });
  }
  if (out.length) return out;

  // Fallback: date + $ amount text (no data-original).
  const loose =
    /profile-history-date[^>]*>\s*(\d{1,2}\.\d{1,2}\.\d{4})[\s\S]{0,600}?\$\s*([\d,.]+[kKmMbB]?)/gi;
  while ((match = loose.exec(raw))) {
    const date = match[1];
    const dollars = parseCompactNumber(match[2]);
    if (dollars == null || seen.has(date)) continue;
    seen.add(date);
    out.push({
      date,
      dollars,
      diamonds: Math.floor(dollars / USD_PER_DIAMOND),
    });
  }
  return out;
}

/** @param {string} dmy DD.MM.YYYY → YYYY-MM */
function calendarMonthKey(dmy) {
  const m = String(dmy || "").match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, "0")}`;
}

/** YYYY-MM for the current local calendar month. */
function currentCalendarMonthKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * Sum daily period diamonds for one calendar month (default: current).
 * History is typically newest-first; sawOlderMonth means we have full coverage
 * of the target month without needing deeper pagination.
 * @param {Array<{ date: string, diamonds: number }>} periods
 * @param {string} [monthKey]
 */
function sumCurrentMonthDiamonds(periods, monthKey = currentCalendarMonthKey()) {
  let total = 0;
  let dayCount = 0;
  let sawOlderMonth = false;
  /** @type {Record<string, number>} */
  const byMonth = {};
  for (const p of periods || []) {
    const key = calendarMonthKey(p.date);
    if (!key) continue;
    const n = Number(p.diamonds);
    if (!Number.isFinite(n)) continue;
    const diamonds = Math.floor(n);
    byMonth[key] = (byMonth[key] || 0) + diamonds;
    if (key === monthKey) {
      total += diamonds;
      dayCount += 1;
    } else if (key < monthKey) {
      sawOlderMonth = true;
    }
  }
  const currentMonthDiamonds = dayCount > 0 ? total : null;
  return {
    byMonth,
    currentMonthKey: monthKey,
    currentMonthDiamonds,
    currentMonthDayCount: dayCount,
    sawOlderMonth,
    maxMonthDiamonds: currentMonthDiamonds,
    maxMonthKey: dayCount > 0 ? monthKey : null,
    monthOverCap:
      Number.isFinite(currentMonthDiamonds) &&
      currentMonthDiamonds >= MAX_DIAMONDS_CURRENT_MONTH,
    monthlyKnown: dayCount > 0,
    periodCount: Array.isArray(periods) ? periods.length : 0,
  };
}

/** @deprecated Prefer sumCurrentMonthDiamonds — any-month peak gate removed. */
function aggregateMonthlyDiamonds(periods) {
  return sumCurrentMonthDiamonds(periods);
}

/**
 * Light-fetch current calendar month diamonds from profile seed HTML + a few
 * /profile-history pages. Missing / empty current-month data ⇒ monthlyKnown=false
 * (do not exclude). Stops early on over-cap or once an older month appears.
 *
 * @param {object} browserSession
 * @param {string} sessionId
 * @param {string} username
 * @param {string} [seedHtml] profile page HTML (recent periods)
 */
async function fetchCurrentMonthFromHistory(
  browserSession,
  sessionId,
  username,
  seedHtml = ""
) {
  const key = String(username || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
  const monthKey = currentCalendarMonthKey();
  if (!key) {
    return {
      currentMonthDiamonds: null,
      currentMonthKey: monthKey,
      maxMonthDiamonds: null,
      monthOverCap: false,
      monthlyKnown: false,
      periodCount: 0,
      source: null,
      monthGate: "current",
    };
  }

  const byDate = new Map();
  const addPeriods = (list) => {
    for (const p of list || []) {
      if (!p?.date || byDate.has(p.date)) continue;
      byDate.set(p.date, p);
    }
  };
  addPeriods(parseHistoryPeriodsFromHtml(seedHtml));

  let page = 2;
  let hasMore = true;
  let pagesFetched = 0;
  let source = byDate.size ? "profile_html" : null;

  const summarize = () => sumCurrentMonthDiamonds([...byDate.values()], monthKey);

  // Seed alone may already answer the gate (over-cap or older month visible).
  {
    const seedAgg = summarize();
    if (seedAgg.monthOverCap || (seedAgg.monthlyKnown && seedAgg.sawOlderMonth)) {
      return {
        currentMonthDiamonds: seedAgg.currentMonthDiamonds,
        currentMonthKey: monthKey,
        maxMonthDiamonds: seedAgg.currentMonthDiamonds,
        maxMonthKey: seedAgg.maxMonthKey,
        monthOverCap: Boolean(seedAgg.monthOverCap),
        monthlyKnown: Boolean(seedAgg.monthlyKnown),
        periodCount: seedAgg.periodCount,
        byMonth: seedAgg.byMonth,
        source: source || "profile_html",
        monthGate: "current",
      };
    }
  }

  while (hasMore && pagesFetched < CURRENT_MONTH_HISTORY_MAX_PAGES) {
    const agg = summarize();
    if (agg.monthOverCap || (agg.monthlyKnown && agg.sawOlderMonth)) {
      return {
        currentMonthDiamonds: agg.currentMonthDiamonds,
        currentMonthKey: monthKey,
        maxMonthDiamonds: agg.currentMonthDiamonds,
        maxMonthKey: agg.maxMonthKey,
        monthOverCap: Boolean(agg.monthOverCap),
        monthlyKnown: Boolean(agg.monthlyKnown),
        periodCount: agg.periodCount,
        byMonth: agg.byMonth,
        source: source || "profile_history",
        monthGate: "current",
      };
    }

    const url = `https://www.tikleap.com/profile-history/${encodeURIComponent(
      key
    )}/${page}`;
    let payload;
    try {
      const evaluated = await browserSession.send(
        "Runtime.evaluate",
        {
          expression: `(async () => {
            try {
              const res = await fetch(${JSON.stringify(url)}, {
                credentials: "include",
                headers: { Accept: "application/json, text/plain, */*" },
              });
              const text = await res.text();
              return { status: res.status || 0, text };
            } catch (err) {
              return {
                status: 0,
                text: "",
                error: String(err && err.message ? err.message : err),
              };
            }
          })()`,
          awaitPromise: true,
          returnByValue: true,
        },
        sessionId
      );
      payload = evaluated?.result?.value || { status: 0, text: "" };
    } catch {
      break;
    }

    pagesFetched += 1;
    let html = "";
    let nextHasMore = false;
    if (payload.status === 200 && payload.text) {
      try {
        const json = JSON.parse(payload.text);
        if (json && typeof json.html === "string") html = json.html;
        nextHasMore = Boolean(json?.has_more) && Boolean(json?.next);
      } catch {
        html = payload.text;
        nextHasMore = false;
      }
    }

    const batch = parseHistoryPeriodsFromHtml(html);
    if (!batch.length) {
      hasMore = false;
      break;
    }
    addPeriods(batch);
    source = source === "profile_html" ? "profile_html+history" : "profile_history";
    hasMore = nextHasMore;
    page += 1;
  }

  const agg = summarize();
  if (!agg.monthlyKnown) {
    return {
      currentMonthDiamonds: null,
      currentMonthKey: monthKey,
      maxMonthDiamonds: null,
      monthOverCap: false,
      monthlyKnown: false,
      periodCount: agg.periodCount,
      source: source || null,
      monthGate: "current",
    };
  }
  return {
    currentMonthDiamonds: agg.currentMonthDiamonds,
    currentMonthKey: monthKey,
    maxMonthDiamonds: agg.currentMonthDiamonds,
    maxMonthKey: agg.maxMonthKey,
    monthOverCap: Boolean(agg.monthOverCap),
    monthlyKnown: true,
    periodCount: agg.periodCount,
    byMonth: agg.byMonth,
    source,
    monthGate: "current",
  };
}

/** @deprecated Use fetchCurrentMonthFromHistory */
async function fetchMonthlyPeakFromHistory(
  browserSession,
  sessionId,
  username,
  seedHtml = ""
) {
  return fetchCurrentMonthFromHistory(
    browserSession,
    sessionId,
    username,
    seedHtml
  );
}

/**
 * Parse TikLeap profile HTML or plain innerText for L30 diamonds.
 */
function parseProfilePayload(text) {
  const raw = String(text || "");
  if (!raw.trim()) {
    return withDiamondAliases({ diamondsL30: null, masked: false, source: null });
  }

  if (/Attention Required|cf-browser-verification|Just a moment/i.test(raw)) {
    return withDiamondAliases({
      diamondsL30: null,
      masked: true,
      source: "cloudflare",
    });
  }

  const masked =
    /Visible to Premium users/i.test(raw) ||
    (/\?\?\?/.test(raw) && /estimated earnings/i.test(raw));

  const flat = raw.replace(/\s+/g, " ").trim();

  // Best: "Estimated earnings ≈ $2,834 Last 10 days"
  const estLast = flat.match(
    /Estimated earnings\s*≈?\s*\$?\s*([\d,.]+[kKmMbB]?)\s*Last\s+(\d+)\s+days/i
  );
  if (estLast) {
    const dollars = parseCompactNumber(estLast[1]);
    const days = Number(estLast[2]);
    if (dollars != null && days >= 7 && days <= 45) {
      const diamonds = scaleDollarsWindowToL30(dollars, days);
      if (diamonds != null) {
        return withDiamondAliases({
          diamondsL30: diamonds,
          masked: false,
          source: "estimated_last_n",
        });
      }
    }
  }

  // "Last 10 days ≈ $2,834" / "Last 40 days $…"
  const lastN = flat.match(
    /Last\s+(\d+)\s+days\s*≈?\s*\$?\s*([\d,.]+[kKmMbB]?|\?+)/i
  );
  if (lastN) {
    const days = Number(lastN[1]);
    if (looksMaskedText(lastN[2])) {
      return withDiamondAliases({
        diamondsL30: null,
        masked: true,
        source: "last_n_masked",
      });
    }
    const dollars = parseCompactNumber(lastN[2]);
    if (dollars != null && days >= 7 && days <= 45) {
      const diamonds = scaleDollarsWindowToL30(dollars, days);
      if (diamonds != null) {
        return withDiamondAliases({
          diamondsL30: diamonds,
          masked: false,
          source: "last_n_days",
        });
      }
    }
  }

  // Lifetime / long windows — only if we have nothing shorter (skip >60d).
  const inLast = flat.match(
    /in last\s+(\d+)\s+days\s*≈?\s*\$?\s*([\d,.]+[kKmMbB]?|\?+)/i
  );
  if (inLast) {
    const days = Number(inLast[1]);
    if (looksMaskedText(inLast[2])) {
      return withDiamondAliases({
        diamondsL30: null,
        masked: true,
        source: "period_masked",
      });
    }
    const dollars = parseCompactNumber(inLast[2]);
    if (dollars != null && days >= 7 && days <= 45) {
      const diamonds = scaleDollarsWindowToL30(dollars, days);
      if (diamonds != null) {
        return withDiamondAliases({
          diamondsL30: diamonds,
          masked: false,
          source: "period_total",
        });
      }
    }
  }

  // Daily $ rows after a short "Last N days" label
  const dayRows = [
    ...raw.matchAll(
      /(\d{1,2}\.\d{1,2}\.\d{4})[\s\S]{0,80}?\$\s*([\d,.]+[kKmMbB]?)/gi
    ),
  ];
  if (dayRows.length >= 5) {
    const points = [];
    for (const row of dayRows) {
      const dollars = parseCompactNumber(row[2]);
      if (dollars == null) continue;
      const diamonds =
        dollars >= 50000 ? dollars : dollarsToDiamonds(dollars);
      if (diamonds == null) continue;
      points.push({ diamonds, dateMs: pickDateMs({ date: row[1] }) });
    }
    if (points.length >= 5) {
      points.sort((a, b) => (b.dateMs || 0) - (a.dateMs || 0));
      const total = points.slice(0, 30).reduce((a, p) => a + p.diamonds, 0);
      return withDiamondAliases({
        diamondsL30: total,
        masked: false,
        source: "daily_table",
      });
    }
  }

  if (masked) {
    return withDiamondAliases({
      diamondsL30: null,
      masked: true,
      source: "premium_gate",
    });
  }
  if (/log\s*in|sign\s*in/i.test(raw) && raw.length < 12000) {
    return withDiamondAliases({
      diamondsL30: null,
      masked: true,
      source: "login_wall",
    });
  }
  return withDiamondAliases({ diamondsL30: null, masked: false, source: null });
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

async function waitForDebugger(port, child, timeoutMs = 25000) {
  const started = Date.now();
  let stderrBuf = "";
  if (child?.stderr) {
    child.stderr.on("data", (chunk) => {
      stderrBuf += chunk.toString("utf8");
      if (stderrBuf.length > 64_000) stderrBuf = stderrBuf.slice(-48_000);
    });
  }
  while (Date.now() - started < timeoutMs) {
    const match = DEVTOOLS_URL_RE.exec(stderrBuf);
    if (match) return match[1].trim();
    try {
      const version = await httpGetJson(
        `http://127.0.0.1:${port}/json/version`
      );
      if (version?.webSocketDebuggerUrl) return version.webSocketDebuggerUrl;
    } catch {
      // wait
    }
    // Chrome.app may re-exec: the spawn handle can exit while the real
    // browser keeps the debug port. Only fail on non-zero exit with no port.
    if (child && child.exitCode != null && child.exitCode !== 0) {
      throw new Error(
        `TikLeap Chrome exited early (code=${child.exitCode}). ${stderrBuf.slice(-300)}`
      );
    }
    await sleep(200);
  }
  throw new Error(
    "Could not attach to TikLeap Chrome. Quit leftover TikLeap Chrome windows and retry."
  );
}

/** PIDs for this user-data-dir instance only (macOS pgrep must not start with `-`). */
function pidsForUserDataDir(userDataDir) {
  const dir = String(userDataDir || "").trim();
  if (!dir) return [];
  try {
    const out = execSync(
      `pgrep -f ${JSON.stringify(`user-data-dir=${dir}`)}`,
      { encoding: "utf8" }
    ).trim();
    if (!out) return [];
    return out
      .split(/\s+/)
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    return [];
  }
}

/** Off-screen parking when macOS Chrome refuses to stay minimized. */
const SCRAPE_OFFSCREEN_BOUNDS = {
  left: -20000,
  top: 80,
  width: 1100,
  height: 900,
};

function isScrapeWindowHidden(bounds) {
  if (!bounds || typeof bounds !== "object") return false;
  if (bounds.windowState === "minimized") return true;
  const left = Number(bounds.left);
  return Number.isFinite(left) && left <= -10000;
}

/**
 * CDP-only minimize for windows belonging to this debugging session.
 * Never uses osascript / System Events / app hide — those can touch personal Chrome.
 * Skips windows already minimized/off-screen (even when force=true) so we never
 * bounce a hidden window. force is reserved for callers that want a fresh check
 * after a restore trigger. If minimize does not stick, parks off-screen.
 *
 * @param {object} browserSession
 * @param {string|string[]|null} targetIdOrIds
 * @param {{ force?: boolean }} [opts]
 */
async function minimizeChromeWindow(browserSession, targetIdOrIds, opts = {}) {
  // opts.force kept for API compat; state check always wins to avoid focus bounce.
  void opts;
  const preferred = Array.isArray(targetIdOrIds)
    ? targetIdOrIds
    : targetIdOrIds
      ? [targetIdOrIds]
      : [];
  let ok = false;

  if (!browserSession) return false;

  const windowIds = await collectChromeWindowIds(browserSession, preferred);
  for (const windowId of windowIds) {
    try {
      let bounds = null;
      try {
        const before = await browserSession.send("Browser.getWindowBounds", {
          windowId,
        });
        bounds = before?.bounds || null;
      } catch {
        bounds = null;
      }
      if (isScrapeWindowHidden(bounds)) {
        ok = true;
        continue;
      }

      await browserSession.send("Browser.setWindowBounds", {
        windowId,
        bounds: { windowState: "minimized" },
      });
      const check = await browserSession.send("Browser.getWindowBounds", {
        windowId,
      });
      bounds = check?.bounds || null;
      if (bounds?.windowState === "minimized") {
        ok = true;
        continue;
      }

      // macOS sometimes refuses minimized during createTarget — park off-screen
      // without activating, then retry minimize.
      await browserSession.send("Browser.setWindowBounds", {
        windowId,
        bounds: { ...SCRAPE_OFFSCREEN_BOUNDS, windowState: "normal" },
      });
      await browserSession.send("Browser.setWindowBounds", {
        windowId,
        bounds: { windowState: "minimized" },
      });
      const retry = await browserSession.send("Browser.getWindowBounds", {
        windowId,
      });
      bounds = retry?.bounds || null;
      if (bounds?.windowState === "minimized") {
        ok = true;
      } else {
        // Leave off-screen so it does not flash on the user's desktop.
        await browserSession.send("Browser.setWindowBounds", {
          windowId,
          bounds: { ...SCRAPE_OFFSCREEN_BOUNDS, windowState: "normal" },
        });
        ok = true;
      }
    } catch (error) {
      console.warn(
        `[tikleap] CDP minimize failed (window ${windowId}): ${
          error?.message || error
        }`
      );
    }
  }

  return ok;
}

/**
 * Create a page target without activating the scrape window (Chrome 108+).
 * Falls back without background if the browser rejects the param.
 */
async function createBackgroundTarget(browserSession, url = "about:blank") {
  try {
    return await browserSession.send("Target.createTarget", {
      url,
      background: true,
      newWindow: false,
    });
  } catch {
    return browserSession.send("Target.createTarget", { url });
  }
}

/**
 * Keep scrape Chrome minimized for the life of this CDP connection.
 * Remimizes only when a target event (or sparse watchdog) finds a non-minimized
 * window — no multi-second setWindowBounds storms.
 *
 * @param {object} browserSession
 * @param {() => string[]} getTargetIds
 */
function installMinimizeGuard(browserSession, getTargetIds) {
  let stopped = false;
  let timer = null;
  let inFlight = false;
  let lastRemimizeAt = 0;
  const DEBOUNCE_MS = 120;
  const MIN_GAP_MS = 400;
  const WATCHDOG_MS = 2500;

  const remimize = async (reason) => {
    if (stopped || inFlight) return;
    const now = Date.now();
    if (now - lastRemimizeAt < MIN_GAP_MS) return;
    inFlight = true;
    try {
      const ids =
        typeof getTargetIds === "function" ? getTargetIds() || [] : [];
      const ok = await minimizeChromeWindow(browserSession, ids);
      if (ok) lastRemimizeAt = Date.now();
      else if (reason) {
        // quiet — common during early connect
      }
    } catch {
      // ignore
    } finally {
      inFlight = false;
    }
  };

  const schedule = (reason) => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      remimize(reason);
    }, DEBOUNCE_MS);
  };

  const onTargetCreated = (params) => {
    const type = params?.targetInfo?.type || params?.type;
    if (type && type !== "page") return;
    schedule("targetCreated");
  };
  const onAttached = (params) => {
    const type = params?.targetInfo?.type;
    if (type && type !== "page") return;
    schedule("attachedToTarget");
  };

  browserSession.on("Target.targetCreated", onTargetCreated);
  browserSession.on("Target.attachedToTarget", onAttached);

  try {
    browserSession.send("Target.setDiscoverTargets", { discover: true }).catch(
      () => {}
    );
  } catch {
    // ignore
  }

  const watchdog = setInterval(() => {
    if (stopped) return;
    remimize("watchdog");
  }, WATCHDOG_MS);
  if (typeof watchdog.unref === "function") watchdog.unref();

  const stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
    clearInterval(watchdog);
    try {
      browserSession.off("Target.targetCreated", onTargetCreated);
      browserSession.off("Target.attachedToTarget", onAttached);
    } catch {
      // ignore
    }
  };

  return { schedule, remimize, stop };
}

async function listPageTargetIds(browserSession, preferredIds = []) {
  const ids = [];
  const seen = new Set();
  for (const id of preferredIds || []) {
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  try {
    const targets = await browserSession.send("Target.getTargets");
    for (const t of targets?.targetInfos || []) {
      if (t?.type !== "page" || !t.targetId || seen.has(t.targetId)) continue;
      seen.add(t.targetId);
      ids.push(t.targetId);
    }
  } catch {
    // ignore
  }
  return ids;
}

async function collectChromeWindowIds(browserSession, targetIds) {
  const windowIds = new Set();
  const ids = await listPageTargetIds(browserSession, targetIds);
  for (const targetId of ids) {
    try {
      const win = await browserSession.send("Browser.getWindowForTarget", {
        targetId,
      });
      if (win?.windowId != null) windowIds.add(win.windowId);
    } catch {
      // ignore
    }
  }
  return [...windowIds];
}

async function resolveExistingDebugger() {
  const pids = pidsForUserDataDir(PROFILE_DIR);
  if (!pids.length) return null;

  const candidates = [];
  const active = readDevToolsActivePort(PROFILE_DIR);
  if (active?.port) candidates.push(active.port);
  const meta = readDebugMeta();
  if (meta?.port && !candidates.includes(meta.port)) candidates.push(meta.port);

  for (const port of candidates) {
    const wsUrl = await probeDebuggerWsUrl(port);
    if (wsUrl) return { port, wsUrl, pids };
  }
  return { port: null, wsUrl: null, pids, orphaned: true };
}

/**
 * Attach worker tabs on an existing CDP browser, creating only what's missing.
 */
async function ensureWorkerTabs(browserSession, workerCount) {
  /** @type {string[]} */
  const sessionIds = [];
  /** @type {string[]} */
  const targetIds = [];

  async function attachWorker(targetId) {
    const attached = await browserSession.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    const sid = attached.sessionId;
    await browserSession.send("Network.enable", {}, sid);
    await browserSession.send("Page.enable", {}, sid);
    try {
      await browserSession.send(
        "Network.setBlockedURLs",
        { urls: BLOCKED_RESOURCE_URLS },
        sid
      );
    } catch {
      // older Chrome builds may not support this
    }
    targetIds.push(targetId);
    sessionIds.push(sid);
    return sid;
  }

  let pageTargets = [];
  try {
    const existing = await browserSession.send("Target.getTargets");
    pageTargets = (existing?.targetInfos || []).filter((t) => t.type === "page");
  } catch {
    pageTargets = [];
  }

  for (const page of pageTargets) {
    if (sessionIds.length >= workerCount) break;
    if (!page?.targetId) continue;
    try {
      await attachWorker(page.targetId);
    } catch {
      // skip dead target
    }
  }

  let createdExtra = 0;
  while (sessionIds.length < workerCount) {
    const created = await createBackgroundTarget(browserSession, "about:blank");
    await attachWorker(created.targetId);
    createdExtra += 1;
  }

  return { sessionIds, targetIds, createdExtra };
}

function buildLaunchHandle({
  browserSession,
  sessionIds,
  targetIds,
  workerCount,
  port,
  headed,
  reused,
  child = null,
}) {
  let minimizedOk = false;
  /** @type {{ schedule: Function, remimize: Function, stop: Function }|null} */
  let minimizeGuard = null;

  const minimizeOnce = async ({ force = false } = {}) => {
    if (!headed) return true;
    const ok = await minimizeChromeWindow(browserSession, targetIds, {
      force,
    });
    minimizedOk = ok || minimizedOk;
    return ok;
  };

  // Callers use this after operations that may restore the window.
  const keepMinimized = (opts) => minimizeOnce(opts);

  if (headed) {
    minimizeGuard = installMinimizeGuard(browserSession, () => targetIds);
  }

  /**
   * Soft cleanup (default): disconnect CDP, leave scrape Chrome running for reuse.
   * Pass { killBrowser: true } only for crash recovery / explicit teardown.
   */
  const cleanup = (opts = {}) => {
    const killBrowser = opts === true || opts?.killBrowser === true;
    try {
      minimizeGuard?.stop?.();
    } catch {
      // ignore
    }
    minimizeGuard = null;
    try {
      persistDiskCache();
    } catch {
      // ignore
    }
    try {
      browserSession.close();
    } catch {
      // ignore
    }
    if (!killBrowser) return;
    try {
      if (child?.pid) process.kill(child.pid, "SIGKILL");
    } catch {
      // ignore
    }
    releaseProfileLock(PROFILE_DIR);
  };

  return {
    browserSession,
    sessionId: sessionIds[0],
    sessionIds,
    targetIds,
    workers: workerCount,
    port,
    headless: !headed,
    minimized: false,
    reused: Boolean(reused),
    minimizeOnce,
    keepMinimized,
    scheduleRemimize: (reason) => minimizeGuard?.schedule?.(reason),
    cleanup,
  };
}

/**
 * Launch or reconnect to Chrome using the TikLeap login profile.
 * Default: headed + kept minimized via CDP guard (Cloudflare-stable). Set
 * LEAD_FINDER_TIKLEAP_HEADLESS=1 to force --headless=new (often 403s boards).
 * Reuses a running chrome-tikleap-profile instance when its debug port is alive.
 * Soft cleanup leaves that browser running for the next Get leads.
 * @param {{ workers?: number }} [options]
 */
async function launchTikleapChrome(options = {}) {
  if (!hasLoginProfile()) {
    const err = new Error(
      "TikLeap login profile missing. Run ./scripts/tikleap-login.sh, log in with Premium, then Get leads again."
    );
    err.code = "TIKLEAP_SESSION_REQUIRED";
    throw err;
  }

  const chromePath = findChrome();
  if (!chromePath) {
    throw new Error("Google Chrome not found for TikLeap lookups.");
  }

  const defaultTabs = DEFAULT_TIKLEAP_LOOKUP_WORKERS + 1; // 1 list + lookups
  const workerCount = Math.max(
    1,
    Math.min(
      MAX_TIKLEAP_CHROME_TABS,
      Math.floor(Number(options.workers) || defaultTabs)
    )
  );
  const launchTimeoutMs = Math.max(
    20000,
    Math.floor(Number(options.timeoutMs) || 60000)
  );
  console.log(
    `[tikleap] launching/reconnecting Chrome (workers=${workerCount}, timeout=${launchTimeoutMs}ms)…`
  );
  return withTimeout(
    launchTikleapChromeInner({ ...options, workers: workerCount }),
    launchTimeoutMs,
    `Timed out launching TikLeap Chrome after ${launchTimeoutMs}ms`
  ).catch((error) => {
    // Clear a wedged scrape-profile instance so the next Get leads can spawn.
    try {
      releaseProfileLock(PROFILE_DIR);
    } catch {
      // ignore
    }
    throw error;
  });
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(message || `Timeout after ${ms}ms`);
        err.code = "CHROME_LAUNCH_TIMEOUT";
        reject(err);
      }, ms);
    }),
  ]);
}

async function launchTikleapChromeInner(options = {}) {
  const workerCount = Math.max(
    1,
    Math.min(
      MAX_TIKLEAP_CHROME_TABS,
      Math.floor(Number(options.workers) || DEFAULT_TIKLEAP_LOOKUP_WORKERS + 1)
    )
  );
  const chromePath = findChrome();
  if (!chromePath) {
    throw new Error("Google Chrome not found for TikLeap lookups.");
  }
  // Headed/minimized by default — headless breaks cf_clearance on TikLeap.
  const forceHeadless =
    process.env.LEAD_FINDER_TIKLEAP_HEADLESS === "1" ||
    process.env.LEAD_FINDER_TIKLEAP_HEADLESS === "true";
  const forceHeaded =
    process.env.LEAD_FINDER_HEADED === "1" ||
    process.env.LEAD_FINDER_HEADED === "true";
  const headed = forceHeaded || !forceHeadless;

  ensureDataDir();
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  // --- Prefer reconnect to an already-running scrape-profile Chrome ---
  const existing = await resolveExistingDebugger();
  if (existing?.wsUrl && existing.port) {
    try {
      const browserSession = new CdpSession(existing.wsUrl);
      await browserSession.connect();
      const { sessionIds, targetIds, createdExtra } = await ensureWorkerTabs(
        browserSession,
        workerCount
      );
      saveDebugMeta(existing.port, existing.wsUrl);

      const handle = buildLaunchHandle({
        browserSession,
        sessionIds,
        targetIds,
        workerCount: sessionIds.length,
        port: existing.port,
        headed,
        reused: true,
      });

      // Always ensure minimized on reconnect (window may have been restored).
      if (headed) {
        handle.minimized = await handle.minimizeOnce({ force: true });
        if (!handle.minimized) {
          await sleep(200);
          handle.minimized = await handle.minimizeOnce({ force: true });
        }
      }

      console.log(
        `[tikleap] Chrome reused headless=${headed ? "false" : "new"}` +
          ` minimized=${handle.minimized}` +
          ` workers=${sessionIds.length}` +
          ` createdTabs=${createdExtra}` +
          ` port=${existing.port}` +
          ` profile=${PROFILE_DIR}`
      );
      return handle;
    } catch (error) {
      console.warn(
        `[tikleap] Reconnect failed (${error?.message || error}); relaunching scrape Chrome`
      );
    }
  }

  // Profile processes without a live debug port → restart that profile only.
  if (existing?.pids?.length || existing?.orphaned) {
    console.log(
      `[tikleap] Scrape Chrome running without debugger — restarting profile instance only`
    );
    releaseProfileLock(PROFILE_DIR);
    await sleep(400);
  } else {
    // Stale singleton locks with no process block launch; clear locks only.
    for (const name of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
      try {
        fs.unlinkSync(path.join(PROFILE_DIR, name));
      } catch {
        // ignore
      }
    }
  }

  const port = await reserveFreePort();
  const args = [
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
    "--remote-allow-origins=*",
    `--user-data-dir=${PROFILE_DIR}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=Translate",
    "--window-size=1100,900",
  ];
  if (headed) {
    args.push("--window-position=-20000,80", "--new-window");
  } else {
    args.push("--headless=new", "--disable-gpu");
  }
  args.push("about:blank");

  // Spawn the binary directly (never `open -a "Google Chrome"`) so we only
  // ever start this user-data-dir instance — not the user's personal Chrome.
  const child = spawn(chromePath, args, {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  child.unref();

  const wsUrl = await waitForDebugger(port, child);
  saveDebugMeta(port, wsUrl);
  const browserSession = new CdpSession(wsUrl);
  await browserSession.connect();

  // Minimize the seed window once before creating the worker tab batch.
  if (headed) {
    await sleep(200);
    try {
      const seedTargets = await listPageTargetIds(browserSession, []);
      await minimizeChromeWindow(browserSession, seedTargets);
    } catch {
      // ignore
    }
  }

  const { sessionIds, targetIds, createdExtra } = await ensureWorkerTabs(
    browserSession,
    workerCount
  );

  // Warm tabs on TikLeap after the batch exists (does not loop-minimize).
  for (const sid of sessionIds) {
    try {
      await browserSession.send(
        "Page.navigate",
        { url: "https://www.tikleap.com/" },
        sid
      );
    } catch {
      // ignore single-tab nav failure
    }
  }

  const handle = buildLaunchHandle({
    browserSession,
    sessionIds,
    targetIds,
    workerCount: sessionIds.length,
    port,
    headed,
    reused: false,
    child,
  });

  // Remimize after tab batch + warm navigations (createTarget / nav can restore).
  if (headed) {
    handle.minimized = await handle.minimizeOnce({ force: true });
    if (!handle.minimized) {
      await sleep(250);
      handle.minimized = await handle.minimizeOnce({ force: true });
    }
  }

  console.log(
    `[tikleap] Chrome ready headless=${headed ? "false" : "new"}` +
      ` minimized=${handle.minimized}` +
      ` launch=spawn` +
      ` reused=false` +
      ` workers=${sessionIds.length}` +
      ` createdTabs=${createdExtra}` +
      ` port=${port}` +
      ` profile=${PROFILE_DIR}` +
      (forceHeadless && !forceHeaded ? " (LEAD_FINDER_TIKLEAP_HEADLESS)" : "")
  );

  return handle;
}

async function exportCookiesFromSession(browserSession, sessionId) {
  await browserSession.send("Network.enable", {}, sessionId);
  const result = await browserSession.send(
    "Network.getCookies",
    { urls: ["https://www.tikleap.com/", "https://tikleap.com/"] },
    sessionId
  );
  const cookies = Array.isArray(result?.cookies) ? result.cookies : [];
  const count = saveCookies(cookies);
  return { count, path: COOKIES_PATH };
}

/**
 * Navigate-based TikLeap client with a pool of lookup tabs.
 * @param {import('./tikleap').CdpSession|object} browserSession
 * @param {string|string[]} sessionIdOrIds
 * @param {{ settleMs?: number, maxSettleMs?: number }} [options]
 */
function createTikleapClient(browserSession, sessionIdOrIds, options = {}) {
  const sessionIds = (
    Array.isArray(sessionIdOrIds) ? sessionIdOrIds : [sessionIdOrIds]
  ).filter(Boolean);
  if (!sessionIds.length) {
    throw new Error("TikLeap client requires at least one CDP session.");
  }

  const cache = new Map();
  const jobQueue = [];
  const workers = sessionIds.map((sid) => ({ sessionId: sid, busy: false }));
  let sessionState = "unknown";
  let okHits = 0;
  let softFails = 0;
  const maxSettleMs = Math.max(
    600,
    Number(options.maxSettleMs) || Number(options.settleMs) || 1400
  );

  async function ensureReady() {
    // Window stay-minimized is handled by launch's CDP minimize guard.
    sessionState = "ok";
    return { ok: true, reason: null };
  }

  async function readText(sessionId) {
    const evaluated = await browserSession.send(
      "Runtime.evaluate",
      {
        expression: `(() => {
          const t = document.body ? String(document.body.innerText || "") : "";
          const href = String(location.href || "");
          const html = document.documentElement
            ? String(document.documentElement.outerHTML || "")
            : "";
          return {
            text: t.slice(0, 40000),
            href,
            // Keep history table + data-original attributes for monthly peak.
            html: html.slice(0, 250000),
          };
        })()`,
        returnByValue: true,
      },
      sessionId
    );
    return evaluated?.result?.value || { text: "", href: "", html: "" };
  }

  function finalizeResult(key, result) {
    cache.set(key, result);
    writeDiskCache(key, result);
    return result;
  }

  async function lookupOne(
    username,
    sessionId,
    attempt = 0,
    { needCountry = false } = {}
  ) {
    const key = String(username || "")
      .trim()
      .replace(/^@+/, "")
      .toLowerCase();
    if (!key) {
      return withDiamondAliases({
        diamondsL30: null,
        masked: false,
        skipped: true,
        sessionDead: false,
        source: null,
        error: "empty_username",
      });
    }
    if (attempt === 0 && cache.has(key)) {
      const hit = cache.get(key);
      if (!needCountry || hit?.country || hit?.skipped || hit?.masked) {
        return hit;
      }
      cache.delete(key);
    }
    const diskHit = readDiskCache(key);
    if (diskHit) {
      const n =
        diskHit.diamondsL30 != null
          ? diskHit.diamondsL30
          : diskHit.diamondsL28;
      const cachedCountry = normalizeRegion(diskHit.country) || null;
      const cachedCurrentMonth =
        diskHit.currentMonthDiamonds != null
          ? Number(diskHit.currentMonthDiamonds)
          : null;
      const diskMonthGateOk =
        diskHit.monthGate === "current" ||
        // Old cache that passed the stricter any-month gate is still fine.
        (Boolean(diskHit.monthlyKnown) && !diskHit.monthOverCap);
      // Old any-month over-cap must be re-checked under current-month gate.
      const staleOverCap =
        Boolean(diskHit.monthOverCap) && diskHit.monthGate !== "current";
      const cached = withDiamondAliases({
        diamondsL30: Number.isFinite(n) ? n : null,
        currentMonthDiamonds: Number.isFinite(cachedCurrentMonth)
          ? cachedCurrentMonth
          : null,
        currentMonthKey: diskHit.currentMonthKey || null,
        maxMonthDiamonds:
          diskHit.maxMonthDiamonds != null
            ? Number(diskHit.maxMonthDiamonds)
            : Number.isFinite(cachedCurrentMonth)
              ? cachedCurrentMonth
              : null,
        monthOverCap: Boolean(diskHit.monthOverCap) && !staleOverCap,
        monthlyKnown: Boolean(diskHit.monthlyKnown) && diskMonthGateOk,
        monthGate: diskHit.monthGate || null,
        country: cachedCountry,
        countrySource: cachedCountry
          ? diskHit.countrySource || "disk_cache"
          : null,
        masked: Boolean(diskHit.masked),
        skipped:
          Boolean(diskHit.skipped) ||
          !Number.isFinite(n) ||
          Boolean(diskHit.masked) ||
          (Boolean(diskHit.monthOverCap) && !staleOverCap),
        sessionDead: false,
        source: diskHit.source || "disk_cache",
        fromCache: true,
      });
      if (Number.isFinite(n)) {
        cached.masked = false;
        // In-band L30 without a trusted current-month check → light history.
        const needsMonthly =
          meetsDiamondFloor(n) &&
          (!diskMonthGateOk || staleOverCap || !diskHit.monthlyKnown);
        // Feed-fallback strict GB gate: re-open profile when country unknown.
        const needsCountry =
          Boolean(needCountry) &&
          meetsDiamondFloor(n) &&
          !(Boolean(diskHit.monthOverCap) && !staleOverCap) &&
          !cachedCountry;
        if (!needsMonthly && !needsCountry) {
          cached.skipped = Boolean(diskHit.monthOverCap) && !staleOverCap;
          cache.set(key, cached);
          return cached;
        }
        if (sessionState === "dead") {
          cache.set(key, cached);
          return cached;
        }
        await browserSession.send(
          "Page.navigate",
          { url: PROFILE_URL(key) },
          sessionId
        );
        await sleep(400);
        let seedHtml = "";
        try {
          const page = await readText(sessionId);
          seedHtml = page.html || "";
        } catch {
          // ignore
        }
        const parsedCountry = parseCountryFromProfile(seedHtml);
        const country = parsedCountry.country || cachedCountry || null;
        const countrySource = parsedCountry.country
          ? parsedCountry.countrySource
          : cachedCountry
            ? diskHit.countrySource || "disk_cache"
            : null;
        try {
          let currentMonthDiamonds = Number.isFinite(cachedCurrentMonth)
            ? cachedCurrentMonth
            : null;
          let currentMonthKey = diskHit.currentMonthKey || null;
          let maxMonthDiamonds =
            diskHit.maxMonthDiamonds != null
              ? Number(diskHit.maxMonthDiamonds)
              : currentMonthDiamonds;
          let monthOverCap =
            Boolean(diskHit.monthOverCap) && !staleOverCap;
          let monthlyKnown =
            Boolean(diskHit.monthlyKnown) && diskMonthGateOk;
          if (needsMonthly) {
            const monthly = await fetchCurrentMonthFromHistory(
              browserSession,
              sessionId,
              key,
              seedHtml
            );
            currentMonthDiamonds = monthly.currentMonthDiamonds;
            currentMonthKey = monthly.currentMonthKey;
            maxMonthDiamonds = monthly.currentMonthDiamonds;
            monthOverCap = Boolean(monthly.monthOverCap);
            monthlyKnown = Boolean(monthly.monthlyKnown);
          }
          return finalizeResult(
            key,
            withDiamondAliases({
              diamondsL30: n,
              currentMonthDiamonds,
              currentMonthKey,
              maxMonthDiamonds,
              monthOverCap,
              monthlyKnown,
              monthGate: "current",
              country,
              countrySource,
              masked: false,
              skipped: Boolean(monthOverCap),
              sessionDead: false,
              source: diskHit.source || "disk_cache",
              fromCache: true,
            })
          );
        } catch {
          // Missing monthly must not exclude — keep L30 hit.
          return finalizeResult(
            key,
            withDiamondAliases({
              diamondsL30: n,
              currentMonthDiamonds: null,
              maxMonthDiamonds: null,
              monthOverCap: false,
              monthlyKnown: false,
              monthGate: "current",
              country,
              countrySource,
              masked: false,
              skipped: false,
              sessionDead: false,
              source: diskHit.source || "disk_cache",
              fromCache: true,
            })
          );
        }
      }
      cache.set(key, cached);
      return cached;
    }
    if (sessionState === "dead") {
      const dead = withDiamondAliases({
        diamondsL30: null,
        masked: true,
        skipped: true,
        sessionDead: true,
        source: "session_dead",
      });
      cache.set(key, dead);
      return dead;
    }

    const url = PROFILE_URL(key);
    await browserSession.send("Page.navigate", { url }, sessionId);

    // Earnings often paint in ~400–700ms — parse as soon as $ totals appear.
    // Retries get a longer settle budget for slow premium paints.
    const settleBudget = maxSettleMs + attempt * 1200;
    const started = Date.now();
    let parsed = withDiamondAliases({
      diamondsL30: null,
      masked: false,
      source: null,
    });
    let seedHtml = "";
    while (Date.now() - started < settleBudget) {
      await sleep(90);
      let page;
      try {
        page = await readText(sessionId);
      } catch {
        continue;
      }
      const blob = `${page.text || ""}\n${page.href || ""}`;
      if (/Attention Required|Cloudflare/i.test(blob)) {
        softFails += 1;
        if (softFails >= 3 && okHits === 0) sessionState = "dead";
        return finalizeResult(
          key,
          withDiamondAliases({
            diamondsL30: null,
            masked: true,
            skipped: true,
            sessionDead: sessionState === "dead",
            source: "cloudflare",
          })
        );
      }
      seedHtml = page.html || seedHtml;
      parsed = parseProfilePayload(blob);
      if (
        parsed.diamondsL30 != null ||
        parsed.masked ||
        parsed.source === "login_wall" ||
        parsed.source === "cloudflare"
      ) {
        break;
      }
    }

    if (parsed.source === "cloudflare" || parsed.source === "login_wall") {
      softFails += 1;
      if (softFails >= 3 && okHits === 0) sessionState = "dead";
      // One extra navigate for Cloudflare soft blocks before declaring dead.
      if (parsed.source === "cloudflare" && attempt < 1 && sessionState !== "dead") {
        await sleep(500);
        cache.delete(key);
        return lookupOne(username, sessionId, attempt + 1, { needCountry });
      }
      return finalizeResult(
        key,
        withDiamondAliases({
          diamondsL30: null,
          masked: true,
          skipped: true,
          sessionDead: sessionState === "dead",
          source: parsed.source,
        })
      );
    }

    if (parsed.masked || parsed.diamondsL30 == null) {
      const durableMask =
        parsed.masked && DURABLE_MASK_SOURCES.has(parsed.source);
      // Retry slow/empty paints — do not burn the slot on a first miss.
      if (!durableMask && attempt < 2) {
        await sleep(250 + attempt * 200);
        cache.delete(key);
        return lookupOne(username, sessionId, attempt + 1, { needCountry });
      }
      softFails += 1;
      return finalizeResult(
        key,
        withDiamondAliases({
          diamondsL30: null,
          masked: Boolean(parsed.masked),
          skipped: true,
          sessionDead: false,
          source: parsed.source || "unparsed",
        })
      );
    }

    okHits += 1;
    softFails = 0;
    sessionState = "ok";

    if (!seedHtml) {
      try {
        const page = await readText(sessionId);
        seedHtml = page.html || "";
      } catch {
        // ignore
      }
    }
    const parsedCountry = parseCountryFromProfile(
      `${seedHtml}\n${parsed.source || ""}`
    );

    let currentMonthDiamonds = null;
    let currentMonthKey = null;
    let maxMonthDiamonds = null;
    let monthOverCap = false;
    let monthlyKnown = false;
    // Current-month prefer-gate only when L30 is in-band (skip history for whales/floor misses).
    if (meetsDiamondFloor(parsed.diamondsL30)) {
      try {
        const monthly = await fetchCurrentMonthFromHistory(
          browserSession,
          sessionId,
          key,
          seedHtml
        );
        currentMonthDiamonds = monthly.currentMonthDiamonds;
        currentMonthKey = monthly.currentMonthKey;
        maxMonthDiamonds = monthly.currentMonthDiamonds;
        monthOverCap = Boolean(monthly.monthOverCap);
        monthlyKnown = Boolean(monthly.monthlyKnown);
      } catch {
        // Missing monthly data must not exclude on its own.
        monthlyKnown = false;
      }
    }

    return finalizeResult(
      key,
      withDiamondAliases({
        diamondsL30: parsed.diamondsL30,
        currentMonthDiamonds,
        currentMonthKey,
        maxMonthDiamonds,
        monthOverCap,
        monthlyKnown,
        monthGate: "current",
        country: parsedCountry.country,
        countrySource: parsedCountry.countrySource,
        masked: false,
        skipped: monthOverCap,
        sessionDead: false,
        source: parsed.source,
      })
    );
  }

  async function pumpWorker(worker) {
    if (worker.busy) return;
    worker.busy = true;
    try {
      while (jobQueue.length) {
        const job = jobQueue.shift();
        if (!job) break;
        try {
          const result = await lookupOne(job.username, worker.sessionId, 0, {
            needCountry: Boolean(job.needCountry),
          });
          job.resolve(result);
        } catch (error) {
          job.reject(error);
        }
      }
    } finally {
      worker.busy = false;
      if (jobQueue.length) {
        // Another job arrived while finishing — keep this worker busy.
        void pumpWorker(worker);
      }
    }
  }

  function lookup(username, { force = false, needCountry = false } = {}) {
    const key = String(username || "")
      .trim()
      .replace(/^@+/, "")
      .toLowerCase();
    if (force && key) cache.delete(key);
    if (key && !force && cache.has(key)) {
      const hit = cache.get(key);
      if (!needCountry || hit?.country || hit?.skipped || hit?.masked) {
        return Promise.resolve(hit);
      }
      cache.delete(key);
    }
    return new Promise((resolve, reject) => {
      jobQueue.push({
        username,
        needCountry: Boolean(needCountry),
        resolve,
        reject,
      });
      for (const worker of workers) {
        if (!worker.busy) void pumpWorker(worker);
      }
    });
  }

  function forget(username) {
    const key = String(username || "")
      .trim()
      .replace(/^@+/, "")
      .toLowerCase();
    if (key) cache.delete(key);
  }

  function getSessionState() {
    return sessionState;
  }

  function stats() {
    return {
      cacheSize: cache.size,
      sessionState,
      okHits,
      softFails,
      queued: jobQueue.length,
      workers: workers.length,
    };
  }

  return {
    ensureCookies: ensureReady,
    ensureReady,
    lookup,
    forget,
    getSessionState,
    stats,
    concurrency: workers.length,
  };
}

/** Inclusive L30 band: MIN_DIAMONDS_L30 … MAX_DIAMONDS_L30 (known values only). */
function meetsDiamondFloor(diamonds) {
  const n = Number(diamonds);
  return (
    Number.isFinite(n) &&
    n >= MIN_DIAMONDS_L30 &&
    n <= MAX_DIAMONDS_L30
  );
}

function isPreferredDiamondBand(diamonds) {
  return meetsDiamondFloor(diamonds);
}

/**
 * True when L30 diamonds parsed to a finite number.
 * Important: Number(null) === 0, so null/undefined/"" must be rejected
 * before Number() — otherwise unknown L30 is misread as 0 (inactive).
 */
function isDiamondsKnown(diamonds) {
  if (diamonds == null || diamonds === "") return false;
  const n = Number(diamonds);
  return Number.isFinite(n);
}

/**
 * Known L30 below inactive threshold → auto CRM inactive_lost.
 * Unknown/masked/missing L30 must not mark inactive.
 */
function isInactiveDiamondsL30(diamonds) {
  if (!isDiamondsKnown(diamonds)) return false;
  const n = Number(diamonds);
  return n >= 0 && n < INACTIVE_DIAMONDS_L30;
}

/**
 * Keep when L30 is unknown (masked/unparsed/missing), or known and in-band.
 * Current-month over-cap is handled separately by callers.
 * Known L30 below INACTIVE_DIAMONDS_L30 is not a New keeper — callers may
 * persist those as inactive_lost outside the New cap.
 * @param {unknown} diamonds
 * @param {{ masked?: boolean }} [opts]
 */
function shouldKeepForDiamonds(diamonds, { masked = false } = {}) {
  if (masked || !isDiamondsKnown(diamonds)) return true;
  return meetsDiamondFloor(diamonds);
}

module.exports = {
  COOKIES_PATH,
  PROFILE_DIR,
  PROFILE_URL,
  MIN_DIAMONDS_L30,
  MAX_DIAMONDS_L30,
  INACTIVE_DIAMONDS_L30,
  MAX_DIAMONDS_CURRENT_MONTH,
  MAX_DIAMONDS_ANY_MONTH,
  MIN_DIAMONDS_L28,
  PREFER_DIAMONDS_L28,
  cookiesPath,
  profileDir,
  loadCookies,
  saveCookies,
  hasCookieJar,
  hasLoginProfile,
  parseCompactNumber,
  parseProfilePayload,
  parseCountryFromProfile,
  parseHistoryPeriodsFromHtml,
  calendarMonthKey,
  currentCalendarMonthKey,
  sumCurrentMonthDiamonds,
  aggregateMonthlyDiamonds,
  fetchCurrentMonthFromHistory,
  fetchMonthlyPeakFromHistory,
  scaleDollarsWindowToL30,
  scaleDollarsWindowToL28,
  sumDiamondsFromJson,
  exportCookiesFromSession,
  launchTikleapChrome,
  releaseProfileLock,
  minimizeChromeWindow,
  createBackgroundTarget,
  createTikleapClient,
  meetsDiamondFloor,
  isPreferredDiamondBand,
  isDiamondsKnown,
  isInactiveDiamondsL30,
  shouldKeepForDiamonds,
};
