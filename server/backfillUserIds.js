const store = require("./store");
const { resolveProfileFromUsername } = require("./resolveUserId");

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_DELAY_MS = 200;
/** Skip re-resolving the same handle for a while after a failed scrape. */
const FAIL_COOLDOWN_MS = 6 * 60 * 60 * 1000;

let running = false;
let started = false;
const failedAt = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function recentlyFailed(username) {
  const key = String(username || "").toLowerCase();
  const at = failedAt.get(key);
  if (!at) return false;
  if (Date.now() - at < FAIL_COOLDOWN_MS) return true;
  failedAt.delete(key);
  return false;
}

async function mapPool(items, concurrency, worker) {
  let index = 0;

  async function run() {
    while (index < items.length) {
      const current = index;
      index += 1;
      await worker(items[current], current);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => run())
  );
}

/**
 * Resolve missing numeric TikTok uids + regions via public profile HTML.
 * Safe to call multiple times; only one backfill runs at a time.
 */
async function backfillMissingUserIds(options = {}) {
  if (running) return { skipped: true, reason: "already_running" };
  running = true;

  const concurrency = Number.isFinite(options.concurrency)
    ? Math.max(1, options.concurrency)
    : DEFAULT_CONCURRENCY;
  const delayMs = Number.isFinite(options.delayMs) ? Math.max(0, options.delayMs) : DEFAULT_DELAY_MS;
  const limit = Number.isFinite(options.limit) ? Math.max(0, options.limit) : null;

  try {
    // Public profiles rarely expose creator region anymore; still parse it when
    // present on the same fetch used for missing uids. Avoid region-only storms.
    let missing = store
      .leadsMissingUserId()
      .filter((lead) => !recentlyFailed(lead.username));

    if (limit != null) missing = missing.slice(0, limit);
    if (!missing.length) {
      return { skipped: false, attempted: 0, resolved: 0, updated: 0, regions: 0 };
    }

    console.log(
      `[profile backfill] resolving ${missing.length} lead(s) (uid; region if present)…`
    );

    let resolvedCount = 0;
    let updatedTotal = 0;
    let regionsUpdated = 0;
    // Serialize disk writes — concurrent apply* would race on leads.json.
    let writeChain = Promise.resolve();
    const enqueue = (fn) => {
      writeChain = writeChain.then(fn);
      return writeChain;
    };

    await mapPool(missing, concurrency, async (lead) => {
      try {
        const profile = await resolveProfileFromUsername(lead.username);
        const key = String(lead.username || "").toLowerCase();
        if (profile.userId || profile.region) {
          resolvedCount += 1;
          failedAt.delete(key);
          await enqueue(() => {
            if (profile.userId) {
              const applied = store.applyUserIds([
                { username: lead.username, userId: profile.userId },
              ]);
              updatedTotal += applied.updated;
            }
            if (profile.region) {
              const applied = store.applyRegions([
                { username: lead.username, region: profile.region },
              ]);
              regionsUpdated += applied.updated;
              updatedTotal += applied.updated;
            }
          });
        } else {
          failedAt.set(key, Date.now());
        }
      } catch (error) {
        failedAt.set(String(lead.username || "").toLowerCase(), Date.now());
        console.warn(
          `[profile backfill] skip @${lead.username}:`,
          error && error.message ? error.message : error
        );
      }
      if (delayMs) await sleep(delayMs);
    });

    await writeChain;

    console.log(
      `[profile backfill] done — attempted ${missing.length}, resolved ${resolvedCount}, uid/region writes ${updatedTotal} (regions ${regionsUpdated})`
    );
    return {
      skipped: false,
      attempted: missing.length,
      resolved: resolvedCount,
      updated: updatedTotal,
      regions: regionsUpdated,
    };
  } catch (error) {
    console.error("[profile backfill] error:", error && error.message ? error.message : error);
    return { skipped: false, attempted: 0, resolved: 0, updated: 0, regions: 0, error: String(error) };
  } finally {
    running = false;
  }
}

function startUserIdBackfill(options = {}) {
  if (started && !options.force) return;
  started = true;
  const delay = Number.isFinite(options.startDelayMs) ? options.startDelayMs : 1500;
  setTimeout(() => {
    backfillMissingUserIds(options).catch((error) => {
      console.error("[profile backfill] failed:", error.message || error);
    });
  }, delay);
}

module.exports = {
  backfillMissingUserIds,
  startUserIdBackfill,
};
