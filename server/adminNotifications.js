const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "..", "data");
const NOTIFICATIONS_PATH = path.join(DATA_DIR, "admin-notifications.json");
const MAX_NOTIFICATIONS = 150;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readStore() {
  try {
    if (!fs.existsSync(NOTIFICATIONS_PATH)) {
      return { notifications: [] };
    }
    const data = JSON.parse(fs.readFileSync(NOTIFICATIONS_PATH, "utf8"));
    const list = Array.isArray(data?.notifications) ? data.notifications : [];
    return { notifications: list };
  } catch {
    return { notifications: [] };
  }
}

function writeStore(store) {
  ensureDataDir();
  const tmp = `${NOTIFICATIONS_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
  fs.renameSync(tmp, NOTIFICATIONS_PATH);
}

/**
 * @param {{ type: string, title: string, detail?: string, meta?: object }} input
 */
function addNotification(input) {
  const type = String(input?.type || "info").trim() || "info";
  const title = String(input?.title || "").trim();
  if (!title) return null;

  const store = readStore();
  const notification = {
    id: crypto.randomUUID(),
    type,
    title,
    detail: input?.detail ? String(input.detail) : null,
    meta: input?.meta && typeof input.meta === "object" ? input.meta : null,
    createdAt: new Date().toISOString(),
    readAt: null,
  };

  store.notifications.unshift(notification);
  if (store.notifications.length > MAX_NOTIFICATIONS) {
    store.notifications = store.notifications.slice(0, MAX_NOTIFICATIONS);
  }
  writeStore(store);
  return notification;
}

function listNotifications({ limit = 50 } = {}) {
  const store = readStore();
  const capped = Math.min(Math.max(Number(limit) || 50, 1), MAX_NOTIFICATIONS);
  const notifications = store.notifications.slice(0, capped);
  const unreadCount = store.notifications.filter((n) => !n.readAt).length;
  return {
    notifications,
    unreadCount,
    total: store.notifications.length,
  };
}

/**
 * Mark notifications read. Pass ids for specific items, or omit/empty to mark all.
 * @param {string[]|null|undefined} ids
 */
function markRead(ids) {
  const store = readStore();
  const now = new Date().toISOString();
  const idSet =
    Array.isArray(ids) && ids.length
      ? new Set(ids.map((id) => String(id)))
      : null;

  let marked = 0;
  for (const n of store.notifications) {
    if (n.readAt) continue;
    if (idSet && !idSet.has(n.id)) continue;
    n.readAt = now;
    marked += 1;
  }

  if (marked) writeStore(store);
  const unreadCount = store.notifications.filter((n) => !n.readAt).length;
  return { marked, unreadCount };
}

/** Wipe notification history (admin “Clear history”). */
function clearNotifications() {
  const store = readStore();
  const cleared = store.notifications.length;
  writeStore({ notifications: [] });
  return { cleared, unreadCount: 0, total: 0 };
}

function notifyLeadsCollected(result) {
  if (!result || result.skipped) return null;
  if (result.ok === false || result.error) {
    return addNotification({
      type: "leads_collect_failed",
      title: "Lead collection failed",
      detail: String(result.error || "Unknown error"),
      meta: { errorCode: result.errorCode || null },
    });
  }
  const added = Number(result.added) || 0;
  return addNotification({
    type: "leads_collected",
    title:
      added > 0
        ? `Collected ${added} lead${added === 1 ? "" : "s"}`
        : "Lead collection finished (0 new)",
    detail: result.source
      ? `Source: ${result.source}${result.notice ? ` — ${result.notice}` : ""}`
      : result.notice || null,
    meta: {
      added,
      seen: result.seen || 0,
      source: result.source || null,
    },
  });
}

function notifyLeadsErased({ cleared } = {}) {
  const n = Number(cleared) || 0;
  return addNotification({
    type: "leads_erased",
    title: n ? `Erased ${n} lead${n === 1 ? "" : "s"}` : "Erased all leads",
    detail: "CRM tombstones kept so erased handles won’t return as New.",
    meta: { cleared: n },
  });
}

function notifyUserCreated({ username } = {}) {
  const handle = String(username || "").replace(/^@+/, "") || "user";
  return addNotification({
    type: "user_created",
    title: `User account created: @${handle}`,
    detail: "Issued via admin Invite / Create user.",
    meta: { username: handle },
  });
}

function notifyUserDeleted({ username, leadsReturnedToPool } = {}) {
  const handle = String(username || "").replace(/^@+/, "") || "user";
  const returned = Number(leadsReturnedToPool) || 0;
  return addNotification({
    type: "user_deleted",
    title: `User account closed: @${handle}`,
    detail: returned
      ? `${returned} lead${returned === 1 ? "" : "s"} returned to the pool.`
      : "No assigned leads to return.",
    meta: { username: handle, leadsReturnedToPool: returned },
  });
}

function notifyLeadsDistributed({ username, assigned, remainingPool } = {}) {
  const handle = String(username || "").replace(/^@+/, "") || "user";
  const n = Number(assigned) || 0;
  if (!n) {
    return addNotification({
      type: "leads_distributed",
      title: `No leads assigned to @${handle}`,
      detail: "Pool had no matching unassigned leads.",
      meta: { username: handle, assigned: 0, remainingPool: remainingPool ?? null },
    });
  }
  return addNotification({
    type: "leads_distributed",
    title: `Assigned ${n} lead${n === 1 ? "" : "s"} to @${handle}`,
    detail:
      remainingPool != null
        ? `${remainingPool} New left in pool.`
        : null,
    meta: { username: handle, assigned: n, remainingPool: remainingPool ?? null },
  });
}

module.exports = {
  addNotification,
  listNotifications,
  markRead,
  clearNotifications,
  notifyLeadsCollected,
  notifyLeadsErased,
  notifyUserCreated,
  notifyUserDeleted,
  notifyLeadsDistributed,
  MAX_NOTIFICATIONS,
  NOTIFICATIONS_PATH,
};
