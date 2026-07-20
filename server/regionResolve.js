/**
 * Trusted TikTok country/region extraction for confirmed-GB Get leads.
 * Only API-ish region/country fields count — never viewer locale.
 */

const {
  normalizeRegion,
  isGbRegion,
  isNonGbRegion,
  isConfirmedGbEvidence,
} = require("./regionFilter");
const { parseProfileFromHtml } = require("./resolveUserId");

const TRUSTED_REGION_KEYS = [
  "region",
  "country",
  "country_code",
  "countryCode",
  "store_region",
  "storeRegion",
  "priority_region",
  "priorityRegion",
  "owner_region",
  "ownerRegion",
  "account_region",
  "accountRegion",
  "user_region",
  "userRegion",
];

/** Key names that sometimes hold ISO country on TikTok payloads. */
const REGIONISH_KEY_RE =
  /^(region|country|country_?code|store_?region|priority_?region|owner_?region|account_?region|user_?region)$/i;

/**
 * Walk plain objects for the first normalizable trusted country code.
 * @param {...unknown} roots
 * @returns {string|null}
 */
function pickTrustedRegionFromFields(...roots) {
  const queue = roots.filter((value) => value && typeof value === "object");
  const seenObjs = new Set();

  while (queue.length) {
    const obj = queue.shift();
    if (!obj || typeof obj !== "object" || seenObjs.has(obj)) continue;
    seenObjs.add(obj);

    for (const key of TRUSTED_REGION_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
      const normalized = normalizeRegion(obj[key]);
      if (normalized) return normalized;
    }

    // Deep scan: any region-ish key (covers odd TikTok renames).
    for (const [key, value] of Object.entries(obj)) {
      if (REGIONISH_KEY_RE.test(key)) {
        const normalized = normalizeRegion(value);
        if (normalized) return normalized;
      }
      if (value && typeof value === "object" && !Array.isArray(value)) {
        queue.push(value);
      } else if (Array.isArray(value)) {
        for (const item of value.slice(0, 8)) {
          if (item && typeof item === "object") queue.push(item);
        }
      }
    }
  }

  return null;
}

/**
 * Summarize a lookup response for probe logs (no PII dump).
 */
function summarizeLookupResponse(page, payload) {
  const status = page?.status || 0;
  const err = page?.error || null;
  const statusCode =
    payload && typeof payload === "object" ? Number(payload.status_code ?? payload.statusCode ?? NaN) : NaN;
  const keys =
    payload && typeof payload === "object"
      ? Object.keys(payload).slice(0, 12).join(",")
      : "";
  const textLen = page?.text ? String(page.text).length : 0;
  return {
    status,
    err,
    statusCode: Number.isFinite(statusCode) ? statusCode : null,
    keys,
    textLen,
    region: pickTrustedRegionFromFields(payload),
  };
}

function parseUserDetailPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return { region: null, userId: "", rawUser: null };
  }
  const user =
    payload?.userInfo?.user ||
    payload?.data?.userInfo?.user ||
    payload?.data?.user ||
    payload?.user ||
    payload?.data?.userInfo ||
    null;
  const region = pickTrustedRegionFromFields(
    user,
    payload?.userInfo,
    payload?.data,
    payload
  );
  const userId = String(
    user?.id || user?.id_str || user?.uid || payload?.userInfo?.user?.id || ""
  ).trim();
  return {
    region,
    userId: /^\d{5,}$/.test(userId) ? userId : "",
    rawUser: user,
  };
}

/**
 * Build signed-web URLs to try in-page (cookies/referer matter).
 * @param {string} username
 * @param {string} [userId]
 * @returns {string[]}
 */
function buildUserDetailUrls(username, userId = "") {
  const handle = String(username || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
  const uid = String(userId || "").trim();
  const urls = [];

  if (handle) {
    const q = new URLSearchParams({
      aid: "1988",
      app_name: "tiktok_web",
      device_platform: "web_pc",
      uniqueId: handle,
      region: "GB",
      priority_region: "GB",
    });
    urls.push(`https://www.tiktok.com/api/user/detail/?${q}`);
    urls.push(
      `https://www.tiktok.com/api/user/detail/json/?uniqueId=${encodeURIComponent(handle)}&aid=1988`
    );
    urls.push(
      `https://www.tiktok.com/node/share/user/@${encodeURIComponent(handle)}?uniqueId=${encodeURIComponent(handle)}`
    );
  }
  if (/^\d{5,}$/.test(uid)) {
    const q = new URLSearchParams({
      aid: "1988",
      app_name: "tiktok_web",
      device_platform: "web_pc",
      userId: uid,
      region: "GB",
      priority_region: "GB",
    });
    urls.push(`https://www.tiktok.com/api/user/detail/?${q}`);
    urls.push(
      `https://webcast.tiktok.com/webcast/user/?aid=1988&target_uid=${encodeURIComponent(uid)}&region=GB`
    );
  }
  return urls;
}

function profileUrlForUsername(username) {
  const handle = String(username || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
  if (!handle) return "";
  return `https://www.tiktok.com/@${encodeURIComponent(handle)}`;
}

/**
 * @param {string} html
 * @param {string} username
 * @returns {{ region: string|null, userId: string }}
 */
function parseRegionFromProfileHtml(html, username) {
  const parsed = parseProfileFromHtml(html, username);
  // Also deep-scan rehydration JSON chunks if present.
  let region = normalizeRegion(parsed.region) || null;
  if (!region && html && html.includes("__UNIVERSAL_DATA_FOR_REHYDRATION__")) {
    try {
      const m = html.match(
        /<script[^>]+id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/i
      );
      if (m) {
        region = pickTrustedRegionFromFields(JSON.parse(m[1]));
      }
    } catch {
      // ignore
    }
  }
  return {
    region,
    userId: parsed.userId || "",
  };
}

function classifyResolveOutcome(region) {
  if (isGbRegion(region)) return "gb";
  if (isNonGbRegion(region)) return "non_gb";
  return "unknown";
}

module.exports = {
  pickTrustedRegionFromFields,
  isConfirmedGbEvidence,
  parseUserDetailPayload,
  buildUserDetailUrls,
  profileUrlForUsername,
  parseRegionFromProfileHtml,
  classifyResolveOutcome,
  summarizeLookupResponse,
  TRUSTED_REGION_KEYS,
};
