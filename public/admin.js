const STATUS_ORDER = [
  "new",
  "contacted",
  "in_network",
  "ineligible",
  "unsupported_region",
  "premium_invite_required",
  "not_interested",
  "declined",
  "dms_off",
  "applied",
  "approved_joined",
  "inactive_lost",
  "all",
];

const DEFAULT_LABELS = {
  all: "All",
  new: "New",
  contacted: "Contacted",
  in_network: "In a network",
  ineligible: "Ineligible",
  unsupported_region: "Unsupported region",
  premium_invite_required: "Premium invite required",
  not_interested: "Not interested",
  declined: "Declined",
  dms_off: "DMs off - could not contact",
  applied: "Applied",
  approved_joined: "Approved / joined",
  inactive_lost: "Inactive / lost",
};

const els = {
  metaTotal: document.getElementById("meta-total"),
  metaPool: document.getElementById("meta-pool"),
  metaMode: document.getElementById("meta-mode"),
  metaProxy: document.getElementById("meta-proxy"),
  metaRefresh: document.getElementById("meta-refresh"),
  proxyHint: document.getElementById("proxy-hint"),
  errorBanner: document.getElementById("error-banner"),
  refreshBtn: document.getElementById("refresh-btn"),
  clearLeadsBtn: document.getElementById("clear-leads-btn"),
  copyLeadsBtn: document.getElementById("copy-leads-btn"),
  logoutBtn: document.getElementById("logout-btn"),
  adminChip: document.getElementById("admin-chip"),
  notifyRoot: document.getElementById("admin-notify"),
  notifyBtn: document.getElementById("notify-btn"),
  notifyBadge: document.getElementById("notify-badge"),
  notifyPanel: document.getElementById("notify-panel"),
  notifyList: document.getElementById("notify-list"),
  notifyEmpty: document.getElementById("notify-empty"),
  notifyMarkRead: document.getElementById("notify-mark-read"),
  statGrid: document.getElementById("stat-grid"),
  statusBreakdown: document.getElementById("status-breakdown"),
  distributeForm: document.getElementById("distribute-form"),
  distributeUser: document.getElementById("distribute-user"),
  distributeStatus: document.getElementById("distribute-status"),
  distributeCount: document.getElementById("distribute-count"),
  distributeBtn: document.getElementById("distribute-btn"),
  createUserForm: document.getElementById("create-user-form"),
  createUsername: document.getElementById("create-username"),
  createPassword: document.getElementById("create-password"),
  createUserBtn: document.getElementById("create-user-btn"),
  createUserResult: document.getElementById("create-user-result"),
  assignTbody: document.getElementById("assign-tbody"),
  usersEmpty: document.getElementById("users-empty"),
  statusFilters: document.getElementById("status-filters"),
  leadSearch: document.getElementById("lead-search"),
  leadList: document.getElementById("lead-list"),
  leadsEmpty: document.getElementById("leads-empty"),
  toast: document.getElementById("toast"),
};

const state = {
  filter: "new",
  searchQuery: "",
  leads: [],
  overview: null,
  meta: null,
  statusLabels: { ...DEFAULT_LABELS },
  notifications: [],
  unreadCount: 0,
  notifyOpen: false,
};

let toastTimer = null;

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    credentials: "same-origin",
    cache: "no-store",
    ...options,
  });
  if (response.status === 401 || response.status === 403) {
    window.location.href = "/?login=1";
    throw new Error("Admin authentication required.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || data.reason || `Request failed (${response.status})`);
  }
  return data;
}

function showToast(message, { ms = 4200 } = {}) {
  if (!message || !els.toast) return;
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  els.toast.classList.add("is-visible");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.classList.remove("is-visible");
    toastTimer = setTimeout(() => {
      els.toast.classList.add("hidden");
      els.toast.textContent = "";
      toastTimer = null;
    }, 220);
  }, ms);
}

function showError(message) {
  if (!els.errorBanner) return;
  if (!message) {
    els.errorBanner.classList.add("hidden");
    els.errorBanner.textContent = "";
    return;
  }
  els.errorBanner.textContent = message;
  els.errorBanner.classList.remove("hidden");
}

function labelFor(status) {
  return state.statusLabels[status] || DEFAULT_LABELS[status] || status;
}

function formatWhen(iso) {
  if (!iso) return "never";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRelative(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  const ms = date.getTime();
  if (Number.isNaN(ms)) return "";
  const diffSec = Math.round((Date.now() - ms) / 1000);
  if (diffSec < 45) return "just now";
  if (diffSec < 3600) {
    const m = Math.round(diffSec / 60);
    return `${m}m ago`;
  }
  if (diffSec < 86400) {
    const h = Math.round(diffSec / 3600);
    return `${h}h ago`;
  }
  const d = Math.round(diffSec / 86400);
  if (d < 7) return `${d}d ago`;
  return formatWhen(iso);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderNotifications() {
  if (!els.notifyList || !els.notifyBadge) return;
  const unread = Number(state.unreadCount) || 0;
  if (unread > 0) {
    els.notifyBadge.textContent = unread > 99 ? "99+" : String(unread);
    els.notifyBadge.classList.remove("hidden");
  } else {
    els.notifyBadge.textContent = "0";
    els.notifyBadge.classList.add("hidden");
  }

  const items = state.notifications || [];
  els.notifyList.innerHTML = "";
  if (els.notifyEmpty) {
    els.notifyEmpty.classList.toggle("hidden", items.length > 0);
  }
  for (const n of items) {
    const row = document.createElement("article");
    row.className = `admin-notify-item${n.readAt ? "" : " is-unread"}`;
    row.innerHTML = `
      <span class="title">${escapeHtml(n.title || "Notification")}</span>
      ${n.detail ? `<span class="detail">${escapeHtml(n.detail)}</span>` : ""}
      <span class="when">${escapeHtml(formatRelative(n.createdAt))}</span>
    `;
    els.notifyList.appendChild(row);
  }
}

async function loadNotifications() {
  const data = await api("/api/admin/notifications?limit=50");
  state.notifications = data.notifications || [];
  state.unreadCount = data.unreadCount || 0;
  renderNotifications();
  return data;
}

async function markNotificationsRead() {
  const data = await api("/api/admin/notifications/read", {
    method: "POST",
    body: JSON.stringify({}),
  });
  state.notifications = data.notifications || state.notifications;
  state.unreadCount = data.unreadCount || 0;
  renderNotifications();
}

function setNotifyOpen(open) {
  state.notifyOpen = Boolean(open);
  if (!els.notifyPanel || !els.notifyBtn) return;
  els.notifyPanel.classList.toggle("hidden", !state.notifyOpen);
  els.notifyBtn.setAttribute("aria-expanded", state.notifyOpen ? "true" : "false");
}

async function openNotifications() {
  setNotifyOpen(true);
  try {
    await loadNotifications();
    if (state.unreadCount > 0) {
      await markNotificationsRead();
    }
  } catch (error) {
    showToast(error.message || "Failed to load notifications");
  }
}

function closeNotifications() {
  setNotifyOpen(false);
}

function messageUrl(lead) {
  const uid = String(lead.userId || "").trim();
  if (/^\d{5,}$/.test(uid)) {
    return `https://www.tiktok.com/business-suite/messages?from=homepage&lang=en-GB&u=${uid}`;
  }
  const handle = String(lead.username || "")
    .trim()
    .replace(/^@+/, "");
  return handle ? `https://www.tiktok.com/@${handle}` : "https://www.tiktok.com/messages/";
}

function renderOverview() {
  const o = state.overview || {};
  const meta = state.meta || {};
  els.metaTotal.textContent = `${o.totalLeads ?? meta.totalLeads ?? 0} leads`;
  els.metaPool.textContent = `Pool (New): ${o.unassignedNew ?? 0}`;
  els.metaMode.textContent = `Mode: ${meta.scrapeMode || "tiktok_feed"}`;
  if (els.metaProxy) {
    els.metaProxy.textContent = meta.scrapeProxyConfigured
      ? `Proxy: on (${meta.scrapeProxyRedacted || "set"})`
      : "Proxy: not set";
  }
  if (els.proxyHint) {
    els.proxyHint.classList.toggle("is-warn", !meta.scrapeProxyConfigured);
  }
  els.metaRefresh.textContent = `Last refresh: ${formatWhen(meta.lastRefreshAt)}`;
  if (meta.lastRefreshError) {
    showError(meta.lastRefreshError);
  } else {
    showError("");
  }

  els.statGrid.innerHTML = "";
  const stats = [
    ["Total", o.totalLeads ?? 0],
    ["Unassigned", o.unassigned ?? 0],
    ["Pool New", o.unassignedNew ?? 0],
    ["Assigned users", (o.assignments || []).filter((a) => a.total > 0).length],
  ];
  for (const [label, value] of stats) {
    const card = document.createElement("div");
    card.className = "stat-card";
    card.innerHTML = `<span class="label">${label}</span><span class="value">${value}</span>`;
    els.statGrid.appendChild(card);
  }

  els.statusBreakdown.innerHTML = "";
  const byStatus = o.byStatus || {};
  for (const status of STATUS_ORDER) {
    if (status === "all") continue;
    const n = byStatus[status] || 0;
    if (!n) continue;
    const pill = document.createElement("span");
    pill.className = "status-pill";
    pill.textContent = `${labelFor(status)}: ${n}`;
    els.statusBreakdown.appendChild(pill);
  }
}

function renderUsers() {
  const assignments = state.overview?.assignments || [];
  const users = assignments.filter((a) => a.username);
  els.assignTbody.innerHTML = "";
  els.distributeUser.innerHTML = "";

  if (!users.length) {
    els.usersEmpty.classList.remove("hidden");
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No users yet";
    els.distributeUser.appendChild(opt);
    els.distributeBtn.disabled = true;
    return;
  }

  els.usersEmpty.classList.add("hidden");
  els.distributeBtn.disabled = false;

  for (const row of users) {
    const opt = document.createElement("option");
    opt.value = row.userId;
    opt.textContent = `@${row.username} (${row.total} assigned)`;
    els.distributeUser.appendChild(opt);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>@${row.username}</td>
      <td>${row.total}</td>
      <td>${row.byStatus?.new || 0}</td>
      <td>${row.byStatus?.contacted || 0}</td>
      <td>
        <button
          type="button"
          class="btn btn-danger btn-compact"
          data-delete-user="${row.userId}"
          data-delete-username="${row.username || ""}"
          data-delete-assigned="${row.total || 0}"
        >
          Close account
        </button>
      </td>
    `;
    const deleteBtn = tr.querySelector("[data-delete-user]");
    deleteBtn?.addEventListener("click", () => {
      closeUserAccount(row.userId, row.username, row.total || 0);
    });
    els.assignTbody.appendChild(tr);
  }
}

async function closeUserAccount(userId, username, assignedCount) {
  const handle = username || "user";
  const assignedNote = assignedCount
    ? `\n\nTheir ${assignedCount} assigned lead${assignedCount === 1 ? "" : "s"} will return to the unassigned pool (leads are kept).`
    : "\n\nThey have no assigned leads.";
  const ok = window.confirm(
    `Permanently close @${handle}?\n\nThis deletes the account and signs them out everywhere.${assignedNote}`
  );
  if (!ok) return;
  try {
    const result = await api(`/api/admin/users/${encodeURIComponent(userId)}`, {
      method: "DELETE",
    });
    if (result.overview) {
      state.overview = result.overview;
      renderOverview();
      renderUsers();
    } else {
      await loadOverview();
    }
    await loadLeads();
    const returned = result.leadsReturnedToPool || 0;
    showToast(
      returned
        ? `Closed @${handle} — ${returned} lead${returned === 1 ? "" : "s"} returned to pool`
        : `Closed @${handle}`
    );
    await loadNotifications().catch(() => {});
  } catch (error) {
    showToast(error.message || "Failed to close account.");
  }
}

function renderFilters() {
  const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0]));
  counts.all = state.leads.length;
  for (const lead of state.leads) {
    if (Object.prototype.hasOwnProperty.call(counts, lead.status)) {
      counts[lead.status] += 1;
    }
  }

  els.statusFilters.innerHTML = "";
  for (const status of STATUS_ORDER) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `filter-chip${state.filter === status ? " is-active" : ""}`;
    button.textContent = `${labelFor(status)} (${counts[status] || 0})`;
    button.addEventListener("click", () => {
      state.filter = status;
      renderFilters();
      renderLeads();
    });
    els.statusFilters.appendChild(button);
  }
}

function renderLeads() {
  const q = String(state.searchQuery || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
  let list = state.leads;
  if (state.filter !== "all") {
    list = list.filter((l) => l.status === state.filter);
  }
  if (q) {
    list = list.filter((l) =>
      String(l.username || "")
        .toLowerCase()
        .includes(q)
    );
  }

  els.leadList.innerHTML = "";
  if (!list.length) {
    els.leadsEmpty.classList.remove("hidden");
    return;
  }
  els.leadsEmpty.classList.add("hidden");

  const frag = document.createDocumentFragment();
  for (const lead of list) {
    const row = document.createElement("article");
    row.className = "lead-row";
    const handle = lead.username || "";
    const poolLabel = lead.assignedToUserId ? "assigned" : "pool";
    row.innerHTML = `
      <div class="lead-main">
        <div class="lead-head">
          <a class="lead-username" href="${lead.profileUrl || `https://www.tiktok.com/@${handle}`}" target="_blank" rel="noopener noreferrer">@${handle}</a>
          <span class="lead-meta">${poolLabel}</span>
        </div>
      </div>
      <div class="lead-controls">
        <label class="lead-status-field lead-quick-field">
          <span class="visually-hidden">Status</span>
          <select data-status-for="${lead.id}" aria-label="Status for @${handle}"></select>
        </label>
        <a class="btn btn-ghost" href="${lead.messageUrl || messageUrl(lead)}" target="_blank" rel="noopener noreferrer">Message</a>
      </div>
    `;
    const select = row.querySelector("select");
    for (const status of STATUS_ORDER) {
      if (status === "all") continue;
      const opt = document.createElement("option");
      opt.value = status;
      opt.textContent = labelFor(status);
      if (status === lead.status) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener("change", async () => {
      try {
        const { lead: updated } = await api(`/api/leads/${lead.id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: select.value }),
        });
        lead.status = updated.status;
        showToast(`@${handle} → ${labelFor(updated.status)}`);
        renderFilters();
        renderLeads();
        await loadOverview();
      } catch (error) {
        showToast(error.message);
        select.value = lead.status;
      }
    });
    frag.appendChild(row);
  }
  els.leadList.appendChild(frag);
}

async function loadOverview() {
  const data = await api("/api/admin/overview");
  state.overview = data.overview;
  state.meta = data.meta;
  if (data.meta?.statusLabels) {
    state.statusLabels = { ...DEFAULT_LABELS, ...data.meta.statusLabels };
  }
  renderOverview();
  renderUsers();
  return data.meta;
}

async function loadMeta() {
  const meta = await api("/api/meta");
  state.meta = meta;
  if (meta.statusLabels) {
    state.statusLabels = { ...DEFAULT_LABELS, ...meta.statusLabels };
  }
  // Update meta bar only — avoid rebuilding overview/users on every ETA poll.
  els.metaTotal.textContent = `${state.overview?.totalLeads ?? meta.totalLeads ?? 0} leads`;
  if (state.overview) {
    els.metaPool.textContent = `Pool (New): ${state.overview.unassignedNew ?? 0}`;
  }
  els.metaMode.textContent = `Mode: ${meta.scrapeMode || "tiktok_feed"}`;
  if (els.metaProxy) {
    els.metaProxy.textContent = meta.scrapeProxyConfigured
      ? `Proxy: on (${meta.scrapeProxyRedacted || "set"})`
      : "Proxy: not set";
  }
  els.metaRefresh.textContent = `Last refresh: ${formatWhen(meta.lastRefreshAt)}`;
  return meta;
}

async function loadLeads() {
  const data = await api("/api/leads?status=all");
  state.leads = data.leads || [];
  renderFilters();
  renderLeads();
}

let refreshPollTimer = null;

function formatDuration(ms) {
  const totalSec = Math.max(0, Math.ceil(Number(ms) / 1000) || 0);
  if (totalSec < 60) return `${totalSec}s`;
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins < 60) return secs ? `${mins}m ${secs}s` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins ? `${hours}h ${remMins}m` : `${hours}h`;
}

function setRefreshBusy(busy, label) {
  if (!els.refreshBtn) return;
  els.refreshBtn.disabled = Boolean(busy);
  if (!busy) {
    els.refreshBtn.textContent = "Get leads";
    return;
  }
  els.refreshBtn.textContent = label || "Getting leads…";
}

function applyProgressToBusyUi(progress) {
  if (!progress?.running) return;
  const etaMs = Number(progress.etaMs);
  const kept = Number(progress.leads) || 0;
  const limit = Number(progress.limit) || 0;
  const keptLabel = limit > 0 ? `${kept}/${limit}` : String(kept);
  let label = "Getting leads…";
  if (progress.stuck || progress.phase === "stuck") {
    if (els.refreshBtn.disabled || refreshPollTimer) {
      setRefreshBusy(false, "Get leads");
      showToast(
        kept > 0
          ? `Scrape stuck after ${keptLabel} — click Get leads to retry.`
          : "Scrape stuck on start — click Get leads to retry.",
        { ms: 6500 }
      );
      stopRefreshPoll();
    }
    return;
  } else if (progress.phase === "starting") label = "Starting…";
  else if (progress.phase === "live_now") label = `LIVE NOW · ${keptLabel}`;
  else if (
    progress.phase === "tikleap_other" ||
    progress.phase === "tikleap"
  ) {
    label = `TikLeap other · ${keptLabel}`;
  } else if (progress.phase === "parallel") {
    label = `LIVE NOW → TikLeap · ${keptLabel}`;
  } else if (
    progress.phase === "tiktok_feed" ||
    progress.phase === "tiktok_feed_fallback"
  ) {
    label = `TikTok feed · ${keptLabel}`;
  } else if (progress.phase === "saving") label = "Saving…";
  else if (Number.isFinite(etaMs) && etaMs >= 0) {
    label = etaMs < 1500 ? "Finishing…" : `~${formatDuration(etaMs)} left`;
  }
  if (
    !progress.stuck &&
    progress.phase !== "stuck" &&
    (progress.phase === "live_now" ||
      progress.phase === "tikleap_other" ||
      progress.phase === "parallel" ||
      progress.phase === "tikleap" ||
      progress.phase === "tiktok_feed" ||
      progress.phase === "tiktok_feed_fallback") &&
    Number.isFinite(etaMs) &&
    etaMs >= 1500
  ) {
    label = `${label} · ~${formatDuration(etaMs)}`;
  }
  setRefreshBusy(true, label);
}

let lastLiveLeadPollAt = 0;
let lastLiveLeadKept = -1;

async function maybeRefreshLeadsDuringScrape(progress) {
  const kept = Number(progress?.leads) || 0;
  const persisted = Number(progress?.persistedLeads) || 0;
  const signal = Math.max(kept, persisted);
  const now = Date.now();
  const dueByTime = now - lastLiveLeadPollAt >= 2500;
  const dueBySignal = signal !== lastLiveLeadKept;
  if (!dueByTime && !dueBySignal) return;
  lastLiveLeadPollAt = now;
  lastLiveLeadKept = signal;
  try {
    await loadOverview();
    await loadLeads();
  } catch {
    // Keep progress polling alive even if a leads fetch fails.
  }
}

function stopRefreshPoll() {
  if (refreshPollTimer) {
    clearTimeout(refreshPollTimer);
    refreshPollTimer = null;
  }
}

/** Poll live scrape progress (ETA) while Get leads is running. */
function startRefreshProgressPoll() {
  stopRefreshPoll();
  lastLiveLeadPollAt = 0;
  lastLiveLeadKept = -1;

  const tick = async () => {
    try {
      const meta = await loadMeta();
      const progress = meta.refreshProgress || { running: false };
      if (progress.stuck || progress.phase === "stuck") {
        applyProgressToBusyUi(progress);
        return;
      }
      if (meta.refreshInProgress || progress.running) {
        applyProgressToBusyUi(progress);
        await maybeRefreshLeadsDuringScrape(progress);
        refreshPollTimer = setTimeout(tick, 1000);
        return;
      }
      stopRefreshPoll();
    } catch {
      refreshPollTimer = setTimeout(tick, 1500);
    }
  };

  refreshPollTimer = setTimeout(tick, 400);
}

/** Keep button/list in sync when a scrape is already running (e.g. after page reload). */
function watchRefreshUntilIdle({ announce = false } = {}) {
  stopRefreshPoll();
  lastLiveLeadPollAt = 0;
  lastLiveLeadKept = -1;
  setRefreshBusy(true);
  if (announce) {
    showToast("Get leads already running — waiting for it to finish…");
  }

  const tick = async () => {
    try {
      const meta = await loadMeta();
      const progress = meta.refreshProgress || { running: false };
      if (progress.stuck || progress.phase === "stuck") {
        applyProgressToBusyUi(progress);
        return;
      }
      if (meta.refreshInProgress || progress.running) {
        applyProgressToBusyUi(progress);
        await maybeRefreshLeadsDuringScrape(progress);
        refreshPollTimer = setTimeout(tick, 1000);
        return;
      }
      stopRefreshPoll();
      setRefreshBusy(false);
      await loadOverview();
      await loadLeads();
      if (meta.lastRefreshError) {
        showError(meta.lastRefreshError);
        showToast(meta.lastRefreshError, { ms: 10000 });
      } else {
        const added = Number(meta.lastFetchAdded) || 0;
        if (added > 0) {
          showToast(
            added === 1 ? "Collected 1 new lead" : `Collected ${added} new leads`
          );
        } else {
          showToast("Get leads finished");
        }
      }
    } catch (err) {
      stopRefreshPoll();
      setRefreshBusy(false);
      showError(err.message || "Lost connection while waiting for Get leads.");
    }
  };

  refreshPollTimer = setTimeout(tick, 400);
}

async function refreshNow() {
  if (!els.refreshBtn) return;
  if (els.refreshBtn.disabled && refreshPollTimer) return;
  setRefreshBusy(true, "Starting…");
  showError("");
  startRefreshProgressPoll();

  try {
    const result = await api("/api/refresh", {
      method: "POST",
      body: JSON.stringify({ force: true }),
    });

    if (result.skipped && /already in progress/i.test(result.reason || "")) {
      watchRefreshUntilIdle({ announce: true });
      return;
    }

    stopRefreshPoll();

    if (result.skipped) {
      showToast(result.reason || "Refresh skipped.");
    } else if (result.ok === false || result.error) {
      const msg = result.error || result.notice || "Refresh failed.";
      showError(msg);
      showToast(msg, { ms: 10000 });
    } else if (result.added) {
      showToast(
        `Added ${result.added} lead${result.added === 1 ? "" : "s"} via ${
          result.source || "feed"
        }`,
        { ms: 5500 }
      );
    } else {
      const notice =
        result.notice ||
        result.error ||
        "Refresh finished with 0 new leads — check Last refresh / error banner (often missing UK proxy on Railway).";
      showError(notice);
      showToast(notice, { ms: 9000 });
    }
    await loadOverview();
    await loadLeads();
    await loadNotifications().catch(() => {});
  } catch (error) {
    stopRefreshPoll();
    showError(error.message || "Refresh failed.");
    showToast(error.message || "Refresh failed.", { ms: 6500 });
    await loadNotifications().catch(() => {});
  } finally {
    if (!refreshPollTimer) setRefreshBusy(false);
  }
}

els.refreshBtn.addEventListener("click", () => {
  refreshNow().catch((err) => {
    stopRefreshPoll();
    setRefreshBusy(false);
    showError(err.message || "Refresh failed.");
  });
});

els.clearLeadsBtn.addEventListener("click", async () => {
  const total = state.overview?.totalLeads || 0;
  const ok = window.confirm(
    total
      ? `Erase all ${total} leads?\n\nTombstones keep CRM denylist so they won't return as New.`
      : "Erase all leads?"
  );
  if (!ok) return;
  els.clearLeadsBtn.disabled = true;
  try {
    await api("/api/leads", { method: "DELETE" });
    showToast("All leads erased");
    await loadOverview();
    await loadLeads();
    await loadNotifications().catch(() => {});
  } catch (error) {
    showError(error.message);
  } finally {
    els.clearLeadsBtn.disabled = false;
  }
});

els.copyLeadsBtn.addEventListener("click", async () => {
  const handles = state.leads
    .filter((l) => l.status === "new")
    .slice(0, 30)
    .map((l) => String(l.username || "").replace(/^@+/, ""))
    .filter(Boolean);
  if (!handles.length) {
    showToast("No New leads to copy");
    return;
  }
  try {
    await navigator.clipboard.writeText(handles.join("\n"));
    showToast(`Copied ${handles.length} handles`);
  } catch {
    showToast("Copy failed");
  }
});

els.createUserForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!els.createUserBtn) return;
  els.createUserBtn.disabled = true;
  if (els.createUserResult) {
    els.createUserResult.classList.add("hidden");
    els.createUserResult.textContent = "";
  }
  try {
    const password = String(els.createPassword?.value || "").trim();
    const result = await api("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        username: els.createUsername?.value,
        password: password || undefined,
      }),
    });
    if (result.overview) {
      state.overview = result.overview;
      renderOverview();
      renderUsers();
    } else {
      await loadOverview();
    }
    const user = result.user;
    const temp = result.temporaryPassword;
    if (els.createUserResult) {
      els.createUserResult.classList.remove("hidden");
      els.createUserResult.textContent = temp
        ? `Created @${user.username}. Temporary password (copy now): ${temp}`
        : `Created @${user.username}. Share the username and the password you set.`;
    }
    showToast(temp ? `User created — copy the temporary password` : `User @${user.username} created`);
    els.createUserForm.reset();
    await loadNotifications().catch(() => {});
  } catch (error) {
    showToast(error.message);
  } finally {
    els.createUserBtn.disabled = false;
  }
});

els.distributeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const userId = els.distributeUser.value;
  const count = Number(els.distributeCount.value);
  const status = els.distributeStatus?.value || "new";
  if (!userId) {
    showToast("Select a user");
    return;
  }
  els.distributeBtn.disabled = true;
  try {
    const result = await api("/api/admin/distribute", {
      method: "POST",
      body: JSON.stringify({ userId, count, status }),
    });
    state.overview = result.overview;
    renderOverview();
    renderUsers();
    await loadLeads();
    showToast(
      result.assigned
        ? `Assigned ${result.assigned} lead${result.assigned === 1 ? "" : "s"} (${result.remainingPool} New left in pool)`
        : "No pool leads available to assign"
    );
    await loadNotifications().catch(() => {});
  } catch (error) {
    showToast(error.message);
  } finally {
    els.distributeBtn.disabled = false;
  }
});

els.leadSearch.addEventListener("input", () => {
  state.searchQuery = els.leadSearch.value;
  renderLeads();
});

els.logoutBtn.addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST", body: "{}" });
  } catch {
    // ignore
  }
  window.location.href = "/";
});

els.notifyBtn?.addEventListener("click", (event) => {
  event.stopPropagation();
  if (state.notifyOpen) {
    closeNotifications();
    return;
  }
  openNotifications().catch(() => {});
});

els.notifyMarkRead?.addEventListener("click", (event) => {
  event.stopPropagation();
  markNotificationsRead().catch((error) => {
    showToast(error.message || "Failed to mark read");
  });
});

els.notifyPanel?.addEventListener("click", (event) => {
  event.stopPropagation();
});

document.addEventListener("click", () => {
  if (state.notifyOpen) closeNotifications();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.notifyOpen) closeNotifications();
});

async function init() {
  try {
    const me = await api("/api/auth/me");
    if (!me.user || me.user.role !== "admin") {
      window.location.href = "/?login=1";
      return;
    }
    if (els.adminChip) {
      els.adminChip.textContent = `Admin · ${me.user.username}`;
    }
    const meta = await loadOverview();
    await loadLeads();
    await loadNotifications().catch(() => {});
    if (meta?.refreshInProgress || meta?.refreshProgress?.running) {
      watchRefreshUntilIdle({ announce: true });
    }
  } catch (error) {
    showError(error.message || "Failed to load admin dashboard.");
  }
}

init();
