/**
 * Shared this-run keepers + username claim set for the ordered Get-leads
 * pipeline (TikLeap LIVE NOW → other TikLeap GB → TikTok suggested-feed).
 * Single 200-cap, CRM/denylist dedupe across phases.
 */

const { updateRefreshProgress } = require("./refreshProgress");
const { MANUAL_REFRESH_LIMIT } = require("./constants");

function usernameKey(username) {
  return String(username || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

/**
 * @param {{
 *   cap?: number,
 *   excludeUsernames?: Iterable<string>,
 *   timeoutMs?: number,
 *   onClaimed?: (lead: object) => void,
 * }} [options]
 */
function createSharedKeepers({
  cap = MANUAL_REFRESH_LIMIT,
  excludeUsernames = [],
  timeoutMs = 0,
  onClaimed = null,
} = {}) {
  const limit = Math.max(1, Math.floor(Number(cap)) || MANUAL_REFRESH_LIMIT);
  /** @type {object[]} */
  const kept = [];
  /** Claimed usernames: CRM excludes + this-run keepers (+ in-flight). */
  const claimed = new Set();
  /** Lookups currently running so phases do not double-fetch the same handle. */
  const inFlight = new Set();
  const claimHook = typeof onClaimed === "function" ? onClaimed : null;

  for (const name of excludeUsernames || []) {
    const key = usernameKey(name);
    if (key) claimed.add(key);
  }

  let boardRawSeen = 0;
  let feedRawSeen = 0;
  let boardPages = 0;
  let feedPages = 0;
  let tikleapSkipped = 0;
  let queueSize = 0;
  let resolving = 0;
  /** @type {"starting"|"live_now"|"tikleap_other"|"tiktok_feed"|"saving"} */
  let scrapePhase = "starting";
  let boardActive = false;
  let feedActive = false;
  let boardDone = false;
  let feedDone = false;

  function isFull() {
    return kept.length >= limit;
  }

  function getKeptCount() {
    return kept.length;
  }

  function getLeads() {
    return kept.slice(0, limit);
  }

  function isClaimed(username) {
    const key = usernameKey(username);
    return Boolean(key && claimed.has(key));
  }

  function shouldSkip(username) {
    const key = usernameKey(username);
    if (!key) return true;
    if (isFull()) return true;
    if (claimed.has(key)) return true;
    if (inFlight.has(key)) return true;
    return false;
  }

  /** Reserve exclusive lookup rights; returns false if another path owns it. */
  function beginLookup(username) {
    const key = usernameKey(username);
    if (!key || isFull() || claimed.has(key) || inFlight.has(key)) return false;
    inFlight.add(key);
    return true;
  }

  function endLookup(username) {
    const key = usernameKey(username);
    if (key) inFlight.delete(key);
  }

  /**
   * Atomically claim a keeper slot. Safe across concurrent board/feed paths
   * (single-threaded event loop: check+add is not interleaved).
   */
  function tryClaim(username, lead) {
    const key = usernameKey(username);
    if (!key) return false;
    inFlight.delete(key);
    if (isFull() || claimed.has(key)) return false;
    claimed.add(key);
    kept.push(lead);
    publish();
    if (claimHook) {
      try {
        claimHook(lead);
      } catch (error) {
        console.warn(
          `[sharedKeepers] onClaimed failed for @${key}:`,
          error?.message || error
        );
      }
    }
    return true;
  }

  /** Mark username taken without keeping (e.g. durable reject shared by both). */
  function noteRejected(username) {
    const key = usernameKey(username);
    if (!key) return;
    inFlight.delete(key);
    claimed.add(key);
  }

  function phaseLabel() {
    if (scrapePhase && scrapePhase !== "starting") return scrapePhase;
    if (boardActive && scrapePhase === "live_now") return "live_now";
    if (boardActive) return "tikleap_other";
    if (feedActive) return "tiktok_feed";
    if (!boardDone || !feedDone) return scrapePhase || "starting";
    return "saving";
  }

  function setPhase(phase) {
    if (phase) scrapePhase = String(phase);
    publish();
  }

  function publish(extra = {}) {
    updateRefreshProgress({
      phase: extra.phase || phaseLabel(),
      limit,
      timeoutMs: timeoutMs || undefined,
      leads: kept.length,
      pages: Math.max(boardPages, feedPages, 1),
      rawSeen: boardRawSeen + feedRawSeen,
      hasMore: !isFull() && (boardActive || feedActive),
      tikleapKept: kept.length,
      tikleapSkipped,
      queueSize,
      resolving,
      ...extra,
    });
  }

  function setBoardStats(patch = {}) {
    if (patch.rawSeen != null) boardRawSeen = Math.max(0, Math.floor(patch.rawSeen));
    if (patch.pages != null) boardPages = Math.max(0, Math.floor(patch.pages));
    if (patch.tikleapSkipped != null) {
      tikleapSkipped = Math.max(tikleapSkipped, Math.floor(patch.tikleapSkipped));
    }
    if (patch.queueSize != null) queueSize = Math.max(0, Math.floor(patch.queueSize));
    if (patch.resolving != null) resolving = Math.max(0, Math.floor(patch.resolving));
    if (patch.phase) scrapePhase = String(patch.phase);
    publish(patch.phase ? { phase: patch.phase } : {});
  }

  function setFeedStats(patch = {}) {
    if (patch.rawSeen != null) feedRawSeen = Math.max(0, Math.floor(patch.rawSeen));
    if (patch.pages != null) feedPages = Math.max(0, Math.floor(patch.pages));
    if (patch.tikleapSkipped != null) {
      tikleapSkipped = Math.max(tikleapSkipped, Math.floor(patch.tikleapSkipped));
    }
    if (patch.queueSize != null) queueSize = Math.max(0, Math.floor(patch.queueSize));
    if (patch.resolving != null) resolving = Math.max(0, Math.floor(patch.resolving));
    if (patch.phase) scrapePhase = String(patch.phase);
    publish(patch.phase ? { phase: patch.phase } : {});
  }

  function addSkipped(n = 1) {
    tikleapSkipped += Math.max(0, Math.floor(Number(n)) || 0);
  }

  function markBoardActive(active) {
    boardActive = Boolean(active);
    if (!active) boardDone = true;
    if (active && scrapePhase === "starting") scrapePhase = "live_now";
    publish();
  }

  function markFeedActive(active) {
    feedActive = Boolean(active);
    if (active) scrapePhase = "tiktok_feed";
    if (!active) feedDone = true;
    publish();
  }

  return {
    limit,
    isFull,
    getKeptCount,
    getLeads,
    isClaimed,
    shouldSkip,
    beginLookup,
    endLookup,
    tryClaim,
    noteRejected,
    publish,
    setPhase,
    setBoardStats,
    setFeedStats,
    addSkipped,
    markBoardActive,
    markFeedActive,
    stats: () => ({
      kept: kept.length,
      limit,
      boardRawSeen,
      feedRawSeen,
      boardPages,
      feedPages,
      tikleapSkipped,
      scrapePhase,
      boardActive,
      feedActive,
      boardDone,
      feedDone,
      claimed: claimed.size,
      inFlight: inFlight.size,
    }),
  };
}

module.exports = {
  createSharedKeepers,
  usernameKey,
};
