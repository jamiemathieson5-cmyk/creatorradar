const { normalizeRegion } = require("./regionFilter");

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function isNumericUserId(value) {
  return typeof value === "string" && /^\d{5,}$/.test(value);
}

function normalizeUserId(value) {
  if (value == null || value === "") return "";
  const str = String(value).trim();
  return isNumericUserId(str) ? str : "";
}

function readUserFromUniversal(data, handle) {
  const user =
    data?.__DEFAULT_SCOPE__?.["webapp.user-detail"]?.userInfo?.user || null;
  if (!user) return null;
  const unique = String(user.uniqueId || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
  if (handle && unique && unique !== handle) return null;
  return user;
}

/**
 * Pull numeric TikTok uid + region from public profile HTML.
 * Prefers __UNIVERSAL_DATA_FOR_REHYDRATION__ → userInfo.user.
 * @returns {{ userId: string, region: string|null }}
 */
function parseProfileFromHtml(html, username) {
  const empty = { userId: "", region: null };
  if (!html || typeof html !== "string") return empty;

  const handle = String(username || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();

  const universal = html.match(
    /<script[^>]+id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/i
  );
  if (universal) {
    try {
      const data = JSON.parse(universal[1]);
      const user = readUserFromUniversal(data, handle);
      if (user) {
        const userId = normalizeUserId(user.id || user.id_str || user.uid);
        // Creator account region is often omitted on public web profiles now.
        // Only trust explicit user.* region/country fields — never a page-level
        // "region" string (that is frequently the viewer/app locale, e.g. GB).
        const region =
          normalizeRegion(user.region) ||
          normalizeRegion(user.country) ||
          normalizeRegion(user.countryCode) ||
          normalizeRegion(user.storeRegion) ||
          normalizeRegion(user.store_region) ||
          null;
        return { userId: userId || "", region };
      }
    } catch {
      // fall through to regex
    }
  }

  const patterns = [
    /"userInfo"\s*:\s*\{\s*"user"\s*:\s*\{\s*"id"\s*:\s*"(\d{5,})"/,
    /"uniqueId"\s*:\s*"([^"]+)"[^}]{0,400}?"id"\s*:\s*"(\d{5,})"/,
    /"id"\s*:\s*"(\d{5,})"[^}]{0,400}?"uniqueId"\s*:\s*"([^"]+)"/,
  ];

  let userId = "";
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (!match) continue;
    if (pattern.source.startsWith('"userInfo"')) {
      userId = normalizeUserId(match[1]);
      break;
    }
    if (match[2] && /^\d{5,}$/.test(match[1])) {
      const unique = String(match[2]).toLowerCase().replace(/^@+/, "");
      if (!handle || unique === handle) {
        userId = normalizeUserId(match[1]);
        break;
      }
    }
    if (match[2] && /^\d{5,}$/.test(match[2])) {
      const unique = String(match[1]).toLowerCase().replace(/^@+/, "");
      if (!handle || unique === handle) {
        userId = normalizeUserId(match[2]);
        break;
      }
    }
  }

  // Do not regex-scrape page-level "region" — it is usually the viewer locale.
  return { userId: userId || "", region: null };
}

/** @deprecated Prefer parseProfileFromHtml — kept for existing callers. */
function parseUserIdFromProfileHtml(html, username) {
  return parseProfileFromHtml(html, username).userId;
}

async function fetchProfileHtml(username, options = {}) {
  const handle = String(username || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
  if (!handle) return "";

  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 12000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`https://www.tiktok.com/@${encodeURIComponent(handle)}`, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-GB,en;q=0.9",
      },
    });
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

async function resolveUserIdFromUsername(username, options = {}) {
  const html = await fetchProfileHtml(username, options);
  if (!html) return "";
  return parseProfileFromHtml(html, username).userId;
}

/**
 * Resolve uid + region from public profile in one request.
 * @returns {{ userId: string, region: string|null }}
 */
async function resolveProfileFromUsername(username, options = {}) {
  const handle = String(username || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
  if (!handle) return { userId: "", region: null };
  const html = await fetchProfileHtml(handle, options);
  if (!html) return { userId: "", region: null };
  return parseProfileFromHtml(html, handle);
}

module.exports = {
  isNumericUserId,
  normalizeUserId,
  parseUserIdFromProfileHtml,
  parseProfileFromHtml,
  resolveUserIdFromUsername,
  resolveProfileFromUsername,
  fetchProfileHtml,
};
