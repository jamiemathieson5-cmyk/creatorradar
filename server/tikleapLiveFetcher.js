/**
 * TikLeap Get leads (priority 1–2 of the ordered pipeline):
 *   P1 — GB accounts tagged LIVE Now (country-live + Live Now badges)
 *   P2 — other GB accounts from last-14d boards / popular / period
 *
 * L30 diamonds in 1K–150K when known; unknown/masked L30 still kept.
 * Prefer-exclude when current calendar month ≥200K (when known).
 *
 * Sources (merged by username):
 *  1. /country/gb — Today's daily top ~99 (ranklist-table-row)
 *  2. /country/gb/hourly — Today's hourly board (~300–400)
 *  3. /country/gb/hourly/DD.MM.YYYY — Prior 13 London calendar days
 *     (TikLeap has no weekly board; dated hourly is the 14-day inventory)
 *  4. /country/gb period=14 — rolling last-14-days daily ranklist
 *  5. /country/gb/popular — popular / popular-live board
 *  6. /country-live/gb — Currently-live JSON fragment
 *
 * Lookups run LIVE NOW first, then remaining GB board inventory, until
 * MANUAL_REFRESH_LIMIT keepers (shared with TikTok feed as P3), UK 14d
 * inventory is exhausted after filters, or the hard time budget elapses.
 *
 * Caveat: boards only list top earners for each day (not every UK live),
 * so mid/low earners who went live but never ranked are invisible.
 */

const {
  MANUAL_REFRESH_LIMIT,
  MANUAL_REFRESH_TIMEOUT_MS,
  LIVE_LOOKBACK_DAYS,
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
const { normalizeUserId } = require("./resolveUserId");
const { shouldBlockRescrape, addLeads } = require("./store");
const {
  launchTikleapChrome,
  createTikleapClient,
  hasLoginProfile,
  cookiesPath,
  profileDir,
  isDiamondsKnown,
  isInactiveDiamondsL30,
  shouldKeepForDiamonds,
  parseCompactNumber,
} = require("./tikleap");

/** UK daily ranking page (top ~99; includes currently live + earlier today). */
const COUNTRY_PAGE_URL = "https://www.tikleap.com/country/gb";
/** UK hourly ranking — deeper list (~300–400) with mid-tier creators. */
const COUNTRY_HOURLY_URL = "https://www.tikleap.com/country/gb/hourly";
/** Popular / popular-live UK board (extra mid-tier handles). */
const COUNTRY_POPULAR_URL = "https://www.tikleap.com/country/gb/popular";
/** Currently-live UK JSON fragment — merged so live-now is never dropped. */
const COUNTRY_LIVE_URL = "https://www.tikleap.com/country-live/gb";

const USD_PER_DIAMOND = 0.005;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * TikLeap board dates use DD.MM.YYYY in Europe/London.
 * @param {number} daysAgo
 */
function tikleapLondonDate(daysAgo = 0) {
  const ms = Date.now() - Math.max(0, daysAgo) * 24 * 60 * 60 * 1000;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(new Date(ms));
  const dd = parts.find((p) => p.type === "day")?.value || "01";
  const mm = parts.find((p) => p.type === "month")?.value || "01";
  const yyyy = parts.find((p) => p.type === "year")?.value || "1970";
  return `${dd}.${mm}.${yyyy}`;
}

function countryHourlyUrlForDay(daysAgo) {
  if (daysAgo <= 0) return COUNTRY_HOURLY_URL;
  return `${COUNTRY_HOURLY_URL}/${tikleapLondonDate(daysAgo)}`;
}

function usernameFromHref(href) {
  const m = String(href || "").match(/\/profile\/([^/?#]+)/i);
  if (!m) return "";
  try {
    return decodeURIComponent(m[1])
      .trim()
      .replace(/^@+/, "")
      .toLowerCase();
  } catch {
    return m[1].trim().replace(/^@+/, "").toLowerCase();
  }
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function dollarsToBoardDiamonds(dollars) {
  if (!Number.isFinite(dollars)) return null;
  return Math.floor(dollars / USD_PER_DIAMOND);
}

/**
 * Parse ranklist HTML (daily page or /country-live/gb JSON.html).
 * @param {string} html
 * @param {{ assumeLiveNow?: boolean }} [options]
 * @returns {Array<{ username: string, userId: string, displayName: string, avatarUrl: string, todayDiamonds: number|null, todayEarning: number|null, liveNow: boolean }>}
 */
function parseLiveRowsFromHtml(html, { assumeLiveNow = false } = {}) {
  // TikLeap JSON sometimes embeds HTML with \/ escaped slashes.
  const raw = String(html || "").replace(/\\\//g, "/");
  if (!raw.trim()) return [];
  const rows = [];
  const seen = new Set();
  const re =
    /<a\b[^>]*class="[^"]*ranklist-table-row[^"]*"[^>]*href="([^"]*\/profile\/[^"]+)"[^>]*>/gi;
  let match;
  while ((match = re.exec(raw))) {
    const fullTag = match[0];
    const href = match[1];
    const username = usernameFromHref(href);
    if (!username || seen.has(username)) continue;
    seen.add(username);

    const uidMatch = fullTag.match(/data-user-id="(\d+)"/i);
    const diamondsMatch = fullTag.match(/data-diamonds="([^"]*)"/i);
    const earningMatch = fullTag.match(/data-earning="([^"]*)"/i);
    const scoreMatch = fullTag.match(/data-score="([^"]*)"/i);

    // Display name + TikTok CDN avatar live in the row body.
    const slice = raw.slice(match.index, match.index + 2200);
    const nameMatch = slice.match(
      /ranklist-username[^>]*>([\s\S]*?)<\/(?:div|span|a)>/i
    );
    let displayName = username;
    if (nameMatch) {
      displayName =
        decodeHtmlEntities(nameMatch[1].replace(/<[^>]+>/g, ""))
          .replace(/\s+/g, " ")
          .trim() || username;
    }

    const avatarMatch = slice.match(
      /avatar-wrapper[\s\S]{0,400}?<img[^>]+src="([^"]+)"/i
    );
    const avatarUrl = avatarMatch
      ? decodeHtmlEntities(avatarMatch[1]).trim()
      : "";

    const todayDiamonds =
      parseCompactNumber(diamondsMatch?.[1]) ??
      parseCompactNumber(scoreMatch?.[1]);
    const todayEarning = Number(earningMatch?.[1]);
    const liveNow =
      assumeLiveNow || /Live\s*Now/i.test(slice) || /Live\s*Now/i.test(fullTag);
    rows.push({
      username,
      userId: uidMatch?.[1] || "",
      displayName,
      avatarUrl,
      todayDiamonds: Number.isFinite(todayDiamonds) ? todayDiamonds : null,
      todayEarning: Number.isFinite(todayEarning) ? todayEarning : null,
      liveNow: Boolean(liveNow),
    });
  }
  return rows;
}

/**
 * Parse /country/gb/hourly HTML (user-earning-item cards — deeper UK list).
 * @param {string} html
 */
function parseEarningRowsFromHtml(html) {
  const raw = String(html || "").replace(/\\\//g, "/");
  if (!raw.trim()) return [];
  const rows = [];
  const seen = new Set();
  const re =
    /<div\b[^>]*class="[^"]*user-earning-item[^"]*"[^>]*>/gi;
  let match;
  while ((match = re.exec(raw))) {
    const openTag = match[0];
    const slice = raw.slice(match.index, match.index + 2000);
    const uidMatch = openTag.match(/data-user-id="(\d+)"/i);
    const hrefMatch = slice.match(
      /user-earning-profile[^>]*href="([^"]*\/profile\/[^"]+)"/i
    );
    const username = usernameFromHref(hrefMatch?.[1]);
    if (!username || seen.has(username)) continue;
    seen.add(username);

    const nameMatch = slice.match(
      /user-earning-nickname[^>]*>([\s\S]*?)<\//i
    );
    let displayName = username;
    if (nameMatch) {
      displayName =
        decodeHtmlEntities(nameMatch[1].replace(/<[^>]+>/g, ""))
          .replace(/\s+/g, " ")
          .trim() || username;
    }

    const avatarMatch = slice.match(
      /user-earning-avatar[\s\S]{0,400}?<img[^>]+src="([^"]+)"/i
    );
    const avatarUrl = avatarMatch
      ? decodeHtmlEntities(avatarMatch[1]).trim()
      : "";

    const snapshotMatch = slice.match(
      /user-earning-amount[^>]*data-last-snapshot="([^"]+)"/i
    );
    const amountTextMatch = slice.match(
      /user-earning-amount[^>]*>\s*\$?\s*([\d,.]+[kKmMbB]?)/i
    );
    const dollars =
      parseCompactNumber(snapshotMatch?.[1]) ??
      parseCompactNumber(amountTextMatch?.[1]);
    const todayDiamonds = dollarsToBoardDiamonds(dollars);

    rows.push({
      username,
      userId: uidMatch?.[1] || "",
      displayName,
      avatarUrl,
      todayDiamonds: Number.isFinite(todayDiamonds) ? todayDiamonds : null,
      todayEarning: Number.isFinite(dollars) ? dollars : null,
      liveNow: false,
    });
  }
  return rows;
}

/**
 * Fallback: extract all daily-rank profiles from /country/gb DOM via CDP.
 */
async function scrapeDailyFromCountryPage(browserSession, sessionId) {
  await browserSession.send("Page.navigate", { url: COUNTRY_PAGE_URL }, sessionId);
  await sleep(2800);
  const evaluated = await browserSession.send(
    "Runtime.evaluate",
    {
      expression: `(() => {
        const out = [];
        const seen = new Set();
        for (const a of document.querySelectorAll('a.ranklist-table-row[href*="/profile/"]')) {
          const href = a.getAttribute('href') || '';
          const user = (href.split('/profile/')[1] || '').split(/[?#]/)[0];
          if (!user || seen.has(user.toLowerCase())) continue;
          seen.add(user.toLowerCase());
          const text = String(a.innerText || '');
          const uid = a.getAttribute('data-user-id') || '';
          const img = a.querySelector('img[src]');
          const avatarUrl = img ? String(img.getAttribute('src') || '').trim() : '';
          out.push({
            username: user.toLowerCase(),
            userId: uid || '',
            displayName: (a.querySelector('.ranklist-username')?.innerText || text || user)
              .replace(/\\s+/g, ' ')
              .trim() || user,
            avatarUrl,
            liveNow: /Live\\s*Now/i.test(text),
          });
        }
        return out;
      })()`,
      returnByValue: true,
    },
    sessionId
  );
  const list = evaluated?.result?.value;
  return Array.isArray(list) ? list : [];
}

async function scrapeHourlyFromCountryPage(browserSession, sessionId) {
  await browserSession.send(
    "Page.navigate",
    { url: COUNTRY_HOURLY_URL },
    sessionId
  );
  await sleep(2800);
  const evaluated = await browserSession.send(
    "Runtime.evaluate",
    {
      expression: `(() => {
        const out = [];
        const seen = new Set();
        for (const item of document.querySelectorAll('.user-earning-item')) {
          const a = item.querySelector('a.user-earning-profile[href*="/profile/"]');
          if (!a) continue;
          const href = a.getAttribute('href') || '';
          const user = (href.split('/profile/')[1] || '').split(/[?#]/)[0];
          if (!user || seen.has(user.toLowerCase())) continue;
          seen.add(user.toLowerCase());
          const uid = item.getAttribute('data-user-id') || '';
          const img = item.querySelector('img[src]');
          const amt = item.querySelector('.user-earning-amount');
          const snap = amt ? amt.getAttribute('data-last-snapshot') : '';
          out.push({
            username: user.toLowerCase(),
            userId: uid || '',
            displayName: (item.querySelector('.user-earning-nickname')?.innerText || user)
              .replace(/\\s+/g, ' ')
              .trim() || user,
            avatarUrl: img ? String(img.getAttribute('src') || '').trim() : '',
            todayEarning: snap ? Number(snap) : null,
            liveNow: false,
          });
        }
        return out;
      })()`,
      returnByValue: true,
    },
    sessionId
  );
  const list = evaluated?.result?.value;
  if (!Array.isArray(list)) return [];
  return list.map((row) => {
    const dollars = Number(row.todayEarning);
    const todayDiamonds = Number.isFinite(dollars)
      ? dollarsToBoardDiamonds(dollars)
      : null;
    return {
      ...row,
      todayDiamonds,
      todayEarning: Number.isFinite(dollars) ? dollars : null,
    };
  });
}

/**
 * Activate TikLeap's "Last N days" period on /country/gb and scrape ranklist rows.
 * Adds UK creators who ranked in the rolling window but may miss hourly boards.
 * @param {object} browserSession
 * @param {string} sessionId
 * @param {string|number} period — e.g. "14" for Last 14 days
 */
async function scrapeCountryPeriodBoard(
  browserSession,
  sessionId,
  period = String(LIVE_LOOKBACK_DAYS)
) {
  const periodKey = String(period || LIVE_LOOKBACK_DAYS);
  await browserSession.send("Page.navigate", { url: COUNTRY_PAGE_URL }, sessionId);
  await sleep(2200);
  const evaluated = await browserSession.send(
    "Runtime.evaluate",
    {
      expression: `(async () => {
        const period = ${JSON.stringify(periodKey)};
        const btn = document.querySelector(
          '.change-global-period[data-period="' + period + '"]'
        ) || document.querySelector(
          '.change-country-stats-period[data-period="' + period + '"]'
        ) || document.querySelector(
          '[data-period="' + period + '"].change-global-period'
        ) || document.querySelector(
          '[data-period="' + period + '"].change-country-stats-period'
        );
        if (btn) {
          btn.click();
          await new Promise((r) => setTimeout(r, 2800));
        }
        const out = [];
        const seen = new Set();
        for (const a of document.querySelectorAll('a.ranklist-table-row[href*="/profile/"]')) {
          const href = a.getAttribute('href') || '';
          const user = (href.split('/profile/')[1] || '').split(/[?#]/)[0];
          if (!user || seen.has(user.toLowerCase())) continue;
          seen.add(user.toLowerCase());
          const text = String(a.innerText || '');
          const uid = a.getAttribute('data-user-id') || '';
          const dia = a.getAttribute('data-diamonds') || a.getAttribute('data-score') || '';
          const img = a.querySelector('img[src]');
          out.push({
            username: user.toLowerCase(),
            userId: uid || '',
            displayName: (a.querySelector('.ranklist-username')?.innerText || text || user)
              .replace(/\\s+/g, ' ')
              .trim() || user,
            avatarUrl: img ? String(img.getAttribute('src') || '').trim() : '',
            todayDiamondsRaw: dia,
            liveNow: /Live\\s*Now/i.test(text),
          });
        }
        return { count: out.length, rows: out, clicked: Boolean(btn) };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    },
    sessionId
  );
  const payload = evaluated?.result?.value;
  const list = Array.isArray(payload?.rows) ? payload.rows : [];
  return list.map((row) => ({
    username: row.username,
    userId: row.userId || "",
    displayName: row.displayName || row.username,
    avatarUrl: row.avatarUrl || "",
    todayDiamonds: parseCompactNumber(row.todayDiamondsRaw),
    todayEarning: null,
    liveNow: Boolean(row.liveNow),
  }));
}

async function fetchUrlText(browserSession, sessionId, url, accept) {
  const evaluated = await browserSession.send(
    "Runtime.evaluate",
    {
      expression: `(async () => {
        try {
          const res = await fetch(${JSON.stringify(url)}, {
            credentials: "include",
            headers: { Accept: ${JSON.stringify(accept)} },
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
  return evaluated?.result?.value || { status: 0, text: "" };
}

/**
 * Merge UK board rows by username (earlier lists win base fields; later fill gaps).
 * @param {...Array<object>} lists
 */
function mergeUkRows(...lists) {
  const byUser = new Map();
  for (const list of lists) {
    for (const row of list || []) {
      const username = String(row.username || "")
        .trim()
        .replace(/^@+/, "")
        .toLowerCase();
      if (!username) continue;
      const prev = byUser.get(username);
      if (!prev) {
        byUser.set(username, { ...row, username });
        continue;
      }
      const prevDia = Number(prev.todayDiamonds);
      const nextDia = Number(row.todayDiamonds);
      byUser.set(username, {
        ...prev,
        liveNow: Boolean(prev.liveNow || row.liveNow),
        userId: prev.userId || row.userId || "",
        avatarUrl: prev.avatarUrl || row.avatarUrl || "",
        displayName: prev.displayName || row.displayName || username,
        // Keep the stronger board score when both present (any day in window).
        todayDiamonds:
          Number.isFinite(prevDia) && Number.isFinite(nextDia)
            ? Math.max(prevDia, nextDia)
            : Number.isFinite(prevDia)
              ? prevDia
              : Number.isFinite(nextDia)
                ? nextDia
                : null,
        todayEarning:
          prev.todayEarning != null ? prev.todayEarning : row.todayEarning ?? null,
      });
    }
  }
  return [...byUser.values()];
}

/**
 * Board period score already above L30 max ⇒ L30 cannot be in-band.
 * (A single day/hour board score is a subset of the last-30-day window.)
 */
function boardScoreOverCap(todayDiamonds) {
  const n = Number(todayDiamonds);
  return Number.isFinite(n) && n > MAX_DIAMONDS_L30;
}

/**
 * Prefer LIVE NOW, then mid-tier board scores (whales last).
 * Over-cap board scores are sorted to the end (pre-skipped).
 */
function sortCandidatesForLookup(candidates) {
  return [...candidates].sort((a, b) => {
    const aLive = a.liveNow ? 0 : 1;
    const bLive = b.liveNow ? 0 : 1;
    if (aLive !== bLive) return aLive - bLive;
    const aOver = boardScoreOverCap(a.todayDiamonds) ? 1 : 0;
    const bOver = boardScoreOverCap(b.todayDiamonds) ? 1 : 0;
    if (aOver !== bOver) return aOver - bOver;
    const da =
      a.todayDiamonds == null
        ? Number.POSITIVE_INFINITY
        : Number(a.todayDiamonds);
    const db =
      b.todayDiamonds == null
        ? Number.POSITIVE_INFINITY
        : Number(b.todayDiamonds);
    return da - db;
  });
}

/**
 * @param {{
 *   limit?: number,
 *   timeoutMs?: number,
 *   tikleapWorkers?: number,
 *   sharedKeepers?: object,
 *   tikleapClient?: ReturnType<typeof createTikleapClient>,
 *   browserSession?: object,
 *   listSessionId?: string,
 *   sessionIds?: string[],
 *   ownCleanup?: boolean,
 * }} [options]
 */
async function fetchTikleapUkLiveLeads({
  limit = MANUAL_REFRESH_LIMIT,
  timeoutMs = MANUAL_REFRESH_TIMEOUT_MS,
  tikleapWorkers = undefined,
  sharedKeepers = null,
  tikleapClient: externalClient = null,
  browserSession: externalBrowserSession = null,
  listSessionId: externalListSessionId = null,
  sessionIds: externalSessionIds = null,
  ownCleanup = true,
} = {}) {
  const cap = Math.max(1, Math.floor(Number(limit)) || MANUAL_REFRESH_LIMIT);
  if (!hasLoginProfile()) {
    const err = new Error(
      `TikLeap Premium login required for UK last-${LIVE_LOOKBACK_DAYS}-day scrape ` +
        `(L30 ${MIN_DIAMONDS_L30.toLocaleString()}–${MAX_DIAMONDS_L30.toLocaleString()} when known; ` +
        `unknown L30 kept; prefer current month <${MAX_DIAMONDS_CURRENT_MONTH.toLocaleString()}). ` +
        `Run ./scripts/tikleap-login.sh, log in with Premium, then Get leads again. ` +
        `(profile ${profileDir()} / cookies ${cookiesPath()})`
    );
    err.code = "TIKLEAP_SESSION_REQUIRED";
    throw err;
  }

  const maxLookup = Math.max(1, MAX_TIKLEAP_CHROME_TABS - 1);
  const requestedWorkers = Number(tikleapWorkers);
  const workerN = Math.max(
    1,
    Math.min(
      maxLookup,
      Math.floor(
        Number.isFinite(requestedWorkers) && requestedWorkers > 0
          ? requestedWorkers
          : resolveTikleapLookupWorkers()
      )
    )
  );
  const hardTimeoutMs = Math.max(
    120000,
    Math.floor(Number(timeoutMs) || MANUAL_REFRESH_TIMEOUT_MS)
  );
  const parallelMode = Boolean(sharedKeepers);

  if (!parallelMode) {
    updateRefreshProgress({
      phase: "live_now",
      limit: cap,
      maxPages: 1,
      timeoutMs: hardTimeoutMs,
      leads: 0,
      pages: 0,
      rawSeen: 0,
      hasMore: true,
      tikleapKept: 0,
      tikleapSkipped: 0,
    });
  }

  console.log(
    `[tikleapLive] Starting TikLeap UK scrape ` +
      `(P1 LIVE NOW → P2 last-${LIVE_LOOKBACK_DAYS}d boards; ` +
      `hourly + daily + period + popular + country-live, ` +
      `L30 ${MIN_DIAMONDS_L30.toLocaleString()}–${MAX_DIAMONDS_L30.toLocaleString()} when known ` +
      `(unknown kept), prefer current month <${MAX_DIAMONDS_CURRENT_MONTH.toLocaleString()}, ` +
      `${workerN} lookup tabs, ` +
      `budget ${Math.round(hardTimeoutMs / 60000)}m` +
      (parallelMode ? ", shared cap with TikTok feed P3" : "") +
      `)…`
  );

  /** @type {{ cleanup: () => void, browserSession: object, sessionIds?: string[], sessionId?: string }|null} */
  let launch = null;
  let browserSession = externalBrowserSession;
  let listSessionId = externalListSessionId;
  if (!browserSession || !listSessionId) {
    launch = await launchTikleapChrome({ workers: workerN });
    browserSession = launch.browserSession;
    listSessionId = launch.sessionIds?.[0] || launch.sessionId;
  }
  const started = Date.now();

  /** @type {ReturnType<typeof createTikleapClient>|null} */
  let client = externalClient || null;
  const leads = [];
  let rawSeen = 0;
  let tikleapKept = 0;
  let tikleapSkipped = 0;
  let preSkipped = 0;
  let boardOverCapSkipped = 0;
  let diamondOverCap = 0;
  let diamondUnderFloor = 0;
  /** Kept despite masked/unparsed/missing L30 (not a hard reject). */
  let diamondUnknownKept = 0;
  let monthOverCapSkipped = 0;
  let lookupRetries = 0;
  let timedOut = false;
  let candidates = [];
  /** @type {Array<object>} */
  const retryCandidates = [];
  const keptUsernames = new Set();

  const keptCount = () =>
    parallelMode ? sharedKeepers.getKeptCount() : leads.length;
  const atCap = () => (parallelMode ? sharedKeepers.isFull() : leads.length >= cap);

  try {
    if (!client) {
      client = createTikleapClient(
        browserSession,
        externalSessionIds || launch?.sessionIds || [launch.sessionId],
        // Extra settle budget: L30 paint + optional history crawl for in-band.
        { maxSettleMs: 2200 }
      );
      const ready = await client.ensureReady();
      if (!ready.ok) {
        const err = new Error(ready.reason || "TikLeap login required.");
        err.code = "TIKLEAP_SESSION_REQUIRED";
        throw err;
      }
    }

    if (!parallelMode) {
      updateRefreshProgress({ phase: "live_now" });
    } else {
      sharedKeepers.setPhase("live_now");
    }

    // Ensure we are on tikleap origin for credentialed fetch.
    try {
      await browserSession.send(
        "Page.navigate",
        { url: "https://www.tikleap.com/" },
        listSessionId
      );
      await sleep(800);
    } catch {
      // ignore
    }

    let dailyRows = [];
    const dailyResp = await fetchUrlText(
      browserSession,
      listSessionId,
      COUNTRY_PAGE_URL,
      "text/html,application/xhtml+xml,*/*"
    );
    if (dailyResp.status === 200 && dailyResp.text) {
      dailyRows = parseLiveRowsFromHtml(dailyResp.text);
      console.log(
        `[tikleapLive] country/gb daily: ${dailyRows.length} UK rows (http ${dailyResp.status})`
      );
    } else {
      console.warn(
        `[tikleapLive] country/gb failed status=${dailyResp.status}` +
          (dailyResp.error ? ` err=${dailyResp.error}` : "") +
          " — will try DOM fallback"
      );
    }

    /** @type {Array<{ daysAgo: number, date: string, rows: ReturnType<typeof parseEarningRowsFromHtml> }>} */
    const hourlyByDay = [];
    for (let daysAgo = 0; daysAgo < LIVE_LOOKBACK_DAYS; daysAgo += 1) {
      const date = tikleapLondonDate(daysAgo);
      const url = countryHourlyUrlForDay(daysAgo);
      const hourlyResp = await fetchUrlText(
        browserSession,
        listSessionId,
        url,
        "text/html,application/xhtml+xml,*/*"
      );
      let rows = [];
      if (hourlyResp.status === 200 && hourlyResp.text) {
        rows = parseEarningRowsFromHtml(hourlyResp.text);
        console.log(
          `[tikleapLive] country/gb/hourly${daysAgo ? `/${date}` : ""}: ` +
            `${rows.length} UK rows (http ${hourlyResp.status})`
        );
      } else {
        console.warn(
          `[tikleapLive] country/gb/hourly${daysAgo ? `/${date}` : ""} ` +
            `failed status=${hourlyResp.status}` +
            (hourlyResp.error ? ` err=${hourlyResp.error}` : "")
        );
      }
      hourlyByDay.push({ daysAgo, date, rows });
    }

    let liveRows = [];
    const liveResp = await fetchUrlText(
      browserSession,
      listSessionId,
      COUNTRY_LIVE_URL,
      "application/json, text/plain, */*"
    );
    if (liveResp.status === 200 && liveResp.text) {
      let html = liveResp.text;
      try {
        const json = JSON.parse(liveResp.text);
        if (json && typeof json.html === "string") html = json.html;
      } catch {
        // plain HTML
      }
      liveRows = parseLiveRowsFromHtml(html, { assumeLiveNow: true });
      console.log(
        `[tikleapLive] country-live/gb: ${liveRows.length} live-now UK rows (http ${liveResp.status})`
      );
    } else {
      console.warn(
        `[tikleapLive] country-live/gb failed status=${liveResp.status}` +
          (liveResp.error ? ` err=${liveResp.error}` : "")
      );
    }

    if (!dailyRows.length) {
      dailyRows = await scrapeDailyFromCountryPage(browserSession, listSessionId);
      console.log(
        `[tikleapLive] country/gb DOM fallback: ${dailyRows.length} daily rows`
      );
    }
    if (!hourlyByDay[0]?.rows?.length) {
      const fallback = await scrapeHourlyFromCountryPage(
        browserSession,
        listSessionId
      );
      hourlyByDay[0] = {
        daysAgo: 0,
        date: tikleapLondonDate(0),
        rows: fallback,
      };
      console.log(
        `[tikleapLive] country/gb/hourly DOM fallback: ${fallback.length} hourly rows`
      );
    }

    let popularRows = [];
    const popularResp = await fetchUrlText(
      browserSession,
      listSessionId,
      COUNTRY_POPULAR_URL,
      "text/html,application/xhtml+xml,*/*"
    );
    if (popularResp.status === 200 && popularResp.text) {
      popularRows = parseLiveRowsFromHtml(popularResp.text);
      if (!popularRows.length) {
        popularRows = parseEarningRowsFromHtml(popularResp.text);
      }
      console.log(
        `[tikleapLive] country/gb/popular: ${popularRows.length} UK rows (http ${popularResp.status})`
      );
    } else {
      console.warn(
        `[tikleapLive] country/gb/popular failed status=${popularResp.status}` +
          (popularResp.error ? ` err=${popularResp.error}` : "")
      );
    }

    let periodRows = [];
    const periodKey = String(LIVE_LOOKBACK_DAYS);
    try {
      periodRows = await scrapeCountryPeriodBoard(
        browserSession,
        listSessionId,
        periodKey
      );
      console.log(
        `[tikleapLive] country/gb period=${periodKey}d: ${periodRows.length} UK rows`
      );
    } catch (error) {
      console.warn(
        `[tikleapLive] country/gb period=${periodKey}d failed: ${error.message || error}`
      );
    }

    const hourlyLists = hourlyByDay.map((d) => d.rows);
    const hourlyRowTotal = hourlyLists.reduce((n, list) => n + list.length, 0);
    const merged = mergeUkRows(
      dailyRows,
      ...hourlyLists,
      liveRows,
      popularRows,
      periodRows
    );
    const liveNowCount = merged.filter((r) => r.liveNow).length;
    rawSeen = merged.length;
    if (parallelMode) {
      sharedKeepers.setBoardStats({ rawSeen, pages: 1 });
    } else {
      updateRefreshProgress({
        phase: "tikleap",
        rawSeen,
        pages: 1,
        hasMore: merged.length > 0,
      });
    }

    console.log(
      `[tikleapLive] merged ${merged.length} UK candidates` +
        ` (daily=${dailyRows.length}, hourlyRows=${hourlyRowTotal}` +
        ` across ${LIVE_LOOKBACK_DAYS}d,` +
        ` popular=${popularRows.length}, period${LIVE_LOOKBACK_DAYS}=${periodRows.length},` +
        ` liveNow=${liveRows.length}, taggedLiveNow=${liveNowCount})`
    );

    // Prefilter: denylist + non-new CRM rows. Still-`new` leads are re-scraped.
    for (const row of merged) {
      const username = String(row.username || "")
        .trim()
        .replace(/^@+/, "")
        .toLowerCase();
      if (!username) continue;
      const userId = normalizeUserId(row.userId) || "";
      if (shouldBlockRescrape(username, userId)) {
        preSkipped += 1;
        tikleapSkipped += 1;
        continue;
      }
      if (parallelMode && sharedKeepers.shouldSkip(username)) {
        preSkipped += 1;
        tikleapSkipped += 1;
        continue;
      }
      candidates.push({
        username,
        userId,
        displayName: row.displayName || username,
        avatarUrl: row.avatarUrl || "",
        todayDiamonds: row.todayDiamonds ?? null,
        todayEarning: row.todayEarning ?? null,
        liveNow: Boolean(row.liveNow),
      });
    }

    candidates = sortCandidatesForLookup(candidates);
    const liveNowCandidates = candidates.filter((c) => c.liveNow);
    const otherCandidates = candidates.filter((c) => !c.liveNow);

    console.log(
      `[tikleapLive] ${candidates.length} candidates after new-rescrape filter` +
        ` (P1 liveNow=${liveNowCandidates.length}, P2 other=${otherCandidates.length},` +
        ` ${preSkipped} pre-skipped, ${rawSeen} raw)`
    );

    // Ordered L30 (+ monthly) lookups: LIVE NOW first, then other GB boards.
    // Keep going until cap, pool exhausted, or hard time budget.
    let nextIndex = 0;
    let sessionDead = false;
    let activeQueue = liveNowCandidates.length ? liveNowCandidates : otherCandidates;
    /** @type {"live_now"|"tikleap_other"} */
    let boardPhase = liveNowCandidates.length ? "live_now" : "tikleap_other";

    const diamondSkipped = () =>
      boardOverCapSkipped +
      diamondOverCap +
      diamondUnderFloor +
      monthOverCapSkipped;

    const publish = () => {
      const qSize = Math.max(0, activeQueue.length - nextIndex);
      const resolvingN = Math.min(workerN, qSize);
      if (parallelMode) {
        sharedKeepers.setBoardStats({
          phase: boardPhase,
          rawSeen,
          pages: 1,
          tikleapSkipped,
          queueSize: qSize,
          resolving: resolvingN,
        });
        return;
      }
      updateRefreshProgress({
        phase: boardPhase,
        leads: leads.length,
        rawSeen,
        pages: 1,
        hasMore: nextIndex < activeQueue.length && leads.length < cap,
        tikleapKept,
        tikleapSkipped,
        queueSize: qSize,
        resolving: resolvingN,
      });
    };

    const buildLead = (candidate, diamonds, tl) => {
      const nowIso = new Date().toISOString();
      const known = isDiamondsKnown(diamonds);
      const floor = known ? Math.floor(Number(diamonds)) : null;
      return {
        username: candidate.username,
        displayName: candidate.displayName,
        avatarUrl: candidate.avatarUrl || "",
        profileUrl: `https://www.tiktok.com/@${candidate.username}`,
        userId: candidate.userId || "",
        region: "GB",
        regionSource: "tikleap_country",
        confirmed: true,
        liveNow: Boolean(candidate.liveNow),
        diamondsL30: floor,
        diamondsL28: floor,
        diamondsL30At: known ? nowIso : null,
        diamondsL28At: known ? nowIso : null,
        maxMonthDiamonds:
          tl.maxMonthDiamonds != null &&
          Number.isFinite(Number(tl.maxMonthDiamonds))
            ? Math.floor(Number(tl.maxMonthDiamonds))
            : null,
        source: "tikleap_uk_live",
      };
    };

    const acceptLead = (candidate, diamonds, tl) => {
      if (atCap()) return;
      if (keptUsernames.has(candidate.username)) return;
      const lead = buildLead(candidate, diamonds, tl);
      if (parallelMode) {
        if (!sharedKeepers.tryClaim(candidate.username, lead)) return;
      } else {
        leads.push(lead);
      }
      keptUsernames.add(candidate.username);
      tikleapKept += 1;
      publish();
    };

    /** Known L30 < 500 → CRM inactive; does not burn New keeper slots. */
    const acceptInactiveLead = (candidate, diamonds, tl) => {
      if (keptUsernames.has(candidate.username)) return;
      const lead = buildLead(candidate, diamonds, tl);
      keptUsernames.add(candidate.username);
      if (parallelMode) sharedKeepers.noteRejected(candidate.username);
      try {
        addLeads([lead], { ignoreQuota: true, live: true });
      } catch (error) {
        console.warn(
          `[tikleapLive] inactive persist failed for @${candidate.username}:`,
          error?.message || error
        );
      }
      console.log(
        `[tikleapLive] inactive @${candidate.username}: L30=` +
          `${Math.floor(Number(diamonds)).toLocaleString()} < 500`
      );
      publish();
    };

    const runOne = async (candidate, { forceLookup = false } = {}) => {
      if (sessionDead || atCap()) return;
      if (Date.now() - started > hardTimeoutMs) {
        timedOut = true;
        return;
      }
      if (keptUsernames.has(candidate.username)) return;
      if (parallelMode && sharedKeepers.shouldSkip(candidate.username)) return;

      // Period board score alone already exceeds L30 max — no profile needed.
      if (boardScoreOverCap(candidate.todayDiamonds)) {
        boardOverCapSkipped += 1;
        tikleapSkipped += 1;
        publish();
        return;
      }

      if (parallelMode && !sharedKeepers.beginLookup(candidate.username)) {
        return;
      }

      try {
        if (forceLookup && typeof client.forget === "function") {
          client.forget(candidate.username);
          lookupRetries += 1;
        }

        const tl = await client.lookup(candidate.username, {
          force: Boolean(forceLookup),
        });
        if (tl.sessionDead) {
          sessionDead = true;
          return;
        }

        const diamonds =
          tl.diamondsL30 != null ? tl.diamondsL30 : tl.diamondsL28;

        if (tl.monthOverCap) {
          monthOverCapSkipped += 1;
          tikleapSkipped += 1;
          if (parallelMode) sharedKeepers.noteRejected(candidate.username);
          const cur =
            tl.currentMonthDiamonds != null
              ? Number(tl.currentMonthDiamonds)
              : Number(tl.maxMonthDiamonds);
          console.log(
            `[tikleapLive] skip @${candidate.username}: current-month over-cap` +
              ` (currentMonth=${
                Number.isFinite(cur) ? Math.floor(cur).toLocaleString() : "?"
              }` +
              ` ≥ ${MAX_DIAMONDS_CURRENT_MONTH.toLocaleString()}` +
              (tl.currentMonthKey || tl.maxMonthKey
                ? `, ${tl.currentMonthKey || tl.maxMonthKey}`
                : "") +
              `)`
          );
          publish();
          return;
        }

        const diamondsUnknown =
          Boolean(tl.masked) || !isDiamondsKnown(diamonds);

        // Known L30 outside 1K–150K → skip New. <500 → inactive CRM (no New slot).
        // Unknown/masked → keep as New anyway.
        if (!shouldKeepForDiamonds(diamonds, { masked: Boolean(tl.masked) })) {
          if (isInactiveDiamondsL30(diamonds)) {
            diamondUnderFloor += 1;
            acceptInactiveLead(candidate, diamonds, tl);
            publish();
            return;
          }
          if (Number(diamonds) > MAX_DIAMONDS_L30) {
            diamondOverCap += 1;
          } else {
            diamondUnderFloor += 1;
          }
          tikleapSkipped += 1;
          if (parallelMode) sharedKeepers.noteRejected(candidate.username);
          publish();
          return;
        }

        if (diamondsUnknown) {
          diamondUnknownKept += 1;
          acceptLead(candidate, null, tl);
        } else {
          acceptLead(candidate, diamonds, tl);
        }
      } finally {
        if (parallelMode) sharedKeepers.endLookup(candidate.username);
      }
    };

    const runQueue = async (
      queue,
      { forceLookup = false, label = "pass", phase = null } = {}
    ) => {
      if (!queue.length || atCap() || sessionDead) return;
      if (phase) boardPhase = phase;
      activeQueue = queue;
      nextIndex = 0;
      if (parallelMode && phase) sharedKeepers.setPhase(phase);
      publish();
      console.log(
        `[tikleapLive] ${label}: ${queue.length} candidates` +
          ` (kept ${keptCount()}/${cap}, force=${forceLookup}, phase=${boardPhase})`
      );
      const workers = Array.from(
        { length: Math.min(workerN, queue.length || 1) },
        async () => {
          while (
            !sessionDead &&
            !atCap() &&
            !isRefreshProgressStuck() &&
            Date.now() - started < hardTimeoutMs
          ) {
            const i = nextIndex;
            nextIndex += 1;
            if (i >= queue.length) break;
            try {
              await runOne(queue[i], { forceLookup });
            } catch (error) {
              tikleapSkipped += 1;
              if (parallelMode) sharedKeepers.endLookup(queue[i].username);
              if (!forceLookup) retryCandidates.push(queue[i]);
              console.warn(
                `[tikleapLive] lookup failed @${queue[i].username}: ${
                  error.message || error
                }`
              );
              publish();
            }
          }
          if (Date.now() - started >= hardTimeoutMs) timedOut = true;
        }
      );
      await Promise.all(workers);
    };

    // P1 — LIVE NOW GB accounts
    await runQueue(liveNowCandidates, {
      forceLookup: false,
      label: "P1-live-now",
      phase: "live_now",
    });

    // Continue any unclaimed P1 rows if budget remains (timeout race).
    if (
      !sessionDead &&
      !atCap() &&
      Date.now() - started < hardTimeoutMs &&
      nextIndex < liveNowCandidates.length
    ) {
      const remainder = [];
      for (let i = nextIndex; i < liveNowCandidates.length; i += 1) {
        const row = liveNowCandidates[i];
        if (row && !keptUsernames.has(row.username)) remainder.push(row);
      }
      if (remainder.length) {
        timedOut = false;
        await runQueue(remainder, {
          forceLookup: false,
          label: "P1-live-now-remainder",
          phase: "live_now",
        });
      }
    }

    // P2 — other GB TikLeap board accounts (not LIVE NOW)
    if (!sessionDead && !atCap() && Date.now() - started < hardTimeoutMs) {
      await runQueue(otherCandidates, {
        forceLookup: false,
        label: "P2-tikleap-other",
        phase: "tikleap_other",
      });
    }

    if (
      !sessionDead &&
      !atCap() &&
      Date.now() - started < hardTimeoutMs &&
      nextIndex < otherCandidates.length &&
      boardPhase === "tikleap_other"
    ) {
      const remainder = [];
      for (let i = nextIndex; i < otherCandidates.length; i += 1) {
        const row = otherCandidates[i];
        if (row && !keptUsernames.has(row.username)) remainder.push(row);
      }
      if (remainder.length) {
        timedOut = false;
        await runQueue(remainder, {
          forceLookup: false,
          label: "P2-tikleap-other-remainder",
          phase: "tikleap_other",
        });
      }
    }

    // Retry transient lookup failures while still short of 200 (LIVE NOW first).
    if (
      !sessionDead &&
      !atCap() &&
      retryCandidates.length &&
      Date.now() - started < hardTimeoutMs
    ) {
      const uniqueRetry = [];
      const seenRetry = new Set();
      for (const row of retryCandidates) {
        const u = row.username;
        if (!u || seenRetry.has(u) || keptUsernames.has(u)) continue;
        if (parallelMode && sharedKeepers.shouldSkip(u)) continue;
        seenRetry.add(u);
        uniqueRetry.push(row);
      }
      const retryLive = uniqueRetry.filter((r) => r.liveNow);
      const retryOther = uniqueRetry.filter((r) => !r.liveNow);
      if (retryLive.length) {
        await runQueue(retryLive, {
          forceLookup: true,
          label: "retry-P1-live-now",
          phase: "live_now",
        });
      }
      if (retryOther.length && !atCap()) {
        await runQueue(retryOther, {
          forceLookup: true,
          label: "retry-P2-tikleap-other",
          phase: "tikleap_other",
        });
      }
    }

    if (sessionDead) {
      const err = new Error(
        "TikLeap session blocked (Cloudflare/login). " +
          "Re-run ./scripts/tikleap-login.sh with Premium, then Get leads again."
      );
      err.code = "TIKLEAP_SESSION_DEAD";
      throw err;
    }

    const processedApprox =
      boardOverCapSkipped +
      diamondOverCap +
      diamondUnderFloor +
      monthOverCapSkipped +
      tikleapKept;
    const poolRemaining = Math.max(0, candidates.length - processedApprox);

    if (parallelMode) {
      sharedKeepers.setBoardStats({
        rawSeen,
        pages: 1,
        tikleapSkipped,
        queueSize: 0,
        resolving: 0,
      });
    } else {
      updateRefreshProgress({
        phase: "saving",
        leads: leads.length,
        rawSeen,
        pages: 1,
        hasMore: false,
        tikleapKept,
        tikleapSkipped,
        queueSize: 0,
        resolving: 0,
      });
    }

    const pathKept = tikleapKept;
    let fallbackNotice = null;
    if (pathKept < cap && !atCap()) {
      const reason = timedOut
        ? `hit ${Math.round(hardTimeoutMs / 60000)}m time budget with inventory still queued`
        : `UK last-${LIVE_LOOKBACK_DAYS}d board inventory exhausted after filters`;
      fallbackNotice =
        `TikLeap board path: ${pathKept}/${cap} — ${reason}` +
        ` (raw ${rawSeen}, candidates ${candidates.length},` +
        ` CRM/denylist-skip ${preSkipped}, board-over-cap ${boardOverCapSkipped},` +
        ` L30-over-cap ${diamondOverCap}, under-floor ${diamondUnderFloor},` +
        ` current-month-over-cap ${monthOverCapSkipped},` +
        ` unknown-L30-kept ${diamondUnknownKept}` +
        (poolRemaining ? `, ~${poolRemaining} unchecked` : "") +
        `).`;
      console.warn(`[tikleapLive] shortfall: ${fallbackNotice}`);
    }

    console.log(
      `[tikleapLive] done: board-path kept=${pathKept}` +
        ` (shared=${keptCount()}/${cap}, raw=${rawSeen},` +
        ` preSkipped=${preSkipped},` +
        ` boardOverCap=${boardOverCapSkipped},` +
        ` l30OverCap=${diamondOverCap},` +
        ` l30UnderFloor=${diamondUnderFloor},` +
        ` monthOverCap=${monthOverCapSkipped},` +
        ` unknownL30Kept=${diamondUnknownKept},` +
        ` diamondSkipped=${diamondSkipped()},` +
        ` retries=${lookupRetries},` +
        ` timedOut=${timedOut},` +
        ` elapsed=${Date.now() - started}ms)`
    );

    if (!pathKept && !parallelMode) {
      let detail;
      if (!rawSeen) {
        detail =
          "TikLeap UK boards returned no creators. Try again later.";
      } else if (candidates.length === 0) {
        detail =
          `TikLeap found ${rawSeen} UK creators (last ${LIVE_LOOKBACK_DAYS}d),` +
          ` but all were already non-New / denylist-skipped (${preSkipped}).` +
          ` Mark fewer as contacted or erase New to refresh, then Get leads again.`;
      } else {
        detail =
          `TikLeap checked ${candidates.length} UK creators (last ${LIVE_LOOKBACK_DAYS}d)` +
          ` but none were kept (L30 band ${MIN_DIAMONDS_L30.toLocaleString()}–${MAX_DIAMONDS_L30.toLocaleString()}` +
          ` when known; unknown L30 kept; prefer current month <${MAX_DIAMONDS_CURRENT_MONTH.toLocaleString()})` +
          ` (board-over-cap ${boardOverCapSkipped}, L30-over-cap ${diamondOverCap},` +
          ` under-floor ${diamondUnderFloor}, current-month-over-cap ${monthOverCapSkipped}` +
          (preSkipped ? `, CRM-skipped ${preSkipped}` : "") +
          (timedOut ? ", timed out" : "") +
          `).`;
      }
      const err = new Error(detail);
      err.code = "TIKLEAP_LIVE_EMPTY";
      throw err;
    }

    // In parallel mode, return only this path's keepers for accounting;
    // orchestrator uses sharedKeepers.getLeads() for the merged set.
    const pathLeads = parallelMode
      ? sharedKeepers
          .getLeads()
          .filter((l) => l.source === "tikleap_uk_live")
          .slice(0, cap)
      : leads.slice(0, cap);

    return {
      leads: pathLeads,
      pages: 1,
      rawSeen,
      tikleapKept: pathKept,
      tikleapSkipped,
      confirmMode: "tikleap_uk_live",
      fallbackNotice,
      source: "tikleap_uk_live",
      timedOut,
      inventoryExhausted: !timedOut && !atCap(),
    };
  } finally {
    if (ownCleanup && launch) {
      try {
        launch.cleanup();
      } catch {
        // ignore
      }
    }
  }
}

module.exports = {
  fetchTikleapUkLiveLeads,
  parseLiveRowsFromHtml,
  parseEarningRowsFromHtml,
  mergeUkRows,
  tikleapLondonDate,
  countryHourlyUrlForDay,
  scrapeCountryPeriodBoard,
  LIVE_LOOKBACK_DAYS,
  COUNTRY_LIVE_URL,
  COUNTRY_PAGE_URL,
  COUNTRY_HOURLY_URL,
  COUNTRY_POPULAR_URL,
};
