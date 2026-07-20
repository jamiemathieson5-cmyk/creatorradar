const { MAX_DAYS_SINCE_LAST_VIDEO } = require("./constants");

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Normalize TikTok createTime (seconds or ms) to unix seconds.
 * @returns {number|null}
 */
function normalizeCreateTimeSec(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  // ms timestamps are ~1e12+; seconds are ~1e9.
  return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
}

/**
 * @param {number|null|undefined} createTimeSec
 * @param {number} [maxDays]
 */
function isWithinLastDays(createTimeSec, maxDays = MAX_DAYS_SINCE_LAST_VIDEO) {
  const sec = normalizeCreateTimeSec(createTimeSec);
  if (sec == null) return false;
  const ageMs = Date.now() - sec * 1000;
  if (ageMs < 0) return true; // clock skew — treat as recent
  return ageMs <= maxDays * DAY_MS;
}

/**
 * Newest createTime (unix seconds) from a post/item_list JSON body.
 * @returns {number|null}
 */
function newestCreateTimeFromItemListText(text) {
  if (!text || typeof text !== "string" || text.length < 20) return null;
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  const times = [];
  const items = json?.itemList || json?.items || json?.data?.itemList;
  if (Array.isArray(items)) {
    for (const item of items) {
      const sec = normalizeCreateTimeSec(item?.createTime ?? item?.create_time);
      if (sec != null) times.push(sec);
    }
  }

  if (!times.length) {
    for (const match of text.matchAll(/"createTime"\s*:\s*(\d{9,13})/g)) {
      const sec = normalizeCreateTimeSec(match[1]);
      if (sec != null) times.push(sec);
    }
  }

  if (!times.length) return null;
  return Math.max(...times);
}

/**
 * True when newest video createTime is within maxDays.
 * False when missing / too old.
 */
function hasRecentVideo(createTimeSec, maxDays = MAX_DAYS_SINCE_LAST_VIDEO) {
  return isWithinLastDays(createTimeSec, maxDays);
}

module.exports = {
  MAX_DAYS_SINCE_LAST_VIDEO,
  normalizeCreateTimeSec,
  isWithinLastDays,
  newestCreateTimeFromItemListText,
  hasRecentVideo,
};
