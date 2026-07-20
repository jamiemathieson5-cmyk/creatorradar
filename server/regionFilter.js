/**
 * GB / UK ingest filter for CreatorRadar.
 *
 * Get leads requires confirmed GB:
 *   - Trusted API country/region GB|UK|GBR (never en-GB locale)
 *   - Or UK national / home-nation flag in name/bio
 *
 * Skip when non-GB is evidenced or region is unconfirmed.
 */

const { UK_REGION_CODES } = require("./constants");

/** ISO-ish aliases / names we treat as United Kingdom. */
const GB_ALIASES = new Set([
  ...UK_REGION_CODES,
  "UNITEDKINGDOM",
  "GREATBRITAIN",
  "GREATBRITIAN",
  "ENGLAND",
  "SCOTLAND",
  "WALES",
  "NORTHERNIRELAND",
  "UK+",
  "GB+",
]);

/** Language-only tags that must not be treated as country codes. */
const LANGUAGE_ONLY = new Set(["EN", "ENG"]);

/** Marker when region is unknown but lead came from the GB-targeted feed. */
const FEED_GB_SOURCE = "feed_gb";

/**
 * Regional-indicator pairs seen on unsupported_region ground-truth leads
 * (and common neighbours). 🇬🇧 → GB; everything else → non-GB skip.
 */
const FLAG_TO_REGION = {
  "🇬🇧": "GB",
  "🇩🇪": "DE",
  "🇦🇪": "AE",
  "🇪🇬": "EG",
  "🇧🇷": "BR",
  "🇺🇸": "US",
  "🇫🇷": "FR",
  "🇵🇰": "PK",
  "🇮🇳": "IN",
  "🇸🇦": "SA",
  "🇹🇷": "TR",
  "🇳🇬": "NG",
  "🇰🇪": "KE",
  "🇬🇭": "GH",
  "🇲🇦": "MA",
  "🇩🇿": "DZ",
  "🇹🇳": "TN",
  "🇯🇴": "JO",
  "🇱🇧": "LB",
  "🇮🇶": "IQ",
  "🇮🇷": "IR",
  "🇦🇫": "AF",
  "🇧🇩": "BD",
  "🇵🇭": "PH",
  "🇮🇩": "ID",
  "🇻🇳": "VN",
  "🇹🇭": "TH",
  "🇲🇽": "MX",
  "🇨🇦": "CA",
  "🇦🇺": "AU",
  "🇳🇿": "NZ",
  "🇮🇪": "IE",
  "🇪🇸": "ES",
  "🇮🇹": "IT",
  "🇳🇱": "NL",
  "🇵🇱": "PL",
  "🇷🇴": "RO",
  "🇵🇹": "PT",
  "🇿🇦": "ZA",
};

/**
 * Strong UK country phrases only (word boundaries).
 * Cities / bare "uk" were false-positives for foreign creators.
 */
const GB_NAME_RE =
  /\b(united\s*kingdom|great\s*britain|england|scotland|wales|northern\s*ireland)\b/i;

const NON_GB_NAME_RE =
  /\b(germany|deutschland|dubai|u\.?a\.?e\.?|united\s*arab\s*emirates|egypt|brazil|brasil|pakistan|india|nigeria|kenya|ghana|france|turkey|türkiye|saudi|iraq|iran|afghanistan|bangladesh|philippines|indonesia|vietnam|thailand|mexico|canada|australia|new\s*zealand|ireland|spain|italy|netherlands|holland|poland|romania|portugal|south\s*africa|morocco|algeria|tunisia|jordan|lebanon|usa|united\s*states|america|ukraine)\b/i;

/** Clear country tokens in username (e.g. brazilusa01) — not ethnolinguistic guessing. */
const USERNAME_NON_GB_RE =
  /(brazil|brasil|dubai|uae|egypt|germany|pakistan|nigeria|india|france|turkey|iraq|iran|afghanistan|bangladesh|philippines|indonesia|vietnam|mexico|australia|ukraine)/i;

/**
 * Clear UK handle markers — separators required so "duke" / "bukowski" do not match.
 * Examples: rapunzel.uk, foo_uk, uk_bar, live-uk-now
 */
const USERNAME_GB_RE = /(?:^|[._-])uk(?:[._-]|$)/i;

/**
 * Any regional-indicator character (flag emoji building block).
 * Also tagged subdivision flags (England / Scotland / Wales black-flag sequences).
 */
const REGIONAL_INDICATOR_RE = /[\u{1F1E6}-\u{1F1FF}]/u;
const TAGGED_FLAG_RE = /\u{1F3F4}[\u{E0061}-\u{E007A}\u{E007F}]+/u;

/** England / Scotland / Wales tagged flags (gbeng / gbscot / gbwls). */
const UK_TAGGED_FLAG_RE =
  /\u{1F3F4}\u{E0067}\u{E0062}(?:\u{E0065}\u{E006E}\u{E0067}|\u{E0073}\u{E0063}\u{E0074}|\u{E0077}\u{E006C}\u{E0073})\u{E007F}/u;

/**
 * Substantial non-Latin / non-English letter scripts in display name or bio.
 * Latin letters (incl. accented en/fr/es names) are left alone; empty text passes.
 */
const NON_ENGLISH_SCRIPT_RE =
  /[\p{Script=Arabic}\p{Script=Armenian}\p{Script=Bengali}\p{Script=Cyrillic}\p{Script=Devanagari}\p{Script=Ethiopic}\p{Script=Georgian}\p{Script=Greek}\p{Script=Gujarati}\p{Script=Gurmukhi}\p{Script=Han}\p{Script=Hangul}\p{Script=Hebrew}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Khmer}\p{Script=Lao}\p{Script=Myanmar}\p{Script=Sinhala}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Thai}\p{Script=Tibetan}]/gu;

/** Min non-English script letters before we treat the text as clearly non-English. */
const NON_ENGLISH_SCRIPT_MIN = 2;

function stripNoise(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, "") // regional-indicator (flags)
    .replace(/[^\p{L}\p{N}+_-]+/gu, "")
    .toUpperCase();
}

/**
 * Normalize a raw region/country/locale value to a short code, or null if unknown.
 * @param {unknown} raw
 * @returns {string|null}
 */
function normalizeRegion(raw) {
  if (raw == null) return null;
  const original = String(raw).trim();
  if (!original) return null;

  // Uncertain feed marker — not a confirmed country code.
  if (original === "GB?" || original.toUpperCase() === "GB?") return null;

  // Flag / name hints for UK before stripping.
  if (/🇬🇧/.test(original) || /united\s*kingdom/i.test(original)) return "GB";
  if (/great\s*britain/i.test(original)) return "GB";

  // Language-country locales (en-GB, en_US) are viewer/app language — NOT
  // creator country. TikTok's suggested feed is forced to en-GB locally.
  if (/^[a-z]{2}[_-][a-z]{2}$/i.test(original)) return null;

  // Pure language tag (e.g. "en") — not a country.
  if (/^[a-z]{2}$/i.test(original)) {
    const code = original.toUpperCase();
    if (LANGUAGE_ONLY.has(code)) return null;
    // Remaining 2-letter tokens are treated as ISO country codes (GB, US, …).
    return code;
  }

  const cleaned = stripNoise(original);
  if (!cleaned) return null;

  if (GB_ALIASES.has(cleaned)) return "GB";

  // Exact UK+/GB+ leaderboard tokens only — do NOT startsWith("UK")
  // (that falsely matched UKRAINE → GB).
  if (cleaned === "UK+" || cleaned === "GB+" || cleaned === "GBR") return "GB";

  if (LANGUAGE_ONLY.has(cleaned)) return null;

  // Prefer 2–3 letter country codes
  if (cleaned.length === 2 || cleaned.length === 3) return cleaned;

  // Longer strings that clearly name a country are left as cleaned token
  // so isGbRegion / isNonGbRegion can still decide; unknown names → null.
  if (cleaned.length > 3 && cleaned.length < 40) {
    if (GB_ALIASES.has(cleaned)) return "GB";
    return null;
  }

  return null;
}

/** True when text contains any flag emoji (any country, including UK). */
function hasFlagEmoji(text) {
  const raw = String(text || "");
  if (!raw) return false;
  return REGIONAL_INDICATOR_RE.test(raw) || TAGGED_FLAG_RE.test(raw);
}

function hasUkFlagEmoji(text) {
  const raw = String(text || "");
  if (!raw) return false;
  if (/🇬🇧/.test(raw)) return true;
  return UK_TAGGED_FLAG_RE.test(raw);
}

/** Any flag that is not a UK national / home-nation flag. */
function hasNonUkFlagEmoji(text) {
  const raw = String(text || "");
  if (!raw) return false;
  if (!hasFlagEmoji(raw)) return false;
  // Strip UK flags; if any flag signal remains → non-UK.
  const stripped = raw
    .replace(/🇬🇧/g, "")
    .replace(UK_TAGGED_FLAG_RE, "");
  return hasFlagEmoji(stripped);
}

/**
 * True when display name / bio has a clear non-English script signal.
 * Sparse accented Latin (José, Zoë) stays; empty / emoji-only bios pass.
 * @param {string} text
 * @returns {boolean}
 */
function hasNonEnglishScript(text) {
  const raw = String(text || "");
  if (!raw.trim()) return false;
  const matches = raw.match(NON_ENGLISH_SCRIPT_RE);
  return Boolean(matches && matches.length >= NON_ENGLISH_SCRIPT_MIN);
}

/**
 * Infer region from nickname / bio / username using flags + country phrases.
 * @param {string} text
 * @param {{ allowUsernameTokens?: boolean }} [opts]
 * @returns {string|null}
 */
function inferRegionFromText(text, opts = {}) {
  const raw = String(text || "");
  if (!raw.trim()) return null;

  // Prefer GB flag / UK phrases before other listed flags.
  if (hasUkFlagEmoji(raw) || GB_NAME_RE.test(raw)) return "GB";

  for (const [flag, code] of Object.entries(FLAG_TO_REGION)) {
    if (flag === "🇬🇧") continue;
    if (raw.includes(flag)) return code;
  }

  // Unlisted flag emoji → generic non-GB.
  if (hasFlagEmoji(raw)) return "XX";

  if (NON_GB_NAME_RE.test(raw)) {
    const m = raw.match(NON_GB_NAME_RE);
    if (m) {
      const token = m[1].toLowerCase().replace(/\./g, "");
      if (/german|deutschland/.test(token)) return "DE";
      if (/dubai|uae|united arab/.test(token)) return "AE";
      if (/egypt/.test(token)) return "EG";
      if (/brazil|brasil/.test(token)) return "BR";
      if (/pakistan/.test(token)) return "PK";
      if (/india/.test(token)) return "IN";
      if (/france/.test(token)) return "FR";
      if (/usa|united states|america/.test(token)) return "US";
      if (/ukraine/.test(token)) return "UA";
      // Any other matched non-GB phrase → generic non-GB marker
      return "XX";
    }
  }

  if (opts.allowUsernameTokens !== false) {
    if (USERNAME_GB_RE.test(raw)) return "GB";
    if (USERNAME_NON_GB_RE.test(raw)) return "XX";
  }

  return null;
}

function isGbRegion(region) {
  const normalized = normalizeRegion(region);
  if (!normalized) return false;
  return GB_ALIASES.has(normalized) || UK_REGION_CODES.has(normalized);
}

function isNonGbRegion(region) {
  const normalized = normalizeRegion(region);
  if (!normalized) return false;
  if (normalized === "XX") return true;
  return !isGbRegion(normalized);
}

function isUnknownRegion(region) {
  return normalizeRegion(region) == null;
}

/**
 * Positive UK/GB evidence required for ingest.
 * @param {{
 *   region?: string|null,
 *   displayName?: string,
 *   username?: string,
 *   bio?: string,
 * }} candidate
 * @returns {boolean}
 */
function hasPositiveGbEvidence(candidate = {}) {
  const region = normalizeRegion(candidate.region);
  if (isGbRegion(region)) return true;

  const displayName = candidate.displayName || "";
  const username = candidate.username || "";
  const bio = candidate.bio || "";
  const blob = [displayName, username, bio].filter(Boolean).join(" ");

  if (hasUkFlagEmoji(blob)) return true;
  if (GB_NAME_RE.test(blob)) return true;
  if (USERNAME_GB_RE.test(username) || USERNAME_GB_RE.test(blob)) return true;

  const hint = inferRegionFromText(blob, { allowUsernameTokens: true });
  return isGbRegion(hint);
}

/**
 * Confirmed non-GB signal (for denylist learning — not mere unknown).
 */
function hasConfirmedNonGbEvidence(candidate = {}) {
  const region = normalizeRegion(candidate.region);
  if (isNonGbRegion(region)) return true;

  const displayName = candidate.displayName || "";
  const username = candidate.username || "";
  const bio = candidate.bio || "";
  const blob = [displayName, username, bio].filter(Boolean).join(" ");

  if (hasNonUkFlagEmoji(blob)) return true;
  if (hasNonEnglishScript(displayName) || hasNonEnglishScript(bio)) return true;

  const hint = inferRegionFromText(blob, { allowUsernameTokens: true });
  return Boolean(hint && isNonGbRegion(hint));
}

/**
 * Confirmed GB for Get leads: trusted API country GB/UK/GBR, or UK flag.
 * Not feed_gb / text_gb / city / bare-uk guesses.
 */
function isConfirmedGbEvidence(candidate = {}) {
  if (hasConfirmedNonGbEvidence(candidate)) return false;

  const displayName = candidate.displayName || "";
  const username = candidate.username || "";
  const bio = candidate.bio || "";
  const blob = [displayName, username, bio].filter(Boolean).join(" ");
  if (hasUkFlagEmoji(blob)) return true;

  const source = String(candidate.regionSource || "");
  if (source === "feed_gb" || source === "text_gb") return false;

  return isGbRegion(candidate.region);
}

/**
 * Ingest decision for New queue (status tagging only — prefer shouldSkipIngest).
 * @returns {null | "unsupported_region"}
 */
function classifyRegionStatus(region) {
  if (isNonGbRegion(region)) return "unsupported_region";
  return null;
}

/**
 * Fresh-scrape gate:
 * - Always skip evidenced non-GB
 * - Keep confirmed GB (API country / UK flag)
 * - Keep clean unknowns only when marked feed_gb (UK-first fallback when
 *   TikTok omits country on signed lookups)
 * @param {{
 *   region?: string|null,
 *   regionSource?: string|null,
 *   displayName?: string,
 *   username?: string,
 *   bio?: string,
 * }} candidate
 * @returns {boolean}
 */
function shouldSkipIngest(candidate = {}) {
  const displayName = candidate.displayName || "";
  const username = candidate.username || "";
  const bio = candidate.bio || "";
  const profileBlob = [displayName, username, bio].filter(Boolean).join(" ");

  if (hasNonEnglishScript(displayName) || hasNonEnglishScript(bio)) return true;
  if (hasNonUkFlagEmoji(profileBlob)) return true;
  if (NON_GB_NAME_RE.test(profileBlob) || USERNAME_NON_GB_RE.test(username)) {
    return true;
  }

  const region = normalizeRegion(candidate.region) || candidate.region || null;
  if (isNonGbRegion(region)) return true;

  const hint = inferRegionFromText(profileBlob, { allowUsernameTokens: true });
  if (hint && isNonGbRegion(hint)) return true;

  if (isConfirmedGbEvidence({ ...candidate, region })) return false;

  // UK-first fallback marker from Chrome scrape when country APIs are dark.
  if (
    String(candidate.regionSource || "") === "feed_gb" &&
    !isNonGbRegion(region)
  ) {
    return false;
  }

  return true;
}

/**
 * Pick best region from webcast room/owner (and optional extra fields).
 */
function pickRegionFromOwnerRoom(room, owner) {
  const primary = [
    owner?.region,
    owner?.country,
    owner?.country_code,
    owner?.countryCode,
    owner?.store_region,
    owner?.storeRegion,
    owner?.priority_region,
    owner?.priorityRegion,
    room?.region,
    room?.country,
    room?.country_code,
    room?.countryCode,
    room?.owner_region,
    room?.ownerRegion,
  ];

  for (const value of primary) {
    const normalized = normalizeRegion(value);
    if (normalized) return normalized;
  }

  // Never use owner/room locale or language — those mirror the viewer
  // (we force en-GB) and were falsely admitting foreign creators as GB.

  // Nickname / bio / title: UK flag or country name, or clear non-GB signals.
  const textBlob = [
    owner?.nickname,
    owner?.signature,
    owner?.bio,
    owner?.display_id,
    owner?.unique_id,
    room?.title,
    room?.content_tag,
  ]
    .filter(Boolean)
    .join(" ");
  const fromText = inferRegionFromText(textBlob, { allowUsernameTokens: false });
  if (fromText) return fromText;

  // Username-only tokens as last resort (.uk / brazil… / etc.).
  const handle = String(
    owner?.display_id || owner?.unique_id || owner?.uniqueId || owner?.username || ""
  );
  const fromHandle = inferRegionFromText(handle, { allowUsernameTokens: true });
  if (fromHandle) return fromHandle;

  return null;
}

module.exports = {
  normalizeRegion,
  isGbRegion,
  isNonGbRegion,
  isUnknownRegion,
  classifyRegionStatus,
  shouldSkipIngest,
  hasPositiveGbEvidence,
  hasConfirmedNonGbEvidence,
  isConfirmedGbEvidence,
  hasFlagEmoji,
  hasUkFlagEmoji,
  hasNonUkFlagEmoji,
  hasNonEnglishScript,
  inferRegionFromText,
  pickRegionFromOwnerRoom,
  GB_ALIASES,
  FEED_GB_SOURCE,
};
