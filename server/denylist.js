/**
 * Known non-available TikTok Live agency backstage outcomes.
 * Static lists + learned denylist (data/learned-denylist.json).
 * normalize: lowercase, strip leading @
 */

const fs = require("fs");
const path = require("path");

const DROP_STATUS = "nonexistent";
const MANUAL_TEST_RE = /^manual_test_user_/i;

/** Statuses that may be overwritten by a denylist tag on ingest/backfill. */
const OVERWRITABLE_STATUSES = new Set(["new", "", null, undefined]);

/**
 * Statuses taught into the learned denylist (never re-enter New).
 * Includes CRM progress (contacted, etc.) and erase tombstones — not only
 * Backstage rejects — so erase-all / status marks survive the next scrape.
 */
const LEARN_STATUSES = new Set([
  "unsupported_region",
  "ineligible",
  "in_network",
  "premium_invite_required",
  "contacted",
  "not_interested",
  "declined",
  "dms_off",
  "applied",
  "approved_joined",
  "inactive_lost",
  /** Erased while still `new` — block re-add without implying a CRM outcome. */
  "erased",
]);

/** Internal tombstone only — not a user-facing CRM filter chip. */
const TOMBSTONE_STATUS = "erased";

const LEARNED_PATH = path.join(__dirname, "..", "data", "learned-denylist.json");

const unsupported_region = [
  "khan.blouch216",
  "mahanoor0951",
  "wizzwizzgame",
  "thu2677",
  "raiven.hn",
  "33usercass",
  "lawrence.alangi",
  "reelscenez0",
  "cute.family760",
  "remzo.elgg0",
  "afridibhaifrance",
  "fileclosed801",
  "unheartlessly",
  "dubaiwali_88",
  "ilovegautamela",
  "silent_soule0",
  "mamdouhsalameh",
  "haniya.khan6002",
  "hasnain.khanloveh0",
  "m.shani.live",
  "mano_arain7",
  "malik_uae33",
  "queenrajpoot.786",
  "bartfrankliny772",
  "pyaribachi20",
  "sheikhhamdan228",
  "j.jessica.69",
  "diehurt4",
  "typicalgamer",
  "nbqpx",
  "xanderse18445",
  "makimetadel6",
  "suhuur214",
  "leke9l",
  "cute.pathani7860",
  "javed.ki.shahzadi.s.h",
  "zahwani_zahwani",
  "stiffgaming811",
  "user6869787613356",
  "fairytale0600",
  "kurdm.81",
  "nostalgiaboom",
  "dreamlikemuskelon",
  "heuakirax",
  "modar_yaz_74",
  "adam.alnimer",
  "aftabislive5",
  "ibn.mohammad5",
  "_ahmadviki",
  "jungle.billi01",
  "queendomrealness",
  "areeba_tariq01",
  "betsu_2121",
  "ledar541",
  "la____210",
  "wwwsoha1",
  "brasileira.na.esp",
  "zk.funny6",
  "jisuvvy",
  "dyaahayur",
  "dapsrobloxvol2",
  "user1624083797118",
  "iamalessandria",
  "olthn0",
  "eva18tn",
  "hiku4888",
  "user173072328",
  "testqatadnnbxc",
  "roz.zhrr",
  "coco188880",
];

const premium_invite_required = [
  "tedyam001594",
  "buduoriginal3d",
  "look.at.that2",
  "munir_shakir_official",
  "dcitak2",
  "o0rvii",
];

const in_network = [
  "g1ynn_on_roller",
  "nataliasikora1108",
  "hamzalive401",
  "heeruk997",
  "ehtisham7388",
  "lucas1984528_",
  "skitcod",
  "dbd.boo",
  "abbie.rosser",
  "d1z.2trappy",
  "axon2026",
  ".geet.kaur",
  "missbuttercup33",
  "olotu08",
  "kingzaina1220z",
  "kaneehlen",
  "therealchuka",
  "willhickslifts",
  "jssolly",
  "rani_rani89",
  "jay_evans0",
  "msbaba2020",
  "jamiethegee_",
  "boss_cali1",
  "hanzala.shahh",
  "pr1_rehan_16",
  "kye.virdee",
  "colombianaitaliana2",
  "notraxy",
  "_therealconnor",
  "gem1n1butterfly",
  "julliet_jolly",
  "mlxiiaa",
  "sophiamarie.xx",
  "malikontiktok2002",
  "nexurrl",
  "ladivamillion",
  "they_call_me_meelan",
  ".coban.krali.nemrut",
  "sashaawais",
  "kylatmf",
  "ukfayra",
  "wxn4157",
  "smurfyonone.wba93",
  "hamid15smp",
  "uvdyl4nvu",
  ".destinykpsychicmedium",
  "hajy_gian",
  "logan.musicc",
  "01204l1",
  "kingkreams",
  "maddy_gammer",
  "heeray097",
  "_tropiccfear_",
  "jkirbpolo",
];

const ineligible = [
  "icolewvzp3o",
  "queenbdontgiveaf",
  "peparonypeezah7",
  "daisyymayxz",
  "s1_66x",
  "emilllyyy_x",
  "sahiba_khan1708",
  "shemxebi",
  "gh1aahbw03",
  "damoe_westwood",
  "thepersianchristian",
  "s_soo2007",
  "jamielurinsky",
  "valentino_irl",
  "lejaune.x",
  "miss.siaentua",
  "mr__khan504",
  "no_tawel_girl",
  "annaya.real",
  "yaboybannedagain",
  "isrargondal35",
  "abohimaaa1",
  "tye_96",
  "mohanovic5",
  "ziziabrinkamara",
  "im_erickson01",
  "nasyali7",
  "zille_amna888",
  "ameeralroohv",
  "i119466",
  ".nariman.muhamed",
  "afghan..34",
  "enjoyurdrink",
  "sikandarchoudhry007",
  "hola4alan",
  "eljnvepzn9",
  "garythompson6184",
  "warsay150",
  "alloush_196",
  "kelseyspendiff1",
  "ninja_ninja008",
  "sy10166",
  "avalonx8",
  "nevaehxxsant1",
  "wplexy",
  "chesteryiu89",
];

const nonexistent = [
  "manual_test_user_1784083562345_2",
  "manual_test_user_1784083562345_1",
  "manual_test_user_1784083562345_0",
];

function normalizeUsername(username) {
  return String(username || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

function buildMap(entries, status) {
  const map = new Map();
  for (const raw of entries) {
    const key = normalizeUsername(raw);
    if (key) map.set(key, status);
  }
  return map;
}

const STATUS_BY_USERNAME = new Map([
  ...buildMap(unsupported_region, "unsupported_region"),
  ...buildMap(premium_invite_required, "premium_invite_required"),
  ...buildMap(in_network, "in_network"),
  ...buildMap(ineligible, "ineligible"),
  ...buildMap(nonexistent, DROP_STATUS),
]);

/** @type {Map<string, string>|null} */
let learnedMap = null;

function ensureLearnedDir() {
  const dir = path.dirname(LEARNED_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadLearnedMap() {
  if (learnedMap) return learnedMap;
  learnedMap = new Map();
  try {
    if (!fs.existsSync(LEARNED_PATH)) return learnedMap;
    const data = JSON.parse(fs.readFileSync(LEARNED_PATH, "utf8"));
    const entries =
      data && typeof data.entries === "object" && data.entries
        ? data.entries
        : data && typeof data === "object"
          ? data
          : {};
    for (const [raw, status] of Object.entries(entries)) {
      if (raw === "entries") continue;
      if (!LEARN_STATUSES.has(status)) continue;
      const key = normalizeUsername(raw);
      if (key) learnedMap.set(key, status);
    }
  } catch {
    // Missing / corrupt file → empty learned map.
  }
  return learnedMap;
}

function persistLearnedMap() {
  const map = loadLearnedMap();
  const entries = {};
  for (const [username, status] of [...map.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    entries[username] = status;
  }
  ensureLearnedDir();
  const tmp = `${LEARNED_PATH}.tmp`;
  fs.writeFileSync(
    tmp,
    JSON.stringify({ entries, updatedAt: new Date().toISOString() }, null, 2),
    "utf8"
  );
  fs.renameSync(tmp, LEARNED_PATH);
}

/**
 * Persist a Backstage-rejected username so future scrapes never put them in New.
 * @returns {boolean} true if the learned map changed
 */
function learnUsername(username, status) {
  if (!LEARN_STATUSES.has(status)) return false;
  const key = normalizeUsername(username);
  if (!key) return false;
  // Static list already covers this handle — no need to duplicate.
  if (STATUS_BY_USERNAME.has(key)) return false;
  const map = loadLearnedMap();
  if (map.get(key) === status) return false;
  map.set(key, status);
  persistLearnedMap();
  return true;
}

/**
 * Remove a learned denylist entry (e.g. false inactive_lost from unknown L30).
 * Does not touch static lists.
 * @returns {boolean} true if the learned map changed
 */
function unlearnUsername(username) {
  const key = normalizeUsername(username);
  if (!key) return false;
  const map = loadLearnedMap();
  if (!map.has(key)) return false;
  map.delete(key);
  persistLearnedMap();
  return true;
}

/**
 * Drop learned inactive_lost tombstones that contradict unknown-L30-keep:
 * cache says masked / missing L30 (not a known value under the inactive floor).
 * Leaves true known-under-floor inactives and other CRM statuses alone.
 * @param {Record<string, { diamondsL30?: unknown, diamondsL28?: unknown, masked?: boolean }>|Map<string, object>} cacheEntries
 * @returns {{ removed: number, total: number }}
 */
function unlearnFalseInactiveFromCache(cacheEntries) {
  const map = loadLearnedMap();
  let removed = 0;
  const entries =
    cacheEntries instanceof Map
      ? cacheEntries
      : cacheEntries && typeof cacheEntries === "object"
        ? new Map(Object.entries(cacheEntries))
        : null;
  if (!entries || !entries.size) return { removed: 0, total: map.size };

  for (const [rawUser, row] of entries.entries()) {
    const key = normalizeUsername(rawUser);
    if (!key || map.get(key) !== "inactive_lost") continue;
    if (!row || typeof row !== "object") continue;
    const raw =
      row.diamondsL30 != null
        ? row.diamondsL30
        : row.diamondsL28 != null
          ? row.diamondsL28
          : null;
    const known =
      raw != null && raw !== "" && Number.isFinite(Number(raw));
    // Unknown / masked → should never have been inactive_lost.
    if (row.masked || !known) {
      map.delete(key);
      removed += 1;
    }
  }
  if (removed) persistLearnedMap();
  return { removed, total: map.size };
}

/**
 * Merge many username→status pairs into the learned denylist (one write).
 * @param {Array<{ username: string, status: string }>} items
 */
function learnMany(items) {
  if (!Array.isArray(items) || !items.length) return { added: 0, total: loadLearnedMap().size };
  const map = loadLearnedMap();
  let added = 0;
  for (const item of items) {
    const status = item && item.status;
    if (!LEARN_STATUSES.has(status)) continue;
    const key = normalizeUsername(item.username);
    if (!key) continue;
    if (STATUS_BY_USERNAME.has(key)) continue;
    if (map.get(key) === status) continue;
    map.set(key, status);
    added += 1;
  }
  if (added) persistLearnedMap();
  return { added, total: map.size };
}

/** Seed learned denylist from existing leads already in learn statuses. */
function backfillLearnedFromLeads(leads) {
  if (!Array.isArray(leads)) return { added: 0, total: loadLearnedMap().size };
  return learnMany(
    leads
      .filter((lead) => lead && LEARN_STATUSES.has(lead.status))
      .map((lead) => ({ username: lead.username, status: lead.status }))
  );
}

/**
 * @param {string} username
 * @returns {null | string} denylist / learned block status
 */
function classifyUsername(username) {
  const key = normalizeUsername(username);
  if (!key) return null;
  if (MANUAL_TEST_RE.test(key)) return DROP_STATUS;
  const fromStatic = STATUS_BY_USERNAME.get(key);
  if (fromStatic) return fromStatic;
  return loadLearnedMap().get(key) || null;
}

function shouldDropUsername(username) {
  const status = classifyUsername(username);
  return status === DROP_STATUS || status === TOMBSTONE_STATUS;
}

/** True when existing lead status may be replaced by a denylist tag. */
function canApplyDenylistStatus(currentStatus) {
  if (currentStatus == null || currentStatus === "") return true;
  return OVERWRITABLE_STATUSES.has(currentStatus);
}

/**
 * Statuses that may be written onto a lead row from denylist backfill.
 * Tombstones / drop stay out of the CRM list — they only block ingest.
 */
function canPersistDenylistStatus(status) {
  return Boolean(status) && status !== DROP_STATUS && status !== TOMBSTONE_STATUS;
}

module.exports = {
  DROP_STATUS,
  TOMBSTONE_STATUS,
  LEARN_STATUSES,
  LEARNED_PATH,
  classifyUsername,
  shouldDropUsername,
  canApplyDenylistStatus,
  canPersistDenylistStatus,
  normalizeUsername,
  learnUsername,
  unlearnUsername,
  unlearnFalseInactiveFromCache,
  learnMany,
  backfillLearnedFromLeads,
};
