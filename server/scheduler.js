const store = require("./store");
const { fetchSuggestedLeads } = require("./fetcher");
const {
  DAILY_NEW_CAP,
  MANUAL_REFRESH_LIMIT,
  MANUAL_REFRESH_TIMEOUT_MS,
} = require("./constants");
const {
  beginRefreshProgress,
  updateRefreshProgress,
  endRefreshProgress,
  getRefreshProgress,
} = require("./refreshProgress");
const { releaseProfileLock, profileDir } = require("./tikleap");

const HOUR_MS = 60 * 60 * 1000;
/** Force-clear refresh lock if Chrome launch never advances past starting. */
const STARTING_FORCE_CLEAR_MS = 2 * 60 * 1000;

let running = false;
let timer = null;
let hangWatchdog = null;
let refreshEpoch = 0;

function clearHangWatchdog() {
  if (hangWatchdog) {
    clearInterval(hangWatchdog);
    hangWatchdog = null;
  }
}

function armHangWatchdog(epoch) {
  clearHangWatchdog();
  hangWatchdog = setInterval(() => {
    if (epoch !== refreshEpoch || !running) {
      clearHangWatchdog();
      return;
    }
    const progress = getRefreshProgress();
    const startingHung =
      progress.running &&
      (progress.phase === "starting" ||
        progress.stuckReason === "chrome_launch_hang") &&
      (progress.elapsedMs || 0) >= STARTING_FORCE_CLEAR_MS;
    if (!startingHung) return;

    console.warn(
      `[scheduler] force-clearing hung refresh (phase=${progress.phase},` +
        ` elapsed=${Math.round((progress.elapsedMs || 0) / 1000)}s)`
    );
    try {
      releaseProfileLock(profileDir());
    } catch {
      // ignore
    }
    refreshEpoch += 1; // invalidate the hung run's finally
    running = false;
    endRefreshProgress();
    clearHangWatchdog();
  }, 5000);
  if (typeof hangWatchdog.unref === "function") hangWatchdog.unref();
}

async function runRefresh({ force = false } = {}) {
  if (running) {
    const progress = getRefreshProgress();
    // Allow retry when a prior Get leads is wedged on Starting / stuck launch.
    const wedged =
      progress.stuck ||
      progress.phase === "stuck" ||
      (progress.phase === "starting" &&
        (progress.elapsedMs || 0) >= STARTING_FORCE_CLEAR_MS);
    if (!wedged) {
      return { ok: false, skipped: true, reason: "Refresh already in progress." };
    }
    console.warn(
      "[scheduler] clearing wedged refresh lock so Get leads can retry"
    );
    try {
      releaseProfileLock(profileDir());
    } catch {
      // ignore
    }
    refreshEpoch += 1; // invalidate the hung run's finally
    running = false;
    endRefreshProgress();
  }

  running = true;
  const epoch = ++refreshEpoch;
  armHangWatchdog(epoch);
  let storeFinalized = false;
  try {
    const meta = store.getMeta();

    // Manual / force refresh: hard-cap at MANUAL_REFRESH_LIMIT total inserts
    // — ignore 24h window and daily quota, but never add more than the cap.
    // Fetcher runs TikLeap boards + TikTok feed in parallel until 200 keepers
    // or both paths exhaust / time out.
    if (force) {
      store.resetLiveRefreshMeta();
      // Stamp attempt immediately so admin "Last refresh" is never stuck on never.
      store.markRefreshAttempt();
      beginRefreshProgress({
        limit: MANUAL_REFRESH_LIMIT,
        maxPages: 1,
        timeoutMs: MANUAL_REFRESH_TIMEOUT_MS,
        force: true,
      });
      const result = await fetchSuggestedLeads({
        limit: MANUAL_REFRESH_LIMIT,
        timeoutMs: MANUAL_REFRESH_TIMEOUT_MS,
      });
      updateRefreshProgress({
        phase: "saving",
        leads: Math.min(result.leads.length, MANUAL_REFRESH_LIMIT),
        pages: result.pages || 0,
        rawSeen: result.rawSeen || 0,
        hasMore: false,
      });
      const cappedLeads = result.leads.slice(0, MANUAL_REFRESH_LIMIT);
      const addedResult = store.addLeads(cappedLeads, {
        limit: MANUAL_REFRESH_LIMIT,
        ignoreQuota: true,
      });
      storeFinalized = true;

      const forceMeta = store.getMeta();
      const forceAdded =
        Number(forceMeta.lastFetchAdded) || addedResult.added.length;
      console.log(
        `[scheduler] force refresh ok via ${result.source}: added ${forceAdded} new` +
          (addedResult.denylistTagged
            ? `, denylist-tagged ${addedResult.denylistTagged}`
            : "") +
          (addedResult.regionTagged
            ? `, region-tagged ${addedResult.regionTagged}`
            : "") +
          (result.tikleapSkipped
            ? `, tikleap-skipped ${result.tikleapSkipped}`
            : "") +
          ` (kept ${result.tikleapKept || 0}/${MANUAL_REFRESH_LIMIT},` +
          ` seen ${result.rawSeen})` +
          (result.confirmMode ? ` mode=${result.confirmMode}` : "") +
          (result.fallbackNotice ? ` notice="${result.fallbackNotice}"` : "")
      );

      return {
        ok: true,
        skipped: false,
        added: forceAdded,
        seen: result.rawSeen,
        pages: result.pages,
        source: result.source,
        regionTagged: addedResult.regionTagged,
        denylistTagged: addedResult.denylistTagged,
        tikleapKept: result.tikleapKept || 0,
        tikleapSkipped: result.tikleapSkipped || 0,
        confirmMode: result.confirmMode || null,
        notice: result.fallbackNotice || null,
        timedOut: Boolean(result.timedOut),
        inventoryExhausted: Boolean(result.inventoryExhausted),
        feedFallbackKept: result.feedFallbackKept || 0,
        meta: forceMeta,
      };
    }

    if (!meta.refreshDue) {
      return {
        ok: true,
        skipped: true,
        reason: "Refresh not due yet (24h window).",
        meta: store.getMeta(),
      };
    }

    const quota = store.remainingQuota();
    if (quota <= 0) {
      store.markRefreshAttempt();
      return {
        ok: true,
        skipped: true,
        reason: "Daily quota already filled for this 24h cycle.",
        meta: store.getMeta(),
      };
    }

    const autoLimit = Math.min(DAILY_NEW_CAP, quota);
    store.resetLiveRefreshMeta();
    beginRefreshProgress({
      limit: autoLimit,
      maxPages: 1,
      timeoutMs: MANUAL_REFRESH_TIMEOUT_MS,
      force: false,
    });
    const result = await fetchSuggestedLeads({
      limit: autoLimit,
      timeoutMs: MANUAL_REFRESH_TIMEOUT_MS,
    });
    updateRefreshProgress({
      phase: "saving",
      leads: Math.min(result.leads.length, autoLimit),
      pages: result.pages || 0,
      rawSeen: result.rawSeen || 0,
      hasMore: false,
    });
    const addedResult = store.addLeads(result.leads);
    storeFinalized = true;

    const autoMeta = store.getMeta();
    const autoAdded =
      Number(autoMeta.lastFetchAdded) || addedResult.added.length;
    console.log(
      `[scheduler] refresh ok via ${result.source}: added ${autoAdded} new` +
        (addedResult.denylistTagged
          ? `, denylist-tagged ${addedResult.denylistTagged}`
          : "") +
        (addedResult.regionTagged
          ? `, region-tagged ${addedResult.regionTagged}`
          : "") +
        ` (seen ${result.rawSeen})`
    );

    return {
      ok: true,
      skipped: false,
      added: autoAdded,
      seen: result.rawSeen,
      pages: result.pages,
      source: result.source,
      regionTagged: addedResult.regionTagged,
      denylistTagged: addedResult.denylistTagged,
      meta: autoMeta,
    };
  } catch (error) {
    const message = error?.message || "Unknown fetch error";
    const code = error?.code || null;
    store.recordRefreshError(message);
    store.finalizeLiveRefreshMeta({ error: message });
    storeFinalized = true;
    console.error(
      `[scheduler] refresh error${code ? ` (${code})` : ""}: ${message}`
    );

    // Only seed demo leads when explicitly requested — never auto-seed
    // into the live store on fetch failure.
    if (
      process.env.LEAD_FINDER_SEED === "1" &&
      store.getMeta().totalLeads === 0
    ) {
      const { SEED_LEADS } = require("./fetcher");
      if (store.seedIfEmpty(SEED_LEADS)) {
        console.warn(
          "[scheduler] seeded demo leads after fetch failure (LEAD_FINDER_SEED=1)"
        );
      }
    }

    return {
      ok: false,
      skipped: false,
      error: message,
      errorCode: code,
      meta: store.getMeta(),
    };
  } finally {
    if (!storeFinalized) {
      try {
        store.finalizeLiveRefreshMeta();
      } catch {
        // ignore
      }
    }
    if (epoch === refreshEpoch) {
      clearHangWatchdog();
      running = false;
      endRefreshProgress();
    }
  }
}

function startScheduler() {
  if (timer) clearInterval(timer);

  timer = setInterval(() => {
    runRefresh({ force: false }).catch((err) => {
      console.error("[scheduler] refresh failed:", err.message);
    });
  }, HOUR_MS);

  if (typeof timer.unref === "function") timer.unref();

  // On Railway, wait for the public edge to attach to PORT before launching
  // Chromium (avoids a 502 window right after deploy).
  const startupDelayMs = process.env.RAILWAY_ENVIRONMENT
    ? Number(process.env.LEAD_FINDER_STARTUP_DELAY_MS) || 8000
    : 1500;

  setTimeout(() => {
    runRefresh({ force: false }).then((result) => {
      if (result.skipped) {
        console.log(`[scheduler] startup: ${result.reason}`);
      } else if (result.ok) {
        console.log(`[scheduler] startup: added ${result.added} leads`);
      } else {
        console.warn(`[scheduler] startup fetch error: ${result.error}`);
      }
    });
  }, startupDelayMs);
}

function isRefreshRunning() {
  return running;
}

module.exports = {
  runRefresh,
  startScheduler,
  isRefreshRunning,
  getRefreshProgress,
};
