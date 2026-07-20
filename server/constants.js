const STATUSES = [
  "new",
  "contacted",
  "in_network",
  "ineligible",
  "unsupported_region",
  "premium_invite_required",
  "not_interested",
  "declined",
  "dms_off",
  "applied",
  "approved_joined",
  "inactive_lost",
];

const STATUS_LABELS = {
  new: "New",
  contacted: "Contacted",
  in_network: "In a network",
  ineligible: "Ineligible",
  unsupported_region: "Unsupported region",
  premium_invite_required: "Premium invite required",
  not_interested: "Not interested",
  declined: "Declined",
  dms_off: "DMs off - could not contact",
  applied: "Applied",
  approved_joined: "Approved / joined",
  inactive_lost: "Inactive / lost",
};

const DAILY_NEW_CAP = 100;
const MANUAL_REFRESH_LIMIT = 200;
/**
 * Force Get leads may need to page ~2k UK 14d candidates through profile
 * lookups (+ optional monthly history). Soft-stop only after this budget.
 */
const MANUAL_REFRESH_TIMEOUT_MS = 60 * 60 * 1000;
/** Minimum TikTok followers required for non-TikLeap ingest paths. */
const MIN_FOLLOWER_COUNT = 1000;
/** Only ingest creators whose latest public video is this many days old or newer. */
const MAX_DAYS_SINCE_LAST_VIDEO = 7;
/**
 * London calendar days of TikLeap hourly boards (inclusive of today).
 * Also used for the rolling country period board (period=N).
 */
const LIVE_LOOKBACK_DAYS = 14;
/**
 * TikLeap last-30-day diamonds: inclusive band when L30 is known.
 * Unknown/masked/unparsed L30 still keeps the lead (UK gate still applies).
 */
const MIN_DIAMONDS_L30 = 1000;
const MAX_DIAMONDS_L30 = 150000;
/**
 * Known L30 below this → CRM status inactive_lost (Inactive / lost).
 * Does not apply when L30 is unknown/missing. Band 500–999 still follows
 * the New keep floor (skip for New); only <500 auto-marks inactive.
 */
const INACTIVE_DIAMONDS_L30 = 500;
/**
 * Prefer-exclude when the *current* calendar month already has ≥ this many
 * diamonds (light history parse). Missing current-month data does not exclude.
 * Past months are not gated.
 */
const MAX_DIAMONDS_CURRENT_MONTH = 200000;
/** @deprecated Use MAX_DIAMONDS_CURRENT_MONTH (current-month gate, not any-month). */
const MAX_DIAMONDS_ANY_MONTH = MAX_DIAMONDS_CURRENT_MONTH;
/** @deprecated Use MIN_DIAMONDS_L30 */
const MIN_DIAMONDS_L28 = MIN_DIAMONDS_L30;
/** @deprecated Prefer band removed — floor is MIN_DIAMONDS_L30. */
const PREFER_DIAMONDS_L28 = MIN_DIAMONDS_L30;
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const PORT = Number(process.env.PORT) || 8787;
const UK_REGION_CODES = new Set(["GB", "UK", "GBR"]);

/**
 * Scrape strategy:
 * - `tiktok_feed` (default, Railway-safe): TikTok Live suggested-feed only,
 *   GB/UK feed signals, unknown diamonds kept; no TikLeap.
 * - `full`: TikLeap boards + feed (local/dev). Requires ENABLE_TIKLEAP=1
 *   (or SCRAPE_MODE=full) plus headed Chrome + TikLeap Premium cookies.
 *
 * TikLeap needs headed Chrome + cookies/Cloudflare — typically unreliable on
 * Railway (no display, ephemeral FS unless volume, CF blocks headless).
 */
function resolveScrapeMode() {
  const raw = String(process.env.SCRAPE_MODE || "")
    .trim()
    .toLowerCase();
  const enableTikleap =
    process.env.ENABLE_TIKLEAP === "1" ||
    process.env.ENABLE_TIKLEAP === "true";
  if (raw === "full" || raw === "tikleap" || raw === "priority") {
    return "full";
  }
  if (raw === "tiktok_feed" || raw === "feed") {
    return "tiktok_feed";
  }
  // Default: feed-only unless explicitly enabling TikLeap locally.
  return enableTikleap ? "full" : "tiktok_feed";
}

function isTikleapEnabled() {
  return resolveScrapeMode() === "full";
}
/**
 * Parallel TikLeap profile-lookup tabs (plus 1 dedicated list/board tab).
 * Override with LEAD_FINDER_TIKLEAP_WORKERS=N (lookup tabs only).
 */
const DEFAULT_TIKLEAP_LOOKUP_WORKERS = 26;
/** Hard cap on total TikLeap Chrome tabs (1 list + lookups). */
const MAX_TIKLEAP_CHROME_TABS = 32;

/**
 * Resolve lookup-worker count from env or fallback.
 * Clamped so 1 list tab still fits under MAX_TIKLEAP_CHROME_TABS.
 */
function resolveTikleapLookupWorkers(fallback = DEFAULT_TIKLEAP_LOOKUP_WORKERS) {
  const raw = Number(process.env.LEAD_FINDER_TIKLEAP_WORKERS);
  const n = Number.isFinite(raw) && raw > 0 ? raw : fallback;
  const maxLookup = Math.max(1, MAX_TIKLEAP_CHROME_TABS - 1);
  return Math.max(1, Math.min(maxLookup, Math.floor(n)));
}

module.exports = {
  STATUSES,
  STATUS_LABELS,
  DAILY_NEW_CAP,
  MANUAL_REFRESH_LIMIT,
  MANUAL_REFRESH_TIMEOUT_MS,
  MIN_FOLLOWER_COUNT,
  MAX_DAYS_SINCE_LAST_VIDEO,
  LIVE_LOOKBACK_DAYS,
  MIN_DIAMONDS_L30,
  MAX_DIAMONDS_L30,
  INACTIVE_DIAMONDS_L30,
  MAX_DIAMONDS_CURRENT_MONTH,
  MAX_DIAMONDS_ANY_MONTH,
  MIN_DIAMONDS_L28,
  PREFER_DIAMONDS_L28,
  REFRESH_INTERVAL_MS,
  PORT,
  UK_REGION_CODES,
  DEFAULT_TIKLEAP_LOOKUP_WORKERS,
  MAX_TIKLEAP_CHROME_TABS,
  resolveTikleapLookupWorkers,
  resolveScrapeMode,
  isTikleapEnabled,
};
