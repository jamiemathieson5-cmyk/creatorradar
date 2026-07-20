const { normalizeUserId } = require("./resolveUserId");
const { shouldDropUsername, classifyUsername } = require("./denylist");
const {
  isNonGbRegion,
  isGbRegion,
  classifyRegionStatus,
  shouldSkipIngest,
  hasConfirmedNonGbEvidence,
  hasUkFlagEmoji,
} = require("./regionFilter");
const { pickTrustedRegionFromFields, isConfirmedGbEvidence } = require("./regionResolve");
const { MIN_FOLLOWER_COUNT } = require("./constants");
const { hasScrapedUid } = require("./scrapedUids");

function firstUrl(list) {
  if (!Array.isArray(list) || !list.length) return "";
  return list[0] || "";
}

function pickOwnerUserId(owner) {
  return normalizeUserId(
    owner?.id_str ?? owner?.id ?? owner?.user_id ?? owner?.userId ?? owner?.uid
  );
}

/**
 * Webcast suggested-feed owners expose followers at follow_info.follower_count.
 * Also accept common aliases from other TikTok payloads.
 * @returns {number|null} null when unknown / missing
 */
function pickFollowerCount(owner, room) {
  const followInfo = owner?.follow_info || owner?.followInfo || {};
  const stats = owner?.stats || owner?.stats_info || room?.stats || {};
  const candidates = [
    followInfo.follower_count,
    followInfo.followerCount,
    owner?.follower_count,
    owner?.followerCount,
    stats.followerCount,
    stats.follower_count,
    owner?.fans_count,
    owner?.fans,
  ];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return null;
}

/** True when count is known and meets the Get-leads minimum. */
function meetsFollowerMinimum(followerCount) {
  return (
    Number.isFinite(followerCount) && followerCount >= MIN_FOLLOWER_COUNT
  );
}

/**
 * Lightweight feed candidate for the Chrome resolve pipeline.
 * Rejects clear non-GB / denylist / scraped / under-followers.
 * Does not require confirmed GB yet (needsRegionResolve may be true).
 */
function extractCandidate(stream) {
  const room = stream?.data || stream?.room || stream;
  const owner = room?.owner || room?.Owner || {};
  const username = String(
    owner.display_id || owner.unique_id || owner.uniqueId || owner.username || ""
  )
    .trim()
    .replace(/^@+/, "");

  if (!username) return null;
  if (shouldDropUsername(username)) return null;
  // Learned / static Backstage outcomes (in_network, ineligible, premium, region).
  if (classifyUsername(username)) return null;

  const userId = pickOwnerUserId(owner);
  if (userId && hasScrapedUid(userId)) return null;

  const displayName = owner.nickname || username;
  const bio = String(owner.signature || owner.bio || "").trim();
  if (hasConfirmedNonGbEvidence({ region: null, displayName, username, bio })) {
    return null;
  }

  const followerCount = pickFollowerCount(owner, room);
  if (!meetsFollowerMinimum(followerCount)) return null;

  const avatarUrl =
    firstUrl(owner.avatar_thumb?.url_list) ||
    firstUrl(owner.avatar_medium?.url_list) ||
    firstUrl(owner.avatar_large?.url_list) ||
    firstUrl(room?.cover?.url_list) ||
    owner.avatarThumb ||
    owner.avatarMedium ||
    "";

  let region = pickTrustedRegionFromFields(owner, room);
  let regionSource = region ? "api" : null;
  const blob = [displayName, username, bio].filter(Boolean).join(" ");
  if (!region && hasUkFlagEmoji(blob)) {
    region = "GB";
    regionSource = "flag";
  }

  if (isNonGbRegion(region)) return null;

  const confirmed = isConfirmedGbEvidence({
    region,
    regionSource,
    displayName,
    username,
    bio,
  });

  const secUid = String(owner.sec_uid || owner.secUid || "").trim();

  return {
    username: username.toLowerCase(),
    displayName,
    bio,
    avatarUrl,
    profileUrl: `https://www.tiktok.com/@${username.toLowerCase()}`,
    userId: userId || "",
    followerCount,
    region: region || null,
    regionSource,
    secUid: secUid || "",
    needsRegionResolve: !confirmed,
    confirmed,
    likelyNonUk: isNonGbRegion(region),
    regionStatus: classifyRegionStatus(region),
  };
}

/**
 * Fully resolved lead for store/import paths — confirmed GB only.
 */
function extractLead(stream) {
  const candidate = extractCandidate(stream);
  if (!candidate) return null;
  if (
    shouldSkipIngest({
      region: candidate.region,
      regionSource: candidate.regionSource,
      displayName: candidate.displayName,
      username: candidate.username,
      bio: candidate.bio || "",
    })
  ) {
    return null;
  }
  if (!isConfirmedGbEvidence(candidate)) return null;

  return {
    ...candidate,
    region: isGbRegion(candidate.region) ? candidate.region : "GB",
    regionSource: candidate.regionSource || (hasUkFlagEmoji([candidate.displayName, candidate.username].join(" ")) ? "flag" : "api"),
    regionStatus: null,
  };
}

function extractLeadsFromPayload(payload) {
  const streams = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload)
      ? payload
      : [];

  const leads = [];
  const seen = new Set();
  const seenUids = new Set();

  for (const stream of streams) {
    const lead = extractLead(stream);
    if (!lead || seen.has(lead.username)) continue;
    if (lead.userId) {
      if (seenUids.has(lead.userId)) continue;
      seenUids.add(lead.userId);
    }
    seen.add(lead.username);
    leads.push(lead);
  }

  return {
    leads,
    hasMore: Boolean(payload?.extra?.has_more),
    nextMaxTime: payload?.extra?.max_time || null,
    rawSeen: streams.length,
  };
}

function extractCandidatesFromPayload(payload) {
  const streams = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload)
      ? payload
      : [];

  const candidates = [];
  const seen = new Set();
  const seenUids = new Set();

  for (const stream of streams) {
    const candidate = extractCandidate(stream);
    if (!candidate || seen.has(candidate.username)) continue;
    if (candidate.userId) {
      if (seenUids.has(candidate.userId)) continue;
      seenUids.add(candidate.userId);
    }
    seen.add(candidate.username);
    candidates.push(candidate);
  }

  return {
    candidates,
    hasMore: Boolean(payload?.extra?.has_more),
    nextMaxTime: payload?.extra?.max_time || null,
    rawSeen: streams.length,
  };
}

module.exports = {
  extractLead,
  extractCandidate,
  extractLeadsFromPayload,
  extractCandidatesFromPayload,
  pickFollowerCount,
  meetsFollowerMinimum,
  classifyUsername,
  shouldDropUsername,
};
