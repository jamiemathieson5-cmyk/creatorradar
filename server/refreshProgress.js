/**
 * Live Get-leads progress + ETA for the UI.
 * Updated by browserFetcher during pagination/resolve; read via /api/meta.
 */

const { MANUAL_REFRESH_LIMIT } = require("./constants");

/** @type {null | Record<string, any>} */
let state = null;

/** Prior duration when we have little signal yet (fast UK-first path). */
const COLD_PRIOR_MS = 90000;
/**
 * No keeper progress + idle queue for this long → mark stuck so the UI
 * stops pretending a long countdown equals productive work.
 */
const STUCK_IDLE_MS = 3 * 60 * 1000;
/** Need some paging signal before declaring idle-stuck (avoid cold start). */
const STUCK_MIN_PAGES = 30;
/**
 * Chrome launch / CDP connect hang: UI stays on "Starting…" until this elapses,
 * then we mark stuck so the button is not permanently wedged.
 */
const STARTING_STUCK_MS = 90 * 1000;

function beginRefreshProgress({
  limit = MANUAL_REFRESH_LIMIT,
  maxPages = 400,
  timeoutMs = 360000,
  force = false,
} = {}) {
  const now = Date.now();
  state = {
    running: true,
    phase: "starting",
    startedAt: now,
    updatedAt: now,
    limit: Math.max(1, Math.floor(Number(limit)) || MANUAL_REFRESH_LIMIT),
    maxPages: Math.max(1, Math.floor(Number(maxPages)) || 400),
    timeoutMs: Math.max(10000, Math.floor(Number(timeoutMs)) || 360000),
    leads: 0,
    pages: 0,
    rawSeen: 0,
    hasMore: true,
    force: Boolean(force),
    lookups: 0,
    countryHits: 0,
    gbHits: 0,
    tikleapKept: 0,
    tikleapSkipped: 0,
    queueSize: 0,
    resolving: 0,
    persistedLeads: 0,
    stuck: false,
    stuckReason: null,
    lastLeadAt: now,
    lastWorkAt: now,
    samples: [{ t: now, leads: 0, pages: 0 }],
  };
  return getRefreshProgress();
}

function updateRefreshProgress(patch = {}) {
  if (!state?.running) return getRefreshProgress();
  const now = Date.now();
  const prevLeads = state.leads;
  const prevSkipped = state.tikleapSkipped || 0;
  for (const key of [
    "phase",
    "leads",
    "pages",
    "rawSeen",
    "hasMore",
    "limit",
    "maxPages",
    "timeoutMs",
    "lookups",
    "countryHits",
    "gbHits",
    "tikleapKept",
    "tikleapSkipped",
    "queueSize",
    "resolving",
    "persistedLeads",
  ]) {
    if (patch[key] == null) continue;
    if (key === "phase") state.phase = String(patch.phase);
    else if (key === "hasMore") state.hasMore = Boolean(patch.hasMore);
    else state[key] = Math.max(0, Math.floor(Number(patch[key])) || 0);
  }
  if (patch.stuck === true) {
    state.stuck = true;
    state.stuckReason =
      patch.stuckReason != null
        ? String(patch.stuckReason)
        : state.stuckReason || "no_progress";
  }
  state.updatedAt = now;

  if (state.leads > prevLeads) state.lastLeadAt = now;
  if (
    (state.queueSize || 0) > 0 ||
    (state.resolving || 0) > 0 ||
    (state.tikleapSkipped || 0) > prevSkipped
  ) {
    state.lastWorkAt = now;
  }

  // Productive-idle stuck: feed pages may still tick (xhr error loops) after
  // TikLeap boards finished, while keepers + lookup queue are dead.
  const phase = String(state.phase || "");
  const canDeclareStuck =
    phase === "tiktok_feed" ||
    phase === "tiktok_feed_fallback" ||
    phase === "parallel" ||
    phase === "stuck";
  const idleFor =
    now -
    Math.max(
      state.lastLeadAt || state.startedAt,
      state.lastWorkAt || state.startedAt
    );
  // Zero-keeper death spiral: many pages, no lookups/skips, idle queue.
  const zeroLookupThrash =
    state.leads === 0 &&
    state.pages >= STUCK_MIN_PAGES &&
    (state.tikleapSkipped || 0) === 0 &&
    (state.lookups || 0) === 0 &&
    idleFor >= Math.min(STUCK_IDLE_MS, 90 * 1000);
  if (
    !state.stuck &&
    canDeclareStuck &&
    state.leads < state.limit &&
    state.pages >= STUCK_MIN_PAGES &&
    (state.queueSize || 0) === 0 &&
    (state.resolving || 0) === 0 &&
    (idleFor >= STUCK_IDLE_MS || zeroLookupThrash)
  ) {
    state.stuck = true;
    state.stuckReason =
      state.leads === 0
        ? "no_keepers_idle"
        : "keepers_stalled";
    state.phase = "stuck";
    state.hasMore = false;
    console.warn(
      `[refreshProgress] scrape marked stuck (${state.stuckReason}):` +
        ` leads=${state.leads}/${state.limit} pages=${state.pages}` +
        ` idle=${Math.round(idleFor / 1000)}s`
    );
  }

  const last = state.samples[state.samples.length - 1];
  if (
    !last ||
    now - last.t >= 400 ||
    last.leads !== state.leads ||
    last.pages !== state.pages
  ) {
    state.samples.push({ t: now, leads: state.leads, pages: state.pages });
    if (state.samples.length > 48) state.samples.splice(0, state.samples.length - 48);
  }

  return getRefreshProgress();
}

function endRefreshProgress() {
  if (!state) return { running: false };
  state.running = false;
  state.phase = "done";
  state.updatedAt = Date.now();
  state.hasMore = false;
  const snapshot = getRefreshProgress();
  setTimeout(() => {
    if (state && !state.running && state.phase === "done") state = null;
  }, 4000);
  return snapshot;
}

function blendRate(overall, recent, recentWeight = 0.65) {
  if (!(overall > 0) && !(recent > 0)) return 0;
  if (!(overall > 0)) return recent;
  if (!(recent > 0)) return overall;
  return recent * recentWeight + overall * (1 - recentWeight);
}

function rateFromSamples(samples, key, windowMs) {
  if (!samples.length) return 0;
  const latest = samples[samples.length - 1];
  const cutoff = latest.t - windowMs;
  let earliest = samples[0];
  for (let i = samples.length - 1; i >= 0; i -= 1) {
    if (samples[i].t <= cutoff) {
      earliest = samples[i];
      break;
    }
    earliest = samples[i];
  }
  const dt = latest.t - earliest.t;
  if (dt < 1200) return 0;
  const delta = latest[key] - earliest[key];
  if (delta <= 0) return 0;
  return delta / dt;
}

function estimateEtaMs(s) {
  if (!s?.running) return 0;
  const now = Date.now();
  const elapsed = Math.max(0, now - s.startedAt);
  const remainingTimeout = Math.max(0, s.timeoutMs - elapsed);

  if (s.stuck || s.phase === "stuck") return 0;

  if (s.phase === "saving") {
    return Math.min(remainingTimeout, 2500);
  }

  if (s.leads >= s.limit) return 0;

  if (elapsed < 12000 || (s.pages < 2 && s.leads < 1)) {
    return Math.max(0, Math.min(remainingTimeout, COLD_PRIOR_MS - elapsed));
  }

  const overallLeadRate = s.leads > 0 ? s.leads / elapsed : 0;
  const overallPageRate = s.pages > 0 ? s.pages / elapsed : 0;
  const recentLeadRate = rateFromSamples(s.samples, "leads", 28000);
  const recentPageRate = rateFromSamples(s.samples, "pages", 28000);
  const leadRate = blendRate(overallLeadRate, recentLeadRate);
  const pageRate = blendRate(overallPageRate, recentPageRate);

  const byLeads =
    leadRate > 0 ? (s.limit - s.leads) / leadRate : Number.POSITIVE_INFINITY;
  const byPages =
    pageRate > 0 ? (s.maxPages - s.pages) / pageRate : Number.POSITIVE_INFINITY;

  let eta = Math.min(byLeads, byPages, remainingTimeout);

  // Prefer confirmed-lead rate once we have signal; otherwise page/timeout bound.
  // With UK-exit permissive keep, lead rate usually ramps quickly — bias ETA
  // toward remaining keepers rather than raw page budget.
  if (leadRate > 0 && s.leads >= 3) {
    eta = Math.min(
      byLeads,
      remainingTimeout,
      Number.isFinite(byPages) ? byPages * 1.25 : remainingTimeout
    );
  } else if (!(leadRate > 0) || (s.leads < 3 && elapsed > 30000)) {
    eta = Math.min(
      Number.isFinite(byPages) ? byPages : remainingTimeout,
      remainingTimeout
    );
  }

  // Still resolving a queue after feed slows — small buffer.
  if ((s.queueSize > 0 || s.resolving > 0) && s.leads < s.limit) {
    eta = Math.max(eta, Math.min(remainingTimeout, (s.queueSize + s.resolving) * 250));
  }

  if (!Number.isFinite(eta) || eta < 0) eta = remainingTimeout;

  if (typeof s._lastEtaMs === "number" && s._lastEtaMs > 0) {
    const expected = Math.max(0, s._lastEtaMs - (now - (s._lastEtaAt || now)));
    eta = eta * 0.55 + expected * 0.45;
  }
  s._lastEtaMs = eta;
  s._lastEtaAt = now;

  return Math.round(eta);
}

function getRefreshProgress() {
  if (!state) {
    return { running: false };
  }

  const elapsedMs = Math.max(0, Date.now() - state.startedAt);

  // Launch hang: phase never leaves "starting" (Chrome connect / tab create).
  if (
    state.running &&
    !state.stuck &&
    state.phase === "starting" &&
    elapsedMs >= STARTING_STUCK_MS
  ) {
    state.stuck = true;
    state.stuckReason = "chrome_launch_hang";
    state.phase = "stuck";
    state.hasMore = false;
    state.updatedAt = Date.now();
    console.warn(
      `[refreshProgress] scrape marked stuck (chrome_launch_hang):` +
        ` still starting after ${Math.round(elapsedMs / 1000)}s`
    );
  }

  const etaMs = state.running ? estimateEtaMs(state) : 0;
  const leadRatePerMin =
    elapsedMs > 2000 && state.leads > 0
      ? (state.leads / elapsedMs) * 60000
      : 0;

  return {
    running: state.running,
    phase: state.phase,
    startedAt: new Date(state.startedAt).toISOString(),
    updatedAt: new Date(state.updatedAt).toISOString(),
    limit: state.limit,
    maxPages: state.maxPages,
    timeoutMs: state.timeoutMs,
    leads: state.leads,
    pages: state.pages,
    rawSeen: state.rawSeen,
    hasMore: state.hasMore,
    force: state.force,
    lookups: state.lookups || 0,
    countryHits: state.countryHits || 0,
    gbHits: state.gbHits || 0,
    tikleapKept: state.tikleapKept || 0,
    tikleapSkipped: state.tikleapSkipped || 0,
    queueSize: state.queueSize || 0,
    resolving: state.resolving || 0,
    persistedLeads: state.persistedLeads || 0,
    stuck: Boolean(state.stuck),
    stuckReason: state.stuckReason || null,
    elapsedMs,
    etaMs,
    leadRatePerMin: Math.round(leadRatePerMin * 10) / 10,
    progress01: Math.min(1, state.leads / state.limit),
  };
}

function isRefreshProgressStuck() {
  return Boolean(state?.running && state.stuck);
}

function isRefreshProgressRunning() {
  return Boolean(state?.running);
}

module.exports = {
  beginRefreshProgress,
  updateRefreshProgress,
  endRefreshProgress,
  getRefreshProgress,
  isRefreshProgressRunning,
  isRefreshProgressStuck,
};
