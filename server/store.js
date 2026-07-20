const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  STATUSES,
  DAILY_NEW_CAP,
  MIN_FOLLOWER_COUNT,
  MAX_DIAMONDS_L30,
  INACTIVE_DIAMONDS_L30,
  REFRESH_INTERVAL_MS,
} = require("./constants");
const { isNumericUserId, normalizeUserId } = require("./resolveUserId");
const {
  classifyUsername,
  shouldDropUsername,
  canApplyDenylistStatus,
  canPersistDenylistStatus,
  DROP_STATUS,
  TOMBSTONE_STATUS,
  LEARN_STATUSES,
  learnUsername,
  learnMany,
  backfillLearnedFromLeads,
  unlearnFalseInactiveFromCache,
} = require("./denylist");
const {
  classifyRegionStatus,
  isGbRegion,
  isNonGbRegion,
  normalizeRegion,
  shouldSkipIngest,
  hasConfirmedNonGbEvidence,
} = require("./regionFilter");
const {
  hasScrapedUid,
  recordScrapedUids,
  seedScrapedUidsFromLeads,
  scrapedUidCount,
  scrapedUidsPath,
} = require("./scrapedUids");

const DATA_DIR = path.join(__dirname, "..", "data");
const LEADS_PATH = path.join(DATA_DIR, "leads.json");
const META_PATH = path.join(DATA_DIR, "meta.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return structuredClone(fallback);
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return structuredClone(fallback);
  }
}

function writeJson(filePath, data) {
  ensureDataDir();
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

function defaultMeta() {
  return {
    lastRefreshAt: null,
    lastRefreshError: null,
    cycleStartedAt: null,
    newInCycle: 0,
    lastFetchAdded: 0,
    lastFetchSeen: 0,
  };
}

function loadLeads() {
  const data = readJson(LEADS_PATH, { leads: [] });
  return Array.isArray(data.leads) ? data.leads : [];
}

function saveLeads(leads) {
  // Guard: never clobber a non-empty store with an empty write (corrupt read / race).
  if (!Array.isArray(leads) || leads.length === 0) {
    try {
      if (fs.existsSync(LEADS_PATH)) {
        const existing = JSON.parse(fs.readFileSync(LEADS_PATH, "utf8"));
        if (Array.isArray(existing.leads) && existing.leads.length > 0) {
          console.error(
            `[store] refused saveLeads([]) — existing file has ${existing.leads.length} leads`
          );
          return;
        }
      }
    } catch (error) {
      console.error("[store] saveLeads empty-guard check failed:", error.message || error);
    }
  }
  writeJson(LEADS_PATH, { leads });
}

/**
 * Explicit wipe — bypasses saveLeads empty-guard.
 * Tombstones every handle/uid into the learned denylist + scraped-UID registry
 * so Get leads cannot resurrect erased rows as New.
 */
function clearLeads() {
  const previousLeads = loadLeads();
  const previous = previousLeads.length;
  // Preserve CRM intent across erase: contacted/etc stay blocked; still-new
  // rows get an internal "erased" tombstone.
  const tombstones = [];
  for (const lead of previousLeads) {
    const username = usernameKey(lead.username);
    if (!username) continue;
    const status =
      lead.status && lead.status !== "new" && LEARN_STATUSES.has(lead.status)
        ? lead.status
        : TOMBSTONE_STATUS;
    tombstones.push({ username, status });
  }
  if (tombstones.length) learnMany(tombstones);
  recordScrapedUids(previousLeads.map((lead) => lead.userId));
  writeJson(LEADS_PATH, { leads: [] });
  const meta = loadMeta();
  meta.lastFetchAdded = 0;
  meta.lastFetchSeen = 0;
  meta.newInCycle = 0;
  saveMeta(meta);
  return { cleared: previous, remaining: 0, tombstoned: tombstones.length };
}

function loadMeta() {
  return { ...defaultMeta(), ...readJson(META_PATH, defaultMeta()) };
}

function saveMeta(meta) {
  writeJson(META_PATH, meta);
}

function usernameKey(username) {
  return String(username || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

/** Business Suite DM link requires numeric TikTok uid in `u=`. */
function tiktokMessageUrl(userId, username) {
  const uid = normalizeUserId(userId);
  if (uid) {
    return `https://www.tiktok.com/business-suite/messages?from=homepage&lang=en-GB&u=${uid}`;
  }
  const handle = usernameKey(username);
  if (handle) return `https://www.tiktok.com/@${handle}`;
  return "https://www.tiktok.com/messages/";
}

function withMessageUrl(lead) {
  if (!lead) return lead;
  const userId = normalizeUserId(lead.userId) || "";
  return {
    ...lead,
    userId,
    messageUrl: tiktokMessageUrl(userId, lead.username),
  };
}

function listLeads(status, options = {}) {
  const leads = loadLeads();
  const assignedToUserId =
    options.assignedToUserId === undefined
      ? null
      : options.assignedToUserId;
  const unassignedOnly = options.unassignedOnly === true;
  let filtered = leads;

  if (assignedToUserId) {
    filtered = filtered.filter(
      (lead) => lead.assignedToUserId === assignedToUserId
    );
  } else if (unassignedOnly) {
    filtered = filtered.filter((lead) => !lead.assignedToUserId);
  }

  if (status && status !== "all") {
    filtered = filtered.filter((lead) => lead.status === status);
  }

  return filtered
    .sort((a, b) => {
      const aTime = Date.parse(a.sourcedAt || 0);
      const bTime = Date.parse(b.sourcedAt || 0);
      return bTime - aTime;
    })
    .map(withMessageUrl);
}

function getLead(id) {
  return withMessageUrl(loadLeads().find((lead) => lead.id === id) || null);
}

function updateLeadStatus(id, status, options = {}) {
  if (!STATUSES.includes(status)) {
    const err = new Error(`Invalid status: ${status}`);
    err.code = "INVALID_STATUS";
    throw err;
  }

  const leads = loadLeads();
  const index = leads.findIndex((lead) => lead.id === id);
  if (index === -1) {
    const err = new Error("Lead not found");
    err.code = "NOT_FOUND";
    throw err;
  }

  if (
    options.assignedToUserId &&
    leads[index].assignedToUserId !== options.assignedToUserId
  ) {
    const err = new Error("Lead is not assigned to this user");
    err.code = "FORBIDDEN";
    throw err;
  }

  leads[index] = {
    ...leads[index],
    status,
    updatedAt: new Date().toISOString(),
  };
  saveLeads(leads);
  // Always flush CRM progress into denylist + UID registry immediately so a
  // concurrent scrape / later erase cannot resurrect the handle as New.
  if (status !== "new" && LEARN_STATUSES.has(status)) {
    learnUsername(leads[index].username, status);
    recordScrapedUids([leads[index].userId]);
  }
  return withMessageUrl(leads[index]);
}

function ensureCycle(meta, now = Date.now()) {
  if (!meta.cycleStartedAt) {
    meta.cycleStartedAt = new Date(now).toISOString();
    meta.newInCycle = 0;
    return meta;
  }

  const started = Date.parse(meta.cycleStartedAt);
  if (!Number.isFinite(started) || now - started >= REFRESH_INTERVAL_MS) {
    meta.cycleStartedAt = new Date(now).toISOString();
    meta.newInCycle = 0;
  }

  return meta;
}

function remainingQuota(meta = loadMeta(), now = Date.now()) {
  const cycle = ensureCycle({ ...meta }, now);
  return Math.max(0, DAILY_NEW_CAP - (cycle.newInCycle || 0));
}

function nextRefreshAt(meta = loadMeta()) {
  if (!meta.lastRefreshAt) return null;
  const last = Date.parse(meta.lastRefreshAt);
  if (!Number.isFinite(last)) return null;
  return new Date(last + REFRESH_INTERVAL_MS).toISOString();
}

function isRefreshDue(meta = loadMeta(), now = Date.now()) {
  if (!meta.lastRefreshAt) return true;
  const last = Date.parse(meta.lastRefreshAt);
  if (!Number.isFinite(last)) return true;
  return now - last >= REFRESH_INTERVAL_MS;
}

function normalizeFollowerCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

/** Prefer L30; fall back to legacy L28. Unknown/missing → null. */
function leadDiamondsL30(leadOrCandidate) {
  const raw =
    leadOrCandidate?.diamondsL30 != null
      ? leadOrCandidate.diamondsL30
      : leadOrCandidate?.diamondsL28 != null
        ? leadOrCandidate.diamondsL28
        : null;
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

/**
 * Known L30 below inactive threshold (not unknown/missing).
 * Reject null/undefined/"" before Number() — Number(null) === 0.
 */
function isInactiveDiamondsL30(diamonds) {
  if (diamonds == null || diamonds === "") return false;
  const n = Number(diamonds);
  return Number.isFinite(n) && n >= 0 && n < INACTIVE_DIAMONDS_L30;
}

function buildLeadFromCandidate(candidate, username, status, nowIso) {
  const userId = normalizeUserId(candidate.userId) || "";
  const region = normalizeRegion(candidate.region) || candidate.region || null;
  const followerCount = normalizeFollowerCount(candidate.followerCount);
  const lead = {
    id: crypto.randomUUID(),
    username,
    displayName: candidate.displayName || username,
    avatarUrl: candidate.avatarUrl || "",
    profileUrl: candidate.profileUrl || `https://www.tiktok.com/@${username}`,
    userId,
    messageUrl: tiktokMessageUrl(userId, username),
    region,
    status,
    assignedToUserId: null,
    sourcedAt: nowIso,
    updatedAt: nowIso,
  };
  if (followerCount != null) lead.followerCount = followerCount;
  if (candidate.regionSource) lead.regionSource = candidate.regionSource;
  else if (!region) lead.regionSource = null;
  if (candidate.liveNow) lead.liveNow = true;
  if (candidate.source) lead.source = candidate.source;
  const rawDiamonds =
    candidate.diamondsL30 != null
      ? candidate.diamondsL30
      : candidate.diamondsL28 != null
        ? candidate.diamondsL28
        : null;
  // Do not coerce null → 0 (Number(null) === 0); unknown L30 stays unset.
  if (rawDiamonds != null) {
    const diamondsL30 = Number(rawDiamonds);
    if (Number.isFinite(diamondsL30) && diamondsL30 >= 0) {
      const floor = Math.floor(diamondsL30);
      lead.diamondsL30 = floor;
      lead.diamondsL28 = floor;
      lead.diamondsL30At =
        candidate.diamondsL30At || candidate.diamondsL28At || nowIso;
      lead.diamondsL28At = lead.diamondsL30At;
    }
  }
  return lead;
}

/**
 * Denylist wins; otherwise explicit non-GB → unsupported_region.
 * Fresh scrape skips unsupported_region entirely (see addLeads).
 * GB + clean unknown (GB feed) → "new".
 */
function classifyIngestStatus(username, region) {
  const fromDenylist = classifyUsername(username);
  if (fromDenylist) return fromDenylist;
  return classifyRegionStatus(region);
}

/** Find a stored lead by username or numeric UID. */
function findStoredLead(username, userId, leads = null) {
  const list = Array.isArray(leads) ? leads : loadLeads();
  const key = usernameKey(username);
  const uid = normalizeUserId(userId);
  if (key) {
    const byName = list.find((lead) => usernameKey(lead.username) === key);
    if (byName) return byName;
  }
  if (uid) {
    return (
      list.find((lead) => normalizeUserId(lead.userId) === uid) || null
    );
  }
  return null;
}

/**
 * Skip Get leads for denylist / non-new CRM rows only.
 * Still-`new` leads are re-scrapeable. Do not use the permanent scraped-UID
 * registry here — below-floor burns from an old diamond gate would wrongly
 * block creators after the floor is lowered.
 */
function shouldBlockRescrape(username, userId) {
  const key = usernameKey(username);
  if (key && (shouldDropUsername(key) || classifyUsername(key))) {
    return true;
  }
  const existing = findStoredLead(username, userId);
  if (!existing) return false;
  return existing.status !== "new";
}

function addLeads(candidates, options = {}) {
  const ignoreQuota = options.ignoreQuota === true;
  /** Mid-scrape flush: persist keepers without closing the refresh cycle. */
  const live = options.live === true;
  const hardLimit = Number.isFinite(options.limit)
    ? Math.max(0, Math.floor(options.limit))
    : null;

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const meta = ensureCycle(loadMeta(), now);
  const leads = loadLeads();
  const byUsername = new Map(
    leads.map((lead) => [usernameKey(lead.username), lead])
  );
  const byUserId = new Map();
  for (const lead of leads) {
    const uid = normalizeUserId(lead.userId);
    if (uid && !byUserId.has(uid)) byUserId.set(uid, lead);
  }

  let remaining = ignoreQuota
    ? hardLimit == null
      ? Number.POSITIVE_INFINITY
      : hardLimit
    : Math.max(0, DAILY_NEW_CAP - (meta.newInCycle || 0));

  if (!ignoreQuota && hardLimit != null) {
    remaining = Math.min(remaining, hardLimit);
  }

  const added = [];
  const statusUpdates = [];
  /** UIDs resolved this batch (added, confirmed foreign, or denylist) — not unknown gate skips. */
  const resolvedUids = [];
  let seen = 0;
  let dropped = 0;
  let denylistTagged = 0;
  let regionTagged = 0;
  let newAvailable = 0;

  for (const candidate of candidates) {
    const username = usernameKey(candidate.username);
    if (!username) continue;
    seen += 1;

    // TikLeap-verified paths trust GB + L30; skip follower gate.
    const isTikleapSource =
      candidate.regionSource === "tikleap_country" ||
      candidate.source === "tikleap_uk_live" ||
      candidate.source === "tiktok_live_suggested";
    const followerCount = normalizeFollowerCount(candidate.followerCount);
    if (
      !isTikleapSource &&
      (followerCount == null || followerCount < MIN_FOLLOWER_COUNT)
    ) {
      dropped += 1;
      continue;
    }

    const candidateUid = normalizeUserId(candidate.userId) || "";
    const existingByUid =
      candidateUid && byUserId.has(candidateUid)
        ? byUserId.get(candidateUid)
        : null;
    const existingLead = byUsername.get(username) || existingByUid || null;

    // Block progressed statuses. Allow still-`new` refresh.
    if (existingLead && existingLead.status !== "new") {
      dropped += 1;
      continue;
    }
    // Permanent UID registry: skip for legacy feed paths only. TikLeap live
    // must stay re-checkable when the L30 floor changes.
    if (
      !isTikleapSource &&
      !existingLead &&
      candidateUid &&
      hasScrapedUid(candidateUid)
    ) {
      dropped += 1;
      continue;
    }

    const region = normalizeRegion(candidate.region) || candidate.region || null;
    const displayName = candidate.displayName || username;
    const bio = candidate.bio || candidate.signature || "";
    const regionSource = candidate.regionSource || null;
    const skipRegion = shouldSkipIngest({
      region,
      regionSource,
      displayName,
      username,
      bio,
    });
    const classified = skipRegion
      ? "unsupported_region"
      : classifyIngestStatus(username, region);

    if (classified === DROP_STATUS || shouldDropUsername(username)) {
      dropped += 1;
      if (candidateUid) resolvedUids.push(candidateUid);
      continue;
    }

    if (existingLead) {
      // Retag only when still new / missing — never clobber progressed status.
      // Prefer filling region when we now know it.
      const regionPatch =
        region && !existingLead.region
          ? region
          : region && isGbRegion(region) && !isGbRegion(existingLead.region)
            ? region
            : null;

      if (
        classified &&
        canApplyDenylistStatus(existingLead.status) &&
        existingLead.status !== classified
      ) {
        statusUpdates.push({
          username: usernameKey(existingLead.username) || username,
          status: classified,
          region: regionPatch,
          regionSource: candidate.regionSource || null,
          followerCount,
        });
        if (classifyUsername(username)) denylistTagged += 1;
        else regionTagged += 1;
      } else if (
        // Only promote unsupported_region → new when region is explicitly GB.
        !classified &&
        existingLead.status === "unsupported_region" &&
        !classifyUsername(username) &&
        isGbRegion(region)
      ) {
        statusUpdates.push({
          username: usernameKey(existingLead.username) || username,
          status: "new",
          region: regionPatch || region,
          regionSource: candidate.regionSource || existingLead.regionSource || null,
          followerCount,
        });
      } else if (existingLead.status === "new" && !classified) {
        // Re-scrape refresh: avatar, L30 diamonds, display name, ids.
        const diamonds = leadDiamondsL30(candidate);
        const inactive =
          diamonds != null && isInactiveDiamondsL30(diamonds);
        statusUpdates.push({
          username: usernameKey(existingLead.username) || username,
          // Known L30 < 500 → Inactive / lost (do not leave as New).
          status: inactive ? "inactive_lost" : null,
          region: regionPatch || (isGbRegion(region) ? region : null),
          regionSource: candidate.regionSource || null,
          followerCount,
          avatarUrl: candidate.avatarUrl || null,
          displayName: candidate.displayName || null,
          userId: candidateUid || null,
          diamondsL30: diamonds,
        });
      } else if (
        regionPatch ||
        candidate.regionSource ||
        (followerCount != null && existingLead.followerCount !== followerCount)
      ) {
        statusUpdates.push({
          username: usernameKey(existingLead.username) || username,
          status: null,
          region: regionPatch,
          regionSource: candidate.regionSource || null,
          followerCount,
        });
      }
      if (candidateUid) resolvedUids.push(candidateUid);
      continue;
    }

    // Fresh insert: never store unsupported_region (skip entirely).
    if (classified === "unsupported_region" || skipRegion) {
      dropped += 1;
      regionTagged += 1;
      // Learn only confirmed non-GB — not “unknown failed strict GB gate”.
      const confirmedForeign = hasConfirmedNonGbEvidence({
        region,
        displayName,
        username,
        bio,
      });
      if (confirmedForeign) {
        learnUsername(username, "unsupported_region");
        if (candidateUid) resolvedUids.push(candidateUid);
      }
      continue;
    }

    if (classified) {
      // Fresh scrape: never insert denylist rows (unsupported_region / in_network / …).
      // Only clean GB → status "new" should land from Get leads.
      dropped += 1;
      denylistTagged += 1;
      if (candidateUid) resolvedUids.push(candidateUid);
      continue;
    }

    const candidateDiamonds = leadDiamondsL30(candidate);
    const markInactive =
      candidateDiamonds != null && isInactiveDiamondsL30(candidateDiamonds);

    // Inactive inserts do not burn the New daily / refresh quota.
    if (!markInactive && remaining <= 0) break;

    const lead = buildLeadFromCandidate(
      { ...candidate, region },
      username,
      markInactive ? "inactive_lost" : "new",
      nowIso
    );
    byUsername.set(username, lead);
    if (candidateUid) byUserId.set(candidateUid, lead);
    added.push(lead);
    if (candidateUid) resolvedUids.push(candidateUid);
    if (!markInactive) {
      remaining -= 1;
      newAvailable += 1;
    }
  }

  // Only burn UIDs we actually resolved (added / confirmed foreign / denylist).
  // Unknown-region gate skips must stay re-scrapeable (mode changes / bugs).
  recordScrapedUids([
    ...resolvedUids,
    ...added.map((lead) => lead.userId),
  ]);
  if (!ignoreQuota) {
    meta.newInCycle = (meta.newInCycle || 0) + newAvailable;
  }
  if (live) {
    // Keepers land in the store during the scrape; final addLeads closes the cycle.
    if (newAvailable > 0) {
      meta.liveAddedThisRefresh =
        (meta.liveAddedThisRefresh || 0) + newAvailable;
    }
    meta.lastRefreshError = null;
  } else {
    const livePrior = Math.max(0, Math.floor(meta.liveAddedThisRefresh) || 0);
    meta.lastFetchAdded = newAvailable + livePrior;
    meta.lastFetchSeen = seen;
    meta.lastRefreshAt = nowIso;
    meta.lastRefreshError = null;
    meta.liveAddedThisRefresh = 0;
  }

  // Re-read before write so concurrent status PATCHes are not clobbered.
  let fresh = loadLeads();
  let mutated = false;

  if (statusUpdates.length) {
    const updateMap = new Map(statusUpdates.map((item) => [item.username, item]));
    fresh = fresh.map((lead) => {
      const key = usernameKey(lead.username);
      const patch = updateMap.get(key);
      if (!patch) return lead;
      let next = lead;
      let changed = false;
      if (
        patch.status &&
        lead.status !== patch.status &&
        // Never upgrade progressed CRM (contacted/etc.) back to new.
        !(
          patch.status === "new" &&
          lead.status &&
          lead.status !== "new" &&
          lead.status !== "unsupported_region"
        ) &&
        (canApplyDenylistStatus(lead.status) ||
          (lead.status === "unsupported_region" && patch.status === "new"))
      ) {
        next = { ...next, status: patch.status };
        changed = true;
      }
      if (patch.region && next.region !== patch.region) {
        next = { ...next, region: patch.region };
        changed = true;
      }
      if (patch.regionSource && next.regionSource !== patch.regionSource) {
        next = { ...next, regionSource: patch.regionSource };
        changed = true;
      }
      if (
        Number.isFinite(patch.followerCount) &&
        next.followerCount !== patch.followerCount
      ) {
        next = { ...next, followerCount: patch.followerCount };
        changed = true;
      }
      if (
        patch.avatarUrl &&
        patch.avatarUrl !== next.avatarUrl
      ) {
        next = { ...next, avatarUrl: patch.avatarUrl };
        changed = true;
      }
      if (
        patch.displayName &&
        patch.displayName !== next.displayName
      ) {
        next = { ...next, displayName: patch.displayName };
        changed = true;
      }
      if (patch.userId) {
        const patchUid = normalizeUserId(patch.userId);
        if (patchUid && patchUid !== normalizeUserId(next.userId)) {
          next = {
            ...next,
            userId: patchUid,
            messageUrl: tiktokMessageUrl(patchUid, next.username),
          };
          changed = true;
        }
      }
      if (Number.isFinite(patch.diamondsL30) && patch.diamondsL30 >= 0) {
        const floor = Math.floor(patch.diamondsL30);
        if (
          next.diamondsL30 !== floor ||
          next.diamondsL28 !== floor
        ) {
          next = {
            ...next,
            diamondsL30: floor,
            diamondsL28: floor,
            diamondsL30At: nowIso,
            diamondsL28At: nowIso,
          };
          changed = true;
        }
        // Over-cap New leads block inventory without being useful — demote.
        if (
          floor > MAX_DIAMONDS_L30 &&
          (next.status || lead.status) === "new"
        ) {
          next = { ...next, status: "ineligible" };
          changed = true;
        }
        // Known L30 < 500 → Inactive / lost (unknown L30 never reaches here).
        if (
          isInactiveDiamondsL30(floor) &&
          (next.status || lead.status) === "new"
        ) {
          next = { ...next, status: "inactive_lost" };
          changed = true;
        }
      }
      if (!changed) return lead;
      mutated = true;
      return { ...next, updatedAt: nowIso };
    });
  }

  if (added.length) {
    const freshKeys = new Set(fresh.map((lead) => usernameKey(lead.username)));
    const freshUids = new Set(
      fresh.map((lead) => normalizeUserId(lead.userId)).filter(Boolean)
    );
    const trulyNew = added.filter((lead) => {
      const key = usernameKey(lead.username);
      // Defense: never insert a denylist / tombstone handle as New.
      if (key && (shouldDropUsername(key) || classifyUsername(key))) return false;
      if (freshKeys.has(key)) return false;
      const uid = normalizeUserId(lead.userId);
      if (uid && freshUids.has(uid)) return false;
      freshKeys.add(key);
      if (uid) freshUids.add(uid);
      return true;
    });
    if (trulyNew.length) {
      fresh = [...trulyNew, ...fresh];
      mutated = true;
    }
  }

  if (mutated) saveLeads(fresh);
  saveMeta(meta);

  // Persist explicit Backstage-style / region denials so unknown-region re-scrapes stay out of New.
  for (const lead of added) {
    if (LEARN_STATUSES.has(lead.status)) {
      learnUsername(lead.username, lead.status);
    }
  }
  for (const patch of statusUpdates) {
    if (patch.status && LEARN_STATUSES.has(patch.status)) {
      learnUsername(patch.username, patch.status);
    }
  }

  return {
    added: added.filter((lead) => lead.status === "new"),
    allAdded: added,
    seen,
    dropped,
    denylistTagged,
    regionTagged,
    meta,
    remainingQuota: remainingQuota(meta),
  };
}

/**
 * Startup repair: drop learned inactive_lost for creators whose TikLeap cache
 * shows masked/unknown L30 (should have been kept as New, not tombstoned).
 */
function unlearnFalseInactiveFromTikleapCache() {
  const cachePath = path.join(DATA_DIR, "tikleap-l28-cache.json");
  try {
    if (!fs.existsSync(cachePath)) return { removed: 0, total: 0 };
    const raw = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    const entries =
      raw?.entries && typeof raw.entries === "object" ? raw.entries : raw;
    return unlearnFalseInactiveFromCache(entries);
  } catch (error) {
    console.warn(
      "[denylist] false-inactive cleanup failed:",
      error?.message || error
    );
    return { removed: 0, total: 0 };
  }
}

/**
 * One-time / startup pass: known L30 < INACTIVE_DIAMONDS_L30 → inactive_lost.
 * Only demotes still-`new` rows. Never clobbers contacted / in_network / etc.
 * Skips unknown/missing L30. Does not touch rows already inactive_lost.
 */
function backfillInactiveFromDiamonds() {
  const leads = loadLeads();
  const nowIso = new Date().toISOString();
  let updated = 0;
  let already = 0;
  let skippedUnknown = 0;
  let skippedProgressed = 0;

  const next = leads.map((lead) => {
    const diamonds = leadDiamondsL30(lead);
    if (diamonds == null) {
      skippedUnknown += 1;
      return lead;
    }
    if (!isInactiveDiamondsL30(diamonds)) return lead;
    if (lead.status === "inactive_lost") {
      already += 1;
      return lead;
    }
    // Only auto-demote New inventory — never overwrite CRM progress.
    if (lead.status && lead.status !== "new") {
      skippedProgressed += 1;
      return lead;
    }
    updated += 1;
    return { ...lead, status: "inactive_lost", updatedAt: nowIso };
  });

  if (updated) {
    saveLeads(next);
    for (const lead of next) {
      if (
        lead.status === "inactive_lost" &&
        lead.updatedAt === nowIso
      ) {
        learnUsername(lead.username, "inactive_lost");
      }
    }
  }
  return {
    updated,
    already,
    skippedUnknown,
    skippedProgressed,
    total: next.length,
    threshold: INACTIVE_DIAMONDS_L30,
  };
}

/** Apply denylist tags to existing leads; drop nonexistent / erased / manual_test_* rows. */
function backfillDenylist() {
  const leads = loadLeads();
  const nowIso = new Date().toISOString();
  let updated = 0;
  let removed = 0;
  let skipped = 0;

  const next = [];
  for (const lead of leads) {
    const classified = classifyUsername(lead.username);
    if (classified === DROP_STATUS || classified === TOMBSTONE_STATUS) {
      removed += 1;
      continue;
    }
    if (!classified) {
      next.push(lead);
      continue;
    }
    if (!canPersistDenylistStatus(classified)) {
      skipped += 1;
      next.push(lead);
      continue;
    }
    if (lead.status === classified) {
      next.push(lead);
      continue;
    }
    if (!canApplyDenylistStatus(lead.status)) {
      skipped += 1;
      next.push(lead);
      continue;
    }
    updated += 1;
    next.push({ ...lead, status: classified, updatedAt: nowIso });
  }

  if (updated || removed) saveLeads(next);
  return { updated, removed, skipped, total: next.length };
}

/**
 * Region status backfill:
 * - Explicit non-GB → unsupported_region (when overwritable)
 * - Explicit GB + unsupported_region (not denylist) → new
 * - Unknown region + unsupported_region → leave alone (do not promote;
 *   manual / Backstage marks stay; clean unknowns only enter via fresh scrape)
 */
function backfillRegions() {
  const leads = loadLeads();
  const nowIso = new Date().toISOString();
  let updated = 0;
  let skipped = 0;
  let alreadyOk = 0;
  let promoted = 0;

  const next = leads.map((lead) => {
    const denylist = classifyUsername(lead.username);
    if (denylist === DROP_STATUS || denylist === TOMBSTONE_STATUS) return lead;

    // Denylist statuses take precedence when already applied or applicable.
    if (denylist) {
      if (!canPersistDenylistStatus(denylist)) {
        skipped += 1;
        return lead;
      }
      if (lead.status === denylist) {
        alreadyOk += 1;
        return lead;
      }
      if (canApplyDenylistStatus(lead.status)) {
        updated += 1;
        return { ...lead, status: denylist, updatedAt: nowIso };
      }
      skipped += 1;
      return lead;
    }

    // Explicit non-GB → unsupported_region when still overwritable.
    if (isNonGbRegion(lead.region)) {
      if (lead.status === "unsupported_region") {
        alreadyOk += 1;
        return lead;
      }
      if (!canApplyDenylistStatus(lead.status)) {
        skipped += 1;
        return lead;
      }
      updated += 1;
      return { ...lead, status: "unsupported_region", updatedAt: nowIso };
    }

    // Explicit GB only: restore false unsupported_region tags.
    if (lead.status === "unsupported_region" && isGbRegion(lead.region)) {
      updated += 1;
      promoted += 1;
      return { ...lead, status: "new", updatedAt: nowIso };
    }

    alreadyOk += 1;
    return lead;
  });

  if (updated) saveLeads(next);
  return { updated, skipped, alreadyOk, promoted, total: next.length };
}

/**
 * Persist resolved regions (and optionally promote/demote status).
 * - GB + unsupported_region (not on denylist) → new
 * - non-GB + overwritable → unsupported_region
 */
function applyRegions(updates) {
  if (!Array.isArray(updates) || !updates.length) return { updated: 0, promoted: 0, demoted: 0 };

  const byUsername = new Map();
  for (const item of updates) {
    const username = usernameKey(item.username);
    const region = normalizeRegion(item.region);
    if (!username || !region) continue;
    byUsername.set(username, region);
  }
  if (!byUsername.size) return { updated: 0, promoted: 0, demoted: 0 };

  const leads = loadLeads();
  let updated = 0;
  let promoted = 0;
  let demoted = 0;
  const nowIso = new Date().toISOString();

  for (let i = 0; i < leads.length; i += 1) {
    const key = usernameKey(leads[i].username);
    const region = byUsername.get(key);
    if (!region) continue;

    let next = { ...leads[i] };
    let changed = false;

    if (next.region !== region) {
      next.region = region;
      changed = true;
    }

    const denylist = classifyUsername(key);
    if (!denylist && canApplyDenylistStatus(next.status)) {
      if (isGbRegion(region)) {
        if (next.status === "unsupported_region") {
          next.status = "new";
          promoted += 1;
          changed = true;
        }
      } else if (next.status !== "unsupported_region") {
        next.status = "unsupported_region";
        demoted += 1;
        changed = true;
      }
    }

    if (changed) {
      next.updatedAt = nowIso;
      leads[i] = next;
      updated += 1;
      if (next.status === "unsupported_region") {
        learnUsername(key, "unsupported_region");
      }
    }
  }

  if (updated) saveLeads(leads);
  return { updated, promoted, demoted };
}

function leadsMissingRegion() {
  return loadLeads().filter((lead) => {
    if (!usernameKey(lead.username)) return false;
    return !normalizeRegion(lead.region);
  });
}

function resetLiveRefreshMeta() {
  const meta = loadMeta();
  if (!(meta.liveAddedThisRefresh > 0)) return meta;
  meta.liveAddedThisRefresh = 0;
  saveMeta(meta);
  return meta;
}

/** Fold mid-scrape live adds into lastFetch* when the run ends without a final addLeads. */
function finalizeLiveRefreshMeta({ seen = 0, error = null } = {}) {
  const meta = loadMeta();
  const livePrior = Math.max(0, Math.floor(meta.liveAddedThisRefresh) || 0);
  // Empty no-op (e.g. skipped refresh finally) — leave meta untouched.
  if (!livePrior && error == null) return meta;
  const nowIso = new Date().toISOString();
  if (livePrior > 0) {
    meta.lastFetchAdded = livePrior;
    if (seen > 0) meta.lastFetchSeen = Math.max(meta.lastFetchSeen || 0, seen);
  }
  // Stamp completion for both keeper flushes and hard errors (0 adds).
  meta.lastRefreshAt = nowIso;
  if (error != null) meta.lastRefreshError = String(error);
  else meta.lastRefreshError = null;
  meta.liveAddedThisRefresh = 0;
  saveMeta(meta);
  return meta;
}

function recordRefreshError(message) {
  const meta = loadMeta();
  meta.lastRefreshError = message;
  // A finished Get leads that found 0 keepers still counts as a refresh attempt.
  meta.lastRefreshAt = new Date().toISOString();
  saveMeta(meta);
  return meta;
}

function clearRefreshError() {
  const meta = loadMeta();
  if (!meta.lastRefreshError) return meta;
  meta.lastRefreshError = null;
  saveMeta(meta);
  return meta;
}

function markRefreshAttempt() {
  const meta = loadMeta();
  meta.lastRefreshAt = new Date().toISOString();
  meta.lastRefreshError = null;
  saveMeta(meta);
  return meta;
}

function getMeta() {
  const meta = ensureCycle(loadMeta());
  saveMeta(meta);
  return {
    ...meta,
    dailyCap: DAILY_NEW_CAP,
    remainingQuota: remainingQuota(meta),
    nextRefreshAt: nextRefreshAt(meta),
    refreshDue: isRefreshDue(meta),
    totalLeads: loadLeads().length,
    statuses: STATUSES,
  };
}

/**
 * Assign unassigned pool leads (default: status "new") to a user.
 * Returns how many were assigned and remaining pool size.
 */
function distributeLeads(userId, count, options = {}) {
  const targetUserId = String(userId || "").trim();
  if (!targetUserId) {
    const err = new Error("userId is required");
    err.code = "INVALID_USER";
    throw err;
  }
  const n = Math.floor(Number(count));
  if (!Number.isFinite(n) || n < 1) {
    const err = new Error("count must be a positive integer");
    err.code = "INVALID_COUNT";
    throw err;
  }

  const statusFilter = options.status || "new";
  const leads = loadLeads();
  const nowIso = new Date().toISOString();
  const poolIndexes = [];
  for (let i = 0; i < leads.length; i += 1) {
    const lead = leads[i];
    if (lead.assignedToUserId) continue;
    if (statusFilter !== "all" && lead.status !== statusFilter) continue;
    poolIndexes.push(i);
  }

  // Prefer newest pool leads first (sourcedAt desc).
  poolIndexes.sort((a, b) => {
    const aTime = Date.parse(leads[a].sourcedAt || 0);
    const bTime = Date.parse(leads[b].sourcedAt || 0);
    return bTime - aTime;
  });

  const take = Math.min(n, poolIndexes.length);
  const assigned = [];
  for (let i = 0; i < take; i += 1) {
    const idx = poolIndexes[i];
    leads[idx] = {
      ...leads[idx],
      assignedToUserId: targetUserId,
      assignedAt: nowIso,
      updatedAt: nowIso,
    };
    assigned.push(withMessageUrl(leads[idx]));
  }
  if (take) saveLeads(leads);

  const remainingPool = poolIndexes.length - take;
  return {
    assigned: assigned.length,
    remainingPool,
    leads: assigned,
    userId: targetUserId,
  };
}

/**
 * Clear assignment on all leads for a user (return to unassigned pool).
 * Does not delete lead rows.
 */
function unassignLeadsForUser(userId) {
  const targetUserId = String(userId || "").trim();
  if (!targetUserId) {
    return { unassigned: 0 };
  }
  const leads = loadLeads();
  const nowIso = new Date().toISOString();
  let unassigned = 0;
  for (let i = 0; i < leads.length; i += 1) {
    if (leads[i].assignedToUserId !== targetUserId) continue;
    leads[i] = {
      ...leads[i],
      assignedToUserId: null,
      assignedAt: null,
      updatedAt: nowIso,
    };
    unassigned += 1;
  }
  if (unassigned) saveLeads(leads);
  return { unassigned };
}

function assignmentOverview(userList = []) {
  const leads = loadLeads();
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  let unassigned = 0;
  let unassignedNew = 0;
  const byUser = new Map();

  for (const lead of leads) {
    if (Object.prototype.hasOwnProperty.call(byStatus, lead.status)) {
      byStatus[lead.status] += 1;
    }
    if (!lead.assignedToUserId) {
      unassigned += 1;
      if (lead.status === "new") unassignedNew += 1;
      continue;
    }
    const uid = lead.assignedToUserId;
    if (!byUser.has(uid)) {
      byUser.set(uid, { userId: uid, total: 0, byStatus: {} });
    }
    const row = byUser.get(uid);
    row.total += 1;
    row.byStatus[lead.status] = (row.byStatus[lead.status] || 0) + 1;
  }

  const usersById = new Map(
    (Array.isArray(userList) ? userList : []).map((u) => [u.id, u])
  );
  const assignments = [...byUser.values()]
    .map((row) => {
      const user = usersById.get(row.userId);
      return {
        ...row,
        username: user?.username || null,
        email: user?.email || null,
      };
    })
    .sort((a, b) => b.total - a.total);

  // Include users with zero assignments so admin UI can still pick them.
  for (const user of userList || []) {
    if (user.role === "admin") continue;
    if (byUser.has(user.id)) continue;
    assignments.push({
      userId: user.id,
      username: user.username,
      email: user.email,
      total: 0,
      byStatus: {},
    });
  }

  return {
    totalLeads: leads.length,
    byStatus,
    unassigned,
    unassignedNew,
    assignments,
  };
}

function seedIfEmpty(seedLeads) {
  const leads = loadLeads();
  if (leads.length > 0) return false;
  if (!Array.isArray(seedLeads) || !seedLeads.length) return false;

  const nowIso = new Date().toISOString();
  const seeded = [];
  for (const item of seedLeads) {
    const username = usernameKey(item.username);
    if (!username || shouldDropUsername(username)) continue;
    if (
      shouldSkipIngest({
        region: item.region || null,
        regionSource: item.regionSource || null,
        displayName: item.displayName || username,
        username,
        bio: item.bio || item.signature || "",
      })
    ) {
      continue;
    }
    const classified = classifyIngestStatus(username, item.region || null);
    if (classified === "unsupported_region") continue;
    const userId = normalizeUserId(item.userId) || "";
    const followerCount = normalizeFollowerCount(item.followerCount);
    const row = {
      id: crypto.randomUUID(),
      username,
      displayName: item.displayName || item.username,
      avatarUrl: item.avatarUrl || "",
      profileUrl: item.profileUrl || `https://www.tiktok.com/@${username}`,
      userId,
      messageUrl: tiktokMessageUrl(userId, username),
      region: normalizeRegion(item.region) || item.region || null,
      status: classified || "new",
      assignedToUserId: null,
      sourcedAt: nowIso,
      updatedAt: nowIso,
    };
    if (followerCount != null) row.followerCount = followerCount;
    seeded.push(row);
  }

  if (!seeded.length) return false;
  saveLeads(seeded);
  recordScrapedUids(seeded.map((row) => row.userId));
  return true;
}

function leadsMissingUserId() {
  return loadLeads().filter((lead) => !normalizeUserId(lead.userId) && usernameKey(lead.username));
}

/** Persist resolved numeric uids and refresh messageUrl; preserves status/other fields. */
function applyUserIds(updates) {
  if (!Array.isArray(updates) || !updates.length) return { updated: 0 };

  const byUsername = new Map();
  for (const item of updates) {
    const username = usernameKey(item.username);
    const userId = normalizeUserId(item.userId);
    if (!username || !userId) continue;
    byUsername.set(username, userId);
  }
  if (!byUsername.size) return { updated: 0 };

  const leads = loadLeads();
  let updated = 0;
  const nowIso = new Date().toISOString();

  for (let i = 0; i < leads.length; i += 1) {
    const key = usernameKey(leads[i].username);
    const userId = byUsername.get(key);
    if (!userId) continue;
    if (normalizeUserId(leads[i].userId) === userId) {
      // Still refresh messageUrl if it was the old username-based link.
      const nextUrl = tiktokMessageUrl(userId, key);
      if (leads[i].messageUrl !== nextUrl) {
        leads[i] = { ...leads[i], userId, messageUrl: nextUrl, updatedAt: nowIso };
        updated += 1;
      }
      continue;
    }
    leads[i] = {
      ...leads[i],
      userId,
      messageUrl: tiktokMessageUrl(userId, key),
      updatedAt: nowIso,
    };
    updated += 1;
  }

  if (updated) {
    saveLeads(leads);
    recordScrapedUids([...byUsername.values()]);
  }
  return { updated };
}

module.exports = {
  listLeads,
  getLead,
  findStoredLead,
  shouldBlockRescrape,
  clearLeads,
  updateLeadStatus,
  distributeLeads,
  unassignLeadsForUser,
  assignmentOverview,
  addLeads,
  backfillInactiveFromDiamonds,
  unlearnFalseInactiveFromTikleapCache,
  backfillDenylist,
  backfillRegions,
  applyRegions,
  leadsMissingRegion,
  getMeta,
  remainingQuota,
  isRefreshDue,
  recordRefreshError,
  clearRefreshError,
  markRefreshAttempt,
  resetLiveRefreshMeta,
  finalizeLiveRefreshMeta,
  seedIfEmpty,
  usernameKey,
  leadsMissingUserId,
  applyUserIds,
  tiktokMessageUrl,
  isNumericUserId,
  normalizeUserId,
  classifyUsername,
  backfillLearnedFromLeads,
  learnUsername,
  seedScrapedUidsFromLeads,
  scrapedUidCount,
  scrapedUidsPath,
  hasScrapedUid,
  recordScrapedUids,
};
