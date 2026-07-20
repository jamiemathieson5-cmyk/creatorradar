const { extractLead, extractLeadsFromPayload } = require("./leadsParse");
const { classifyUsername, shouldDropUsername } = require("./denylist");
const {
  MANUAL_REFRESH_LIMIT,
  MANUAL_REFRESH_TIMEOUT_MS,
  MIN_DIAMONDS_L30,
  MAX_DIAMONDS_L30,
  MAX_DIAMONDS_CURRENT_MONTH,
  resolveTikleapLookupWorkers,
  resolveScrapeMode,
  isTikleapEnabled,
} = require("./constants");
const { fetchTikleapUkLiveLeads } = require("./tikleapLiveFetcher");
const { fetchViaChrome } = require("./browserFetcher");
const {
  launchTikleapChrome,
  createTikleapClient,
  hasLoginProfile,
  cookiesPath,
  profileDir,
} = require("./tikleap");
const { createSharedKeepers } = require("./sharedKeepers");
const store = require("./store");
const { updateRefreshProgress } = require("./refreshProgress");

function normalizeFetchLimit(limit, fallback = MANUAL_REFRESH_LIMIT) {
  const n = Math.floor(Number(limit));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Build exclude set: non-`new` CRM usernames for this-run dedupe.
 * Still-`new` leads stay eligible so re-scrape can refresh diamonds/avatar.
 */
function buildExcludeUsernames() {
  const exclude = new Set();
  try {
    for (const lead of store.listLeads("all") || []) {
      if (!lead || lead.status === "new") continue;
      const key = store.usernameKey(lead.username);
      if (key) exclude.add(key);
    }
  } catch {
    // ignore store read failures — denylist/scraped still apply in path filters
  }
  return [...exclude];
}

function settledValue(result, label) {
  if (result.status === "fulfilled") return result.value;
  const error = result.reason;
  console.warn(
    `[fetcher] ${label} ended with error: ${error?.message || error}`
  );
  return {
    leads: [],
    pages: 0,
    rawSeen: 0,
    tikleapKept: 0,
    tikleapSkipped: 0,
    error: error?.message || String(error),
    errorCode: error?.code || null,
  };
}

/**
 * Deployable path (SCRAPE_MODE=tiktok_feed, default): TikTok Live suggested-feed
 * only via chrome-tiktok-feed-profile. GB/UK feed signals; unknown diamonds kept;
 * no TikLeap (Railway-safe — TikLeap needs headed Chrome + CF cookies).
 */
async function fetchTiktokFeedOnly({
  limit = MANUAL_REFRESH_LIMIT,
  timeoutMs = MANUAL_REFRESH_TIMEOUT_MS,
} = {}) {
  const cap = normalizeFetchLimit(limit);
  const hardTimeoutMs = Math.max(
    120000,
    Math.floor(Number(timeoutMs) || MANUAL_REFRESH_TIMEOUT_MS)
  );

  console.log(
    `[fetcher] SCRAPE_MODE=tiktok_feed — TikTok Live suggested-feed only` +
      ` (cap ${cap}, GB/UK feed signals, unknown L30 kept, no TikLeap)`
  );

  updateRefreshProgress({
    phase: "tiktok_feed",
    limit: cap,
    maxPages: 2500,
    timeoutMs: hardTimeoutMs,
    leads: 0,
    pages: 0,
    rawSeen: 0,
    hasMore: true,
    tikleapKept: 0,
    tikleapSkipped: 0,
  });

  const shared = createSharedKeepers({
    cap,
    excludeUsernames: buildExcludeUsernames(),
    timeoutMs: hardTimeoutMs,
    onClaimed(lead) {
      try {
        const result = store.addLeads([lead], {
          limit: 1,
          ignoreQuota: true,
          live: true,
        });
        if (result.added?.length) {
          updateRefreshProgress({
            persistedLeads: store.getMeta().liveAddedThisRefresh || 0,
          });
        }
      } catch (error) {
        console.warn(
          `[fetcher] live persist failed for @${lead?.username || "?"}:`,
          error?.message || error
        );
      }
    },
  });
  shared.setPhase("tiktok_feed");
  shared.markFeedActive(true);

  let feedResult;
  try {
    feedResult = await fetchViaChrome({
      limit: cap,
      timeoutMs: hardTimeoutMs,
      maxPages: 2500,
      confirmMode: "feed_gb",
      excludeUsernames: buildExcludeUsernames(),
      sharedKeepers: shared,
      separateTikTokChrome: true,
      progressBaseKept: 0,
      progressLimit: cap,
      progressPhase: "tiktok_feed",
    });
  } finally {
    shared.markFeedActive(false);
  }

  const leads = shared.getLeads().slice(0, cap);
  const stats = shared.stats();
  const notice =
    feedResult?.fallbackNotice ||
    `TikTok feed filled ${leads.length}/${cap}` +
      ` (raw ${stats.feedRawSeen || feedResult?.rawSeen || 0}).`;

  console.log(
    `[fetcher] feed-only done: ${leads.length}/${cap}` +
      ` raw=${stats.feedRawSeen || feedResult?.rawSeen || 0}`
  );

  if (!leads.length) {
    const blocked =
      Number(feedResult?.feedHttp403Count) >= 4
        ? ` TikTok returned HTTP 403 on feed pagination ${feedResult.feedHttp403Count}×` +
          ` (datacenter/headless block is likely).`
        : "";
    const err = new Error(
      (feedResult?.error ||
        notice ||
        "No qualifying UK leads from TikTok Live suggested feed.") + blocked
    );
    err.code =
      feedResult?.errorCode ||
      (Number(feedResult?.feedHttp403Count) >= 4
        ? "TIKTOK_FEED_BLOCKED"
        : "TIKTOK_FEED_EMPTY");
    throw err;
  }

  updateRefreshProgress({
    phase: "saving",
    leads: leads.length,
    rawSeen: stats.feedRawSeen || feedResult?.rawSeen || 0,
    hasMore: false,
    tikleapKept: leads.length,
    tikleapSkipped: feedResult?.tikleapSkipped || stats.tikleapSkipped || 0,
    queueSize: 0,
    resolving: 0,
  });

  return {
    leads,
    pages: feedResult?.pages || 1,
    rawSeen: stats.feedRawSeen || feedResult?.rawSeen || 0,
    tikleapKept: leads.length,
    tikleapSkipped: feedResult?.tikleapSkipped || 0,
    confirmMode: "feed_gb",
    fallbackNotice: notice,
    source: "tiktok_live_suggested",
    timedOut: Boolean(feedResult?.timedOut),
    inventoryExhausted: Boolean(feedResult?.inventoryExhausted),
    feedFallbackKept: leads.length,
    feedFallbackRawSeen: feedResult?.rawSeen || stats.feedRawSeen || 0,
    boardKept: 0,
    liveNowKept: 0,
    priorityPipeline: false,
    parallel: false,
    scrapeMode: "tiktok_feed",
  };
}

/**
 * Get leads — mode from SCRAPE_MODE / ENABLE_TIKLEAP:
 * - tiktok_feed (default): suggested-feed only (Railway-deployable)
 * - full (+ ENABLE_TIKLEAP=1): P1 LIVE NOW → P2 TikLeap GB → P3 TikTok feed
 *
 * Shared 200-cap / CRM dedupe. L30 1K–150K when known; unknown L30 kept;
 * prefer current month <200K when TikLeap available. Feed keepers without
 * TikLeap data kept when feed signals GB/UK.
 */
async function fetchSuggestedLeads({
  limit = MANUAL_REFRESH_LIMIT,
  timeoutMs = MANUAL_REFRESH_TIMEOUT_MS,
} = {}) {
  const mode = resolveScrapeMode();
  if (mode === "tiktok_feed" || !isTikleapEnabled()) {
    return fetchTiktokFeedOnly({ limit, timeoutMs });
  }

  const cap = normalizeFetchLimit(limit);
  const hardTimeoutMs = Math.max(
    120000,
    Math.floor(Number(timeoutMs) || MANUAL_REFRESH_TIMEOUT_MS)
  );
  const started = Date.now();

  if (!hasLoginProfile()) {
    const err = new Error(
      `TikLeap Premium login required for full scrape ` +
        `(SCRAPE_MODE=full / ENABLE_TIKLEAP=1). ` +
        `L30 ${MIN_DIAMONDS_L30.toLocaleString()}–${MAX_DIAMONDS_L30.toLocaleString()}, ` +
        `prefer current month <${MAX_DIAMONDS_CURRENT_MONTH.toLocaleString()}. ` +
        `Run ./scripts/tikleap-login.sh, or set SCRAPE_MODE=tiktok_feed for feed-only. ` +
        `(profile ${profileDir()} / cookies ${cookiesPath()})`
    );
    err.code = "TIKLEAP_SESSION_REQUIRED";
    throw err;
  }

  const shared = createSharedKeepers({
    cap,
    excludeUsernames: buildExcludeUsernames(),
    timeoutMs: hardTimeoutMs,
    onClaimed(lead) {
      // Flush each keeper immediately so New updates mid-scrape and survives hangs.
      try {
        const result = store.addLeads([lead], {
          limit: 1,
          ignoreQuota: true,
          live: true,
        });
        if (result.added?.length) {
          updateRefreshProgress({
            persistedLeads: store.getMeta().liveAddedThisRefresh || 0,
          });
        }
      } catch (error) {
        console.warn(
          `[fetcher] live persist failed for @${lead?.username || "?"}:`,
          error?.message || error
        );
      }
    },
  });

  // 1 list tab (board HTML) + N lookup tabs. TikTok Live opens later as
  // another tab on this same browser when P1+P2 leave slots.
  const LOOKUP_WORKERS = resolveTikleapLookupWorkers();
  const launch = await launchTikleapChrome({ workers: LOOKUP_WORKERS + 1 });
  const listSessionId = launch.sessionIds?.[0] || launch.sessionId;
  const lookupSessionIds =
    (launch.sessionIds || []).length > 1
      ? launch.sessionIds.slice(1)
      : launch.sessionIds || [launch.sessionId];

  console.log(
    `[fetcher] Single Chrome: requested=${LOOKUP_WORKERS + 1}` +
      ` launched=${launch.workers || lookupSessionIds.length + 1}` +
      ` lookupTabs=${lookupSessionIds.length}` +
      ` minimized=${Boolean(launch.minimized)}` +
      ` headless=${launch.headless !== false}` +
      ` profile=chrome-tikleap-profile`
  );

  const tikleapClient = createTikleapClient(
    launch.browserSession,
    lookupSessionIds,
    { maxSettleMs: 2200 }
  );
  const ready = await tikleapClient.ensureReady();
  if (!ready.ok) {
    try {
      // Soft disconnect only — leave scrape Chrome for the next attempt.
      launch.cleanup();
    } catch {
      // ignore
    }
    const err = new Error(ready.reason || "TikLeap login required.");
    err.code = "TIKLEAP_SESSION_REQUIRED";
    throw err;
  }

  console.log(
    `[fetcher] Priority pipeline: P1 LIVE NOW → P2 TikLeap other GB → P3 TikTok feed ` +
      `(shared cap ${cap}, L30 ${MIN_DIAMONDS_L30.toLocaleString()}–${MAX_DIAMONDS_L30.toLocaleString()} when known ` +
      `(unknown kept), prefer current month <${MAX_DIAMONDS_CURRENT_MONTH.toLocaleString()}, ` +
      `${lookupSessionIds.length} TikLeap lookup tabs, one minimized Chrome)…`
  );

  updateRefreshProgress({
    phase: "live_now",
    limit: cap,
    maxPages: 2500,
    timeoutMs: hardTimeoutMs,
    leads: 0,
    pages: 0,
    rawSeen: 0,
    hasMore: true,
    tikleapKept: 0,
    tikleapSkipped: 0,
  });
  shared.setPhase("live_now");
  shared.markBoardActive(true);

  let boardResult = {
    leads: [],
    pages: 0,
    rawSeen: 0,
    tikleapKept: 0,
    tikleapSkipped: 0,
  };
  let feedResult = {
    leads: [],
    pages: 0,
    rawSeen: 0,
    tikleapKept: 0,
    tikleapSkipped: 0,
  };

  try {
    // P1 + P2 on TikLeap boards (LIVE NOW first, then other GB).
    boardResult = await fetchTikleapUkLiveLeads({
      limit: cap,
      timeoutMs: hardTimeoutMs,
      tikleapWorkers: lookupSessionIds.length,
      sharedKeepers: shared,
      tikleapClient,
      browserSession: launch.browserSession,
      listSessionId,
      sessionIds: lookupSessionIds,
      ownCleanup: false,
    }).then(
      (value) => value,
      (error) =>
        settledValue({ status: "rejected", reason: error }, "TikLeap boards")
    );
    shared.markBoardActive(false);

    // P3 — TikTok Live suggested feed in a tab of the same Chrome, only if
    // slots remain after TikLeap inventory / filters.
    if (!shared.isFull() && Date.now() - started < hardTimeoutMs) {
      const remainingBudget = Math.max(
        60000,
        hardTimeoutMs - (Date.now() - started)
      );
      console.log(
        `[fetcher] P1+P2 kept ${shared.getKeptCount()}/${cap}` +
          ` — starting P3 TikTok feed on same browser (${Math.round(
            remainingBudget / 60000
          )}m budget)…`
      );
      shared.setPhase("tiktok_feed");
      shared.markFeedActive(true);
      feedResult = await fetchViaChrome({
        limit: cap,
        timeoutMs: remainingBudget,
        maxPages: 2500,
        tikleapWorkers: lookupSessionIds.length,
        confirmMode: "strict_tikleap_gb",
        excludeUsernames: buildExcludeUsernames(),
        sharedKeepers: shared,
        tikleapClient,
        tikleapOwnedExternally: true,
        browserSession: launch.browserSession,
        separateTikTokChrome: false,
        progressBaseKept: shared.getKeptCount(),
        progressLimit: cap,
        progressPhase: "tiktok_feed",
      }).then(
        (value) => value,
        (error) =>
          settledValue({ status: "rejected", reason: error }, "TikTok feed")
      );
      shared.markFeedActive(false);
    } else if (shared.isFull()) {
      console.log(
        `[fetcher] Cap ${cap} filled from TikLeap P1/P2 — skipping TikTok feed`
      );
    }
  } finally {
    try {
      launch.cleanup();
    } catch {
      // ignore
    }
  }

  const leads = shared.getLeads().slice(0, cap);
  const boardKept = (boardResult.leads || []).length;
  const feedKept = (feedResult.leads || []).length;
  const stats = shared.stats();
  const liveNowKept = leads.filter((l) => l.liveNow).length;
  const noticeParts = [];
  if (boardResult.fallbackNotice) noticeParts.push(boardResult.fallbackNotice);
  if (feedResult.fallbackNotice) noticeParts.push(feedResult.fallbackNotice);
  if (boardResult.error && !boardKept) {
    noticeParts.push(`TikLeap boards: ${boardResult.error}`);
  }
  if (feedResult.error && !feedKept) {
    noticeParts.push(`TikTok feed: ${feedResult.error}`);
  }
  noticeParts.push(
    `Priority pipeline filled ${leads.length}/${cap}` +
      ` (~${boardKept} TikLeap, ~${feedKept} feed;` +
      ` ~${liveNowKept} LIVE NOW tagged;` +
      ` raw board ${stats.boardRawSeen}+feed ${stats.feedRawSeen}).`
  );

  console.log(
    `[fetcher] done: ${leads.length}/${cap}` +
      ` (tikleap≈${boardKept}, feed≈${feedKept}, liveNow≈${liveNowKept},` +
      ` raw=${stats.boardRawSeen + stats.feedRawSeen},` +
      ` elapsed=${Date.now() - started}ms)`
  );

  if (!leads.length) {
    const err = new Error(
      noticeParts.filter(Boolean).join(" ") ||
        "No qualifying UK leads from TikLeap boards or TikTok suggested feed."
    );
    err.code =
      boardResult.errorCode ||
      feedResult.errorCode ||
      "TIKLEAP_LIVE_EMPTY";
    throw err;
  }

  updateRefreshProgress({
    phase: "saving",
    leads: leads.length,
    rawSeen: stats.boardRawSeen + stats.feedRawSeen,
    hasMore: false,
    tikleapKept: leads.length,
    tikleapSkipped: stats.tikleapSkipped,
    queueSize: 0,
    resolving: 0,
  });

  const bothContributed = boardKept > 0 && feedKept > 0;
  return {
    leads,
    pages: Math.max(boardResult.pages || 1, feedResult.pages || 1),
    rawSeen: stats.boardRawSeen + stats.feedRawSeen,
    tikleapKept: leads.length,
    tikleapSkipped:
      (boardResult.tikleapSkipped || 0) + (feedResult.tikleapSkipped || 0),
    confirmMode: bothContributed
      ? "tikleap_then_tiktok_feed"
      : feedKept && !boardKept
        ? "strict_tikleap_gb"
        : "tikleap_uk_live",
    fallbackNotice: noticeParts.filter(Boolean).join(" ") || null,
    source: bothContributed
      ? "tikleap_uk_live+tiktok_live_suggested"
      : feedKept && !boardKept
        ? "tiktok_live_suggested"
        : "tikleap_uk_live",
    timedOut: Boolean(boardResult.timedOut || feedResult.timedOut),
    inventoryExhausted: Boolean(
      boardResult.inventoryExhausted && (feedResult.inventoryExhausted ?? true)
    ),
    feedFallbackKept: feedKept,
    feedFallbackRawSeen: feedResult.rawSeen || stats.feedRawSeen || 0,
    boardKept,
    liveNowKept,
    priorityPipeline: true,
    parallel: false,
  };
}

function importFeedPayload(payload, { limit = 100 } = {}) {
  const parsed = extractLeadsFromPayload(payload);
  return {
    leads: parsed.leads.slice(0, limit),
    pages: 1,
    rawSeen: parsed.rawSeen,
    source: "imported_feed_json",
  };
}

function buildSeedLeads(count) {
  const leads = [];
  for (let i = 1; i <= count; i += 1) {
    const n = String(i).padStart(2, "0");
    leads.push({
      username: `uklivecreator${n}`,
      displayName: `UK Live Creator ${n}`,
      avatarUrl: "",
      profileUrl: `https://www.tiktok.com/@uklivecreator${n}`,
      region: "GB",
      regionSource: "tikleap_country",
      followerCount: 1000,
      diamondsL30: MIN_DIAMONDS_L30,
      diamondsL28: MIN_DIAMONDS_L30,
    });
  }
  return leads;
}

const SEED_LEADS = buildSeedLeads(5);
const DEMO_SEED_LEADS = buildSeedLeads(35);

module.exports = {
  fetchSuggestedLeads,
  importFeedPayload,
  extractLead,
  classifyUsername,
  shouldDropUsername,
  SEED_LEADS,
  DEMO_SEED_LEADS,
};
