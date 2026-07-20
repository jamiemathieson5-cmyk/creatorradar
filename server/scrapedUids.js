/**
 * Permanent registry of TikTok numeric user IDs ever seen/ingested.
 * Survives erase-all (clearLeads). Used so an account is never scraped again.
 */

const fs = require("fs");
const path = require("path");
const { normalizeUserId } = require("./resolveUserId");

const DATA_DIR = path.join(__dirname, "..", "data");
const SCRAPED_UIDS_PATH = path.join(DATA_DIR, "scraped-uids.json");

/** @type {Set<string>|null} */
let cache = null;
let dirty = false;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadFromDisk() {
  try {
    if (!fs.existsSync(SCRAPED_UIDS_PATH)) return new Set();
    const data = JSON.parse(fs.readFileSync(SCRAPED_UIDS_PATH, "utf8"));
    const list = Array.isArray(data?.uids) ? data.uids : Array.isArray(data) ? data : [];
    const set = new Set();
    for (const value of list) {
      const uid = normalizeUserId(value);
      if (uid) set.add(uid);
    }
    return set;
  } catch {
    return new Set();
  }
}

function getSet() {
  if (!cache) cache = loadFromDisk();
  return cache;
}

function persist() {
  if (!dirty || !cache) return;
  ensureDataDir();
  const uids = [...cache].sort();
  const tmp = `${SCRAPED_UIDS_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ uids }, null, 2), "utf8");
  fs.renameSync(tmp, SCRAPED_UIDS_PATH);
  dirty = false;
}

function hasScrapedUid(userId) {
  const uid = normalizeUserId(userId);
  if (!uid) return false;
  return getSet().has(uid);
}

/**
 * Add one or more numeric UIDs. Returns how many were newly recorded.
 * Flushes to disk when anything changed.
 */
function recordScrapedUids(userIds) {
  const list = Array.isArray(userIds) ? userIds : [userIds];
  const set = getSet();
  let added = 0;
  for (const value of list) {
    const uid = normalizeUserId(value);
    if (!uid || set.has(uid)) continue;
    set.add(uid);
    added += 1;
  }
  if (added) {
    dirty = true;
    persist();
  }
  return added;
}

/** Seed registry from existing leads (any status). Idempotent. */
function seedScrapedUidsFromLeads(leads) {
  if (!Array.isArray(leads) || !leads.length) return { added: 0, total: getSet().size };
  const uids = leads.map((lead) => lead?.userId);
  const added = recordScrapedUids(uids);
  return { added, total: getSet().size };
}

function scrapedUidCount() {
  return getSet().size;
}

function scrapedUidsPath() {
  return SCRAPED_UIDS_PATH;
}

module.exports = {
  hasScrapedUid,
  recordScrapedUids,
  seedScrapedUidsFromLeads,
  scrapedUidCount,
  scrapedUidsPath,
  SCRAPED_UIDS_PATH,
};
