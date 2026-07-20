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

const BLOCK_SIZE = 30;
const STATUS_BACKUP_KEY = "lead-finder:status-by-username";
const NOTIFY_HISTORY_KEY = "lead-finder:notify-history";
const NOTIFY_UNREAD_KEY = "lead-finder:notify-unread";
const NOTIFY_HISTORY_CAP = 80;

/** Business Suite DM link needs numeric TikTok uid; fall back to profile. */
function messageUrl(leadOrUsername, maybeUsername) {
  const lead =
    leadOrUsername && typeof leadOrUsername === "object"
      ? leadOrUsername
      : { userId: leadOrUsername, username: maybeUsername };
  const uid = String(lead.userId || "").trim();
  if (/^\d{5,}$/.test(uid)) {
    return `https://www.tiktok.com/business-suite/messages?from=homepage&lang=en-GB&u=${uid}`;
  }
  const handle = String(lead.username || leadOrUsername || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
  if (handle && !/^\d{5,}$/.test(handle)) return `https://www.tiktok.com/@${handle}`;
  return "https://www.tiktok.com/messages/";
}

const els = {
  metaTotal: document.getElementById("meta-total"),
  metaQuota: document.getElementById("meta-quota"),
  metaRefresh: document.getElementById("meta-refresh"),
  errorBanner: document.getElementById("error-banner"),
  statusFilters: document.getElementById("status-filters"),
  leadSearch: document.getElementById("lead-search"),
  leadList: document.getElementById("lead-list"),
  leadsEmpty: document.getElementById("leads-empty"),
  copyLeadsBtn: document.getElementById("copy-leads-btn"),
  refreshBtn: document.getElementById("refresh-btn"),
  clearLeadsBtn: document.getElementById("clear-leads-btn"),
  logoutBtn: document.getElementById("logout-btn"),
  userChip: document.getElementById("user-chip"),
  copyStatus: document.getElementById("copy-status"),
  copyBlocks: document.getElementById("copy-blocks"),
  copyEmpty: document.getElementById("copy-empty"),
  toast: document.getElementById("toast"),
  notifyBell: document.getElementById("notify-bell"),
  notifyBadge: document.getElementById("notify-badge"),
  notifyPanel: document.getElementById("notify-panel"),
  notifyList: document.getElementById("notify-list"),
  notifyEmpty: document.getElementById("notify-empty"),
  notifyClear: document.getElementById("notify-clear"),
  tabs: document.querySelectorAll(".tab"),
  panels: {
    leads: document.getElementById("panel-leads"),
    copy: document.getElementById("panel-copy"),
    dm: document.getElementById("panel-dm"),
  },
};

let toastTimer = null;
let notifyPanelOpen = false;
let notifyHoverDismissTimer = null;
const NOTIFY_HOVER_DISMISS_MS = 150;

function clearNotifyHoverDismiss() {
  if (notifyHoverDismissTimer) {
    clearTimeout(notifyHoverDismissTimer);
    notifyHoverDismissTimer = null;
  }
}

function scheduleNotifyHoverDismiss() {
  clearNotifyHoverDismiss();
  notifyHoverDismissTimer = setTimeout(() => {
    notifyHoverDismissTimer = null;
    setNotifyPanelOpen(false);
  }, NOTIFY_HOVER_DISMISS_MS);
}

function pasteShortcutHint() {
  const mac =
    /Mac|iPhone|iPad|iPod/.test(navigator.platform) ||
    (navigator.userAgentData?.platform || "").includes("macOS") ||
    /Mac OS X/.test(navigator.userAgent);
  return mac ? "Cmd+V" : "Ctrl+V";
}

function loadNotifyHistory() {
  try {
    const raw = localStorage.getItem(NOTIFY_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveNotifyHistory(items) {
  try {
    localStorage.setItem(NOTIFY_HISTORY_KEY, JSON.stringify(items));
  } catch {
    // Quota / private mode — history is best-effort.
  }
}

function getUnreadCount() {
  try {
    const n = Number(localStorage.getItem(NOTIFY_UNREAD_KEY));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

function setUnreadCount(n) {
  const next = Math.max(0, Math.floor(Number(n) || 0));
  try {
    localStorage.setItem(NOTIFY_UNREAD_KEY, String(next));
  } catch {
    // ignore
  }
  updateNotifyBadge();
}

function formatNotifyWhen(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 45_000) return "just now";
  if (diffMs < 3_600_000) {
    const mins = Math.max(1, Math.round(diffMs / 60_000));
    return `${mins}m ago`;
  }
  if (diffMs < 86_400_000) {
    const hours = Math.max(1, Math.round(diffMs / 3_600_000));
    return `${hours}h ago`;
  }
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function updateNotifyBadge() {
  if (!els.notifyBadge) return;
  const n = getUnreadCount();
  if (n <= 0) {
    els.notifyBadge.classList.add("hidden");
    els.notifyBadge.textContent = "0";
    if (els.notifyBell) {
      els.notifyBell.setAttribute("aria-label", "Notifications");
    }
    return;
  }
  const label = n > 99 ? "99+" : String(n);
  els.notifyBadge.textContent = label;
  els.notifyBadge.classList.remove("hidden");
  if (els.notifyBell) {
    els.notifyBell.setAttribute(
      "aria-label",
      `Notifications, ${n} unread`
    );
  }
}

function renderNotifyPanel() {
  if (!els.notifyList || !els.notifyEmpty) return;
  const items = loadNotifyHistory();
  els.notifyList.innerHTML = "";
  if (!items.length) {
    els.notifyEmpty.classList.remove("hidden");
    return;
  }
  els.notifyEmpty.classList.add("hidden");
  const frag = document.createDocumentFragment();
  for (const item of items) {
    const li = document.createElement("li");
    li.className = "notify-item";
    const msg = document.createElement("span");
    msg.className = "notify-item-msg";
    msg.textContent = item.message || "";
    const time = document.createElement("span");
    time.className = "notify-item-time";
    time.textContent = formatNotifyWhen(item.at);
    li.append(msg, time);
    frag.appendChild(li);
  }
  els.notifyList.appendChild(frag);
}

function pushNotifyHistory(message) {
  const text = String(message || "").trim();
  if (!text) return;
  const items = loadNotifyHistory();
  items.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    message: text,
    at: new Date().toISOString(),
  });
  saveNotifyHistory(items.slice(0, NOTIFY_HISTORY_CAP));
  if (notifyPanelOpen) {
    renderNotifyPanel();
  } else {
    setUnreadCount(getUnreadCount() + 1);
  }
}

function setNotifyPanelOpen(open) {
  clearNotifyHoverDismiss();
  notifyPanelOpen = Boolean(open);
  if (!els.notifyPanel || !els.notifyBell) return;
  els.notifyBell.setAttribute("aria-expanded", notifyPanelOpen ? "true" : "false");
  if (notifyPanelOpen) {
    els.notifyPanel.classList.remove("hidden");
    els.notifyPanel.hidden = false;
    setUnreadCount(0);
    renderNotifyPanel();
  } else {
    els.notifyPanel.classList.add("hidden");
    els.notifyPanel.hidden = true;
  }
}

function showToast(message, { ms = 4200 } = {}) {
  if (!message) return;
  pushNotifyHistory(message);
  if (!els.toast) return;
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

const state = {
  statusLabels: { ...DEFAULT_LABELS },
  filter: "new",
  copyFilter: "new",
  searchQuery: "",
  allLeadsCache: null,
  leads: [],
  statusCounts: null,
  meta: null,
  activeTab: "leads",
};

const EMPTY_FILTER =
  "No leads match this filter yet. Ask an admin to assign leads from the pool.";
const EMPTY_SEARCH = "No creators match that handle.";

function normalizeSearchQuery(value) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

function usernameKey(username) {
  return normalizeSearchQuery(username);
}

function loadStatusBackup() {
  try {
    const raw = localStorage.getItem(STATUS_BACKUP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function saveStatusBackup(map) {
  try {
    localStorage.setItem(STATUS_BACKUP_KEY, JSON.stringify(map));
  } catch {
    // Quota / private mode — server remains source of truth.
  }
}

function rememberLeadStatus(lead) {
  if (!lead?.username || !lead?.status) return;
  const map = loadStatusBackup();
  const key = usernameKey(lead.username);
  map[key] = {
    status: lead.status,
    updatedAt: lead.updatedAt || new Date().toISOString(),
    id: lead.id || map[key]?.id || null,
  };
  saveStatusBackup(map);
}

function syncBackupFromLeads(leads) {
  if (!Array.isArray(leads) || !leads.length) return;
  const map = loadStatusBackup();
  for (const lead of leads) {
    if (!lead?.username || !lead?.status) continue;
    const key = usernameKey(lead.username);
    const existing = map[key];
    const leadTime = Date.parse(lead.updatedAt || 0);
    const existingTime = Date.parse(existing?.updatedAt || 0);
    if (!existing || !Number.isFinite(existingTime) || leadTime >= existingTime) {
      map[key] = {
        status: lead.status,
        updatedAt: lead.updatedAt || existing?.updatedAt || null,
        id: lead.id || existing?.id || null,
      };
    }
  }
  saveStatusBackup(map);
}

/** Re-apply local statuses the server lost (or that are newer than server). */
async function reconcileStatusBackup(leads) {
  const backup = loadStatusBackup();
  if (!Object.keys(backup).length || !Array.isArray(leads) || !leads.length) return 0;

  let restored = 0;
  const jobs = [];

  for (const lead of leads) {
    const key = usernameKey(lead.username);
    const local = backup[key];
    if (!local?.status || local.status === lead.status) continue;

    const localTime = Date.parse(local.updatedAt || 0);
    const serverTime = Date.parse(lead.updatedAt || 0);
    const localNewer =
      Number.isFinite(localTime) &&
      (!Number.isFinite(serverTime) || localTime > serverTime);
    // Same lead id, status flipped back to new without a newer timestamp.
    const sameLeadLostStatus =
      local.id &&
      local.id === lead.id &&
      lead.status === "new" &&
      local.status !== "new" &&
      (!Number.isFinite(serverTime) || !Number.isFinite(localTime) || serverTime <= localTime);
    // Lead row was recreated (e.g. store wiped) — keep username→status intent.
    const recreatedLead =
      lead.status === "new" &&
      local.status !== "new" &&
      (!local.id || local.id !== lead.id);

    if (!localNewer && !sameLeadLostStatus && !recreatedLead) continue;

    jobs.push(
      api(`/api/leads/${lead.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: local.status }),
      })
        .then(({ lead: updated }) => {
          lead.status = updated.status;
          lead.updatedAt = updated.updatedAt;
          rememberLeadStatus(updated);
          restored += 1;
        })
        .catch(() => {
          // Keep local backup; retry on next load.
        })
    );
  }

  if (jobs.length) await Promise.all(jobs);
  return restored;
}

function leadMatchesSearch(lead, query) {
  if (!query) return true;
  const username = String(lead.username || "")
    .replace(/^@+/, "")
    .toLowerCase();
  const displayName = String(lead.displayName || "").toLowerCase();
  return username.includes(query) || displayName.includes(query);
}

function labelFor(status) {
  return state.statusLabels[status] || DEFAULT_LABELS[status] || status;
}

function formatDiamonds(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(Math.floor(n));
}

/** Prefer L30; fall back to legacy L28. */
function leadDiamondsValue(lead) {
  const l30 = Number(lead?.diamondsL30);
  if (Number.isFinite(l30) && l30 >= 0) return l30;
  const l28 = Number(lead?.diamondsL28);
  if (Number.isFinite(l28) && l28 >= 0) return l28;
  return null;
}

function formatWhen(iso) {
  if (!iso) return "never";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "never";
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function api(path, options) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
    credentials: "same-origin",
    ...options,
    cache: "no-store",
  });
  if (response.status === 401) {
    window.location.href = "/?login=1";
    throw new Error("Authentication required.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || data.reason || `Request failed (${response.status})`);
  }
  return data;
}

function showError(message) {
  if (!message) {
    els.errorBanner.classList.add("hidden");
    els.errorBanner.textContent = "";
    return;
  }
  els.errorBanner.textContent = message;
  els.errorBanner.classList.remove("hidden");
}

function renderMeta() {
  const meta = state.meta;
  if (!meta) return;

  els.metaTotal.textContent = `${meta.totalLeads} lead${meta.totalLeads === 1 ? "" : "s"}`;
  if (els.metaQuota && !els.metaQuota.classList.contains("hidden")) {
    const lastAdded = Number(meta.lastFetchAdded) || 0;
    els.metaQuota.textContent =
      lastAdded === 1 ? "Last added: 1 lead" : `Last added: ${lastAdded} leads`;
  }
  if (els.metaRefresh && !els.metaRefresh.classList.contains("hidden")) {
    els.metaRefresh.textContent = `Last refresh: ${formatWhen(meta.lastRefreshAt)}`;
  }
}

/** One-shot toast for a persisted refresh error, then clear it on the server. */
async function consumeLastRefreshError(meta) {
  const message = String(meta?.lastRefreshError || "").trim();
  if (!message) return;
  showToast(message, { ms: 6500 });
  try {
    await api("/api/meta/refresh-error", { method: "DELETE" });
    if (state.meta) state.meta.lastRefreshError = null;
  } catch {
    // Banner must not stick even if clear fails — toast already shown.
    if (state.meta) state.meta.lastRefreshError = null;
  }
}

function statusCountsFrom(leads) {
  const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0]));
  const list = Array.isArray(leads) ? leads : [];
  counts.all = list.length;
  for (const lead of list) {
    if (Object.prototype.hasOwnProperty.call(counts, lead.status)) {
      counts[lead.status] += 1;
    }
  }
  return counts;
}

function applyStatusCounts(leads) {
  state.statusCounts = statusCountsFrom(leads);
}

function renderFilters() {
  els.statusFilters.innerHTML = "";
  const counts = state.statusCounts || {};
  for (const status of STATUS_ORDER) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `filter-chip${state.filter === status ? " is-active" : ""}`;
    const label = document.createElement("span");
    label.className = "filter-chip-label";
    label.textContent = labelFor(status);
    const count = document.createElement("span");
    count.className = "filter-chip-count";
    count.textContent = ` (${counts[status] ?? 0})`;
    button.append(label, count);
    button.addEventListener("click", () => {
      state.filter = status;
      renderFilters();
      loadLeads();
    });
    els.statusFilters.appendChild(button);
  }
}

function renderCopyStatusOptions() {
  const options = STATUS_ORDER.filter((s) => s !== "all");
  els.copyStatus.innerHTML = options
    .map(
      (status) =>
        `<option value="${status}"${status === state.copyFilter ? " selected" : ""}>${labelFor(
          status
        )}</option>`
    )
    .join("");
}

function avatarNode(lead) {
  if (lead.avatarUrl) {
    const img = document.createElement("img");
    img.className = "avatar";
    img.src = lead.avatarUrl;
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.loading = "lazy";
    img.addEventListener("error", () => {
      img.replaceWith(fallbackAvatar(lead.username));
    });
    return img;
  }
  return fallbackAvatar(lead.username);
}

function fallbackAvatar(username) {
  const div = document.createElement("div");
  div.className = "avatar avatar-fallback";
  div.textContent = (username || "?").slice(0, 1).toUpperCase();
  div.setAttribute("aria-hidden", "true");
  return div;
}

const QUICK_STATUS_ACTIONS = new Set([
  "contacted",
  "unsupported_region",
  "in_network",
  "dms_off",
  "ineligible",
  "premium_invite_required",
]);

/** Options for the per-lead select: other statuses only (quick buttons cover the rest). */
function statusOptionsHtml(selected) {
  const options = STATUS_ORDER.filter(
    (s) => s !== "all" && !QUICK_STATUS_ACTIONS.has(s)
  );
  // Keep current quick status visible as selected so the control matches reality.
  if (QUICK_STATUS_ACTIONS.has(selected) && !options.includes(selected)) {
    options.unshift(selected);
  }
  return options
    .map(
      (status) =>
        `<option value="${status}"${status === selected ? " selected" : ""}>${labelFor(
          status
        )}</option>`
    )
    .join("");
}

/** PATCH lead status, then reset Leads view + refresh counts/Copy. */
async function applyLeadStatus(lead, status) {
  const { lead: updated } = await api(`/api/leads/${lead.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  rememberLeadStatus(updated);
  // Drop search cache so filtered views (incl. Copy) cannot keep stale rows.
  state.allLeadsCache = null;
  // Return to the initial Leads start view, then refresh Copy blocks too.
  state.filter = "new";
  state.searchQuery = "";
  els.leadSearch.value = "";
  renderFilters();
  await loadLeads();
  await loadCopyLeads();
  setTab("leads");
  showToast(`Marked @${updated.username} as ${labelFor(updated.status)}`, {
    ms: 2200,
  });
  return updated;
}

function renderLeads() {
  els.leadList.innerHTML = "";
  const leads = state.leads;
  const searching = Boolean(normalizeSearchQuery(state.searchQuery));

  if (!leads.length) {
    els.leadsEmpty.textContent = searching ? EMPTY_SEARCH : EMPTY_FILTER;
    els.leadsEmpty.classList.remove("hidden");
    return;
  }

  els.leadsEmpty.classList.add("hidden");

  for (const lead of leads) {
    const row = document.createElement("article");
    row.className = "lead-row";
    row.dataset.id = lead.id;

    const main = document.createElement("div");
    main.className = "lead-main";

    const head = document.createElement("div");
    head.className = "lead-head";
    const name = document.createElement("p");
    name.className = "lead-username";
    name.textContent = `@${lead.username}`;
    head.append(name);

    const meta = document.createElement("p");
    meta.className = "lead-meta";
    const bits = [];
    if (lead.displayName && lead.displayName !== lead.username) {
      bits.push(lead.displayName);
    }
    if (lead.region) bits.push(lead.region);
    bits.push(`Added ${formatWhen(lead.sourcedAt)}`);
    meta.textContent = bits.join(" · ");
    main.append(head, meta);

    const diamondsCell = document.createElement("div");
    diamondsCell.className = "lead-diamonds-cell";
    const diamonds = leadDiamondsValue(lead);
    if (diamonds != null) {
      const chip = document.createElement("span");
      chip.className = "lead-diamonds";
      chip.title = "Diamonds in the last 30 days";
      chip.setAttribute(
        "aria-label",
        `${formatDiamonds(diamonds)} diamonds in the last 30 days`
      );
      const mark = document.createElement("span");
      mark.className = "lead-diamonds-mark";
      mark.setAttribute("aria-hidden", "true");
      mark.textContent = "💎";
      const value = document.createElement("span");
      value.className = "lead-diamonds-value";
      value.textContent = formatDiamonds(diamonds);
      const period = document.createElement("span");
      period.className = "lead-diamonds-period";
      period.textContent = "in last 30 days";
      chip.append(mark, value, period);
      diamondsCell.append(chip);
    } else {
      diamondsCell.classList.add("is-empty");
    }

    const select = document.createElement("select");
    select.className = "status-select";
    select.innerHTML = statusOptionsHtml(lead.status);
    select.setAttribute("aria-label", `Status for ${lead.username}`);
    select.addEventListener("change", async () => {
      const previous = lead.status;
      select.disabled = true;
      try {
        await applyLeadStatus(lead, select.value);
      } catch (error) {
        select.value = previous;
        select.disabled = false;
        showError(error.message);
      }
    });

    const contactedBtn = document.createElement("button");
    contactedBtn.type = "button";
    contactedBtn.className = `btn btn-ghost lead-contacted${
      lead.status === "contacted" ? " is-contacted" : ""
    }`;
    contactedBtn.textContent = "Contacted";
    const contactedTip = `Mark as ${labelFor("contacted")}`;
    contactedBtn.setAttribute("data-tooltip", contactedTip);
    contactedBtn.setAttribute("aria-label", contactedTip);

    const regionBtn = document.createElement("button");
    regionBtn.type = "button";
    regionBtn.className = `btn btn-ghost lead-unsupported${
      lead.status === "unsupported_region" ? " is-unsupported" : ""
    }`;
    regionBtn.innerHTML =
      '<svg class="lead-unsupported-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.75"/><ellipse cx="12" cy="12" rx="3.5" ry="9" fill="none" stroke="currentColor" stroke-width="1.75"/><path d="M3.5 12h17M4.8 7.5h14.4M4.8 16.5h14.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M5 5l14 14" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round"/></svg>';
    const regionTip = `Mark as ${labelFor("unsupported_region")}`;
    regionBtn.setAttribute("data-tooltip", regionTip);
    regionBtn.setAttribute("aria-label", regionTip);

    const inNetworkLabel = labelFor("in_network");
    const networkBtn = document.createElement("button");
    networkBtn.type = "button";
    networkBtn.className = `btn btn-ghost lead-in-network${
      lead.status === "in_network" ? " is-in-network" : ""
    }`;
    networkBtn.innerHTML =
      '<svg class="lead-in-network-icon" viewBox="0 0 16 16" width="16" height="16" overflow="hidden" aria-hidden="true" focusable="false"><text x="8" y="12.1" text-anchor="middle" font-size="12.75" font-weight="800" font-family="TikTok Sans, system-ui, sans-serif" fill="currentColor">CN</text><path d="M1.6 1.6l12.8 12.8" fill="none" stroke="currentColor" stroke-width="2.15" stroke-linecap="round"/></svg>';
    const networkTip = `Mark as ${inNetworkLabel}`;
    networkBtn.setAttribute("data-tooltip", networkTip);
    networkBtn.setAttribute("aria-label", networkTip);

    const dmsOffLabel = labelFor("dms_off");
    const dmsOffBtn = document.createElement("button");
    dmsOffBtn.type = "button";
    dmsOffBtn.className = `btn btn-ghost lead-dms-off${
      lead.status === "dms_off" ? " is-dms-off" : ""
    }`;
    dmsOffBtn.innerHTML =
      '<svg class="lead-dms-off-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M4.5 5.5h11.5a2.5 2.5 0 0 1 2.5 2.5v6a2.5 2.5 0 0 1-2.5 2.5H10l-3.8 3.2c-.55.46-1.4.07-1.4-.65V16.5H4.5A2.5 2.5 0 0 1 2 14V8a2.5 2.5 0 0 1 2.5-2.5z" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/><path d="M5 5l14 14" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round"/></svg>';
    dmsOffBtn.setAttribute("data-tooltip", dmsOffLabel);
    dmsOffBtn.setAttribute("aria-label", dmsOffLabel);

    const ineligibleLabel = labelFor("ineligible");
    const ineligibleBtn = document.createElement("button");
    ineligibleBtn.type = "button";
    ineligibleBtn.className = `btn btn-ghost lead-ineligible${
      lead.status === "ineligible" ? " is-ineligible" : ""
    }`;
    ineligibleBtn.innerHTML =
      '<svg class="lead-ineligible-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.75"/><path d="M9.6 9c0-1.45 1.15-2.55 2.4-2.55S14.4 7.5 14.4 9c0 1.35-1.05 1.95-1.85 2.45-.55.35-.95.75-.95 1.45v.35" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/><circle cx="12" cy="16.85" r="1.05" fill="currentColor"/><path d="M5 5l14 14" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round"/></svg>';
    const ineligibleTip = `Mark as ${ineligibleLabel}`;
    ineligibleBtn.setAttribute("data-tooltip", ineligibleTip);
    ineligibleBtn.setAttribute("aria-label", ineligibleTip);

    const premLabel = labelFor("premium_invite_required");
    const premBtn = document.createElement("button");
    premBtn.type = "button";
    premBtn.className = `btn btn-ghost lead-prem${
      lead.status === "premium_invite_required" ? " is-prem" : ""
    }`;
    premBtn.innerHTML =
      '<svg class="lead-prem-icon" viewBox="0 0 34 16" width="34" height="16" overflow="hidden" aria-hidden="true" focusable="false"><text x="17" y="12.1" text-anchor="middle" font-size="11" font-weight="800" font-family="TikTok Sans, system-ui, sans-serif" letter-spacing="0.04em" fill="currentColor">PREM</text></svg>';
    const premTip = `Mark as ${premLabel}`;
    premBtn.setAttribute("data-tooltip", premTip);
    premBtn.setAttribute("aria-label", premTip);

    const setQuickBusy = (busy) => {
      contactedBtn.disabled = busy;
      regionBtn.disabled = busy;
      networkBtn.disabled = busy;
      dmsOffBtn.disabled = busy;
      ineligibleBtn.disabled = busy;
      premBtn.disabled = busy;
      select.disabled = busy;
    };

    contactedBtn.addEventListener("click", async () => {
      setQuickBusy(true);
      try {
        await applyLeadStatus(lead, "contacted");
      } catch (error) {
        setQuickBusy(false);
        showError(error.message);
      }
    });

    regionBtn.addEventListener("click", async () => {
      setQuickBusy(true);
      try {
        await applyLeadStatus(lead, "unsupported_region");
      } catch (error) {
        setQuickBusy(false);
        showError(error.message);
      }
    });

    networkBtn.addEventListener("click", async () => {
      setQuickBusy(true);
      try {
        await applyLeadStatus(lead, "in_network");
      } catch (error) {
        setQuickBusy(false);
        showError(error.message);
      }
    });

    dmsOffBtn.addEventListener("click", async () => {
      setQuickBusy(true);
      try {
        await applyLeadStatus(lead, "dms_off");
      } catch (error) {
        setQuickBusy(false);
        showError(error.message);
      }
    });

    ineligibleBtn.addEventListener("click", async () => {
      setQuickBusy(true);
      try {
        await applyLeadStatus(lead, "ineligible");
      } catch (error) {
        setQuickBusy(false);
        showError(error.message);
      }
    });

    premBtn.addEventListener("click", async () => {
      setQuickBusy(true);
      try {
        await applyLeadStatus(lead, "premium_invite_required");
      } catch (error) {
        setQuickBusy(false);
        showError(error.message);
      }
    });

    const quickBtns = document.createElement("div");
    quickBtns.className = "lead-quick-actions";
    quickBtns.append(
      regionBtn,
      networkBtn,
      dmsOffBtn,
      ineligibleBtn,
      premBtn
    );

    const quickField = document.createElement("div");
    quickField.className = "lead-status-field lead-quick-field";
    const quickLabel = document.createElement("span");
    quickLabel.className = "lead-status-label";
    quickLabel.textContent = "Quick update";
    quickField.append(quickLabel, quickBtns);

    const statusField = document.createElement("div");
    statusField.className = "lead-status-field";
    const statusLabel = document.createElement("label");
    statusLabel.className = "lead-status-label";
    statusLabel.textContent = "Other status";
    const statusLabelId = `lead-status-${lead.id}`;
    select.id = statusLabelId;
    statusLabel.setAttribute("for", statusLabelId);
    statusField.append(statusLabel, select);

    const openBtn = document.createElement("a");
    openBtn.className = "btn btn-ghost lead-open";
    openBtn.href = lead.messageUrl || messageUrl(lead);
    openBtn.target = "_blank";
    openBtn.rel = "noopener noreferrer";
    openBtn.textContent = "Message & Auto Copy DM";
    openBtn.title = "Generate DM, copy it, then open TikTok";
    openBtn.addEventListener("click", (event) => {
      // Left-click only: generate + copy, then open. Middle/right-click keep native link.
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      event.preventDefault();
      void openLeadMessage(lead, openBtn.href);
    });

    const messageActions = document.createElement("div");
    messageActions.className = "lead-message-actions";
    messageActions.append(openBtn, contactedBtn);

    const identity = document.createElement("div");
    identity.className = "lead-identity";
    identity.append(main);

    const top = document.createElement("div");
    top.className = "lead-top";
    top.append(avatarNode(lead), identity, diamondsCell);

    const controls = document.createElement("div");
    controls.className = "lead-controls";
    controls.append(quickField, statusField, messageActions);

    row.append(top, controls);
    els.leadList.appendChild(row);
  }
}

/** Prefill Leads search with a handle so the list shows only that creator. */
function prefillLeadSearch(username) {
  const handle = String(username || "")
    .replace(/^@+/, "")
    .trim();
  if (!handle || !els.leadSearch) return;
  state.searchQuery = handle;
  els.leadSearch.value = handle;
  if (state.activeTab !== "leads") setTab("leads");
  loadLeads().catch((err) => showError(err.message));
}

/**
 * Best-effort Message flow: auto-generate a DM from DM Generator settings,
 * copy to clipboard, open TikTok Business Suite. True textarea prefill is
 * not possible cross-origin (TikTok has no outbound draft query param).
 * Also prefills Leads search with the handle so returning to the app shows
 * only that lead for a quick status update.
 */
function generateLeadDm(lead) {
  try {
    const api = window.CreatorRadarDM;
    if (api && typeof api.generateForLead === "function") {
      return api.generateForLead({ username: lead.username }) || "";
    }
  } catch {
    /* ignore */
  }
  return "";
}

/** Copy a generated DM without opening TikTok. */
async function copyLeadDm(lead, btn) {
  const dm = generateLeadDm(lead);
  if (!dm) {
    showToast("No DM template — set one up in the DM Generator tab");
    return;
  }
  if (btn) btn.disabled = true;
  try {
    const copied = await copyText(dm);
    if (copied) {
      showToast(`DM copied — paste in TikTok (${pasteShortcutHint()})`);
    } else {
      showToast("DM generated but copy failed — use the DM Generator tab");
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function openLeadMessage(lead, url) {
  const target = url || lead.messageUrl || messageUrl(lead);

  // Prefill search immediately so the filter is ready when they tab back.
  prefillLeadSearch(lead?.username);

  // Generate synchronously so we can open the tab while still in the click gesture.
  const dm = generateLeadDm(lead);

  // Start clipboard write before open (keeps focus + user-gesture for copy),
  // but open the tab synchronously so pop-up blockers don't fire.
  const copyPromise = dm ? copyText(dm) : Promise.resolve(false);
  window.open(target, "_blank", "noopener,noreferrer");
  const copied = await copyPromise;

  if (copied) {
    showToast(`DM copied — paste in TikTok (${pasteShortcutHint()})`);
  } else if (dm) {
    showToast("DM generated but copy failed — use the DM Generator tab");
  } else {
    showToast("Opened TikTok — generate a DM from the DM Generator tab to copy");
  }
}

function chunk(items, size) {
  const blocks = [];
  for (let i = 0; i < items.length; i += size) {
    blocks.push(items.slice(i, i + size));
  }
  return blocks;
}

/** Random sample of up to `n` unique items (Fisher–Yates partial shuffle). */
function sampleUnique(items, n) {
  const pool = items.slice();
  const take = Math.min(n, pool.length);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(Math.random() * (pool.length - i));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  return pool.slice(0, take);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "absolute";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  }
}

function renderCopyBlocks(leads) {
  els.copyBlocks.innerHTML = "";
  // Defense in depth: only usernames matching the Copy status filter (default new).
  const matched = (leads || []).filter(
    (lead) => !state.copyFilter || lead.status === state.copyFilter
  );
  const usernames = matched.map((lead) => String(lead.username || "").replace(/^@+/, ""));
  const blocks = chunk(usernames, BLOCK_SIZE);

  if (!blocks.length) {
    els.copyEmpty.classList.remove("hidden");
    return;
  }

  els.copyEmpty.classList.add("hidden");

  blocks.forEach((block, index) => {
    const text = block.join("\n");
    const card = document.createElement("article");
    card.className = "copy-block";

    const head = document.createElement("div");
    head.className = "copy-block-head";

    const titles = document.createElement("div");
    const title = document.createElement("p");
    title.className = "copy-block-title";
    title.textContent = `Block ${index + 1}`;
    const count = document.createElement("p");
    count.className = "copy-block-count";
    count.textContent = `${block.length} username${block.length === 1 ? "" : "s"}`;
    titles.append(title, count);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-copy";
    button.textContent = "Copy block";
    button.addEventListener("click", async () => {
      const ok = await copyText(text);
      button.textContent = ok ? "Copied!" : "Copy failed";
      button.classList.toggle("is-success", ok);
      setTimeout(() => {
        button.textContent = "Copy block";
        button.classList.remove("is-success");
      }, 1600);
    });

    head.append(titles, button);

    const preview = document.createElement("pre");
    preview.className = "copy-preview";
    preview.textContent = text;

    card.append(head, preview);
    els.copyBlocks.appendChild(card);
  });
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
    // Unlock so the user can retry (server clears wedged launch locks on click).
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
    label =
      etaMs < 1500 ? "Finishing…" : `~${formatDuration(etaMs)} left`;
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

/** While scraping, reload the lead list so New updates as keepers are persisted. */
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
    state.allLeadsCache = null;
    await loadLeads();
    if (state.activeTab === "copy") await loadCopyLeads();
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
      const meta = await api("/api/meta");
      state.meta = meta;
      renderMeta();
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
      state.allLeadsCache = null;
      await loadLeads();
      if (state.activeTab === "copy") await loadCopyLeads();
      const added = Number(meta.lastFetchAdded) || 0;
      if (added > 0) {
        showToast(
          added === 1 ? "Collected 1 new lead" : `Collected ${added} new leads`
        );
      } else {
        showToast("Get leads finished");
      }
    } catch (err) {
      stopRefreshPoll();
      setRefreshBusy(false);
      showError(err.message || "Lost connection while waiting for Get leads.");
    }
  };

  refreshPollTimer = setTimeout(tick, 400);
}

async function loadMeta() {
  const meta = await api("/api/meta");
  state.meta = meta;
  if (meta.statusLabels) {
    state.statusLabels = { ...DEFAULT_LABELS, ...meta.statusLabels, all: "All" };
  }
  renderMeta();
  return meta;
}

async function loadLeads() {
  const search = normalizeSearchQuery(state.searchQuery);

  if (search) {
    if (!state.allLeadsCache) {
      const data = await api("/api/leads");
      state.allLeadsCache = data.leads || [];
      await reconcileStatusBackup(state.allLeadsCache);
      syncBackupFromLeads(state.allLeadsCache);
    }
    applyStatusCounts(state.allLeadsCache);
    state.leads = state.allLeadsCache.filter((lead) => leadMatchesSearch(lead, search));
  } else {
    state.allLeadsCache = null;
    const data = await api("/api/leads");
    const all = data.leads || [];
    applyStatusCounts(all);
    // Full store sync so status counts and backup stay aligned with the list source.
    syncBackupFromLeads(all);
    state.leads =
      state.filter === "all" ? all : all.filter((lead) => lead.status === state.filter);
  }

  renderFilters();
  renderLeads();
}

async function loadCopyLeads() {
  // Always hit the API with the selected Copy filter — never reuse allLeadsCache.
  const status = state.copyFilter || "new";
  const data = await api(`/api/leads?status=${encodeURIComponent(status)}`);
  renderCopyBlocks(data.leads || []);
}

/** Random sample of New-lead usernames (no @), up to BLOCK_SIZE from the full pool. */
async function randomNewLeadsSample() {
  const status = "new";
  const data = await api(`/api/leads?status=${encodeURIComponent(status)}`);
  const matched = (data.leads || []).filter((lead) => lead.status === status);
  const seen = new Set();
  const usernames = [];
  for (const lead of matched) {
    const name = String(lead.username || "").replace(/^@+/, "");
    if (!name || seen.has(name)) continue;
    seen.add(name);
    usernames.push(name);
  }
  return sampleUnique(usernames, BLOCK_SIZE);
}

async function copyLeadsFromHeader() {
  if (!els.copyLeadsBtn) return;
  const btn = els.copyLeadsBtn;
  btn.disabled = true;
  showError("");

  try {
    const block = await randomNewLeadsSample();
    if (!block.length) {
      showError("No new leads available. Get leads.");
      return;
    }

    const text = block.join("\n");
    const ok = await copyText(text);
    if (!ok) {
      showToast("Copy failed — try the Check leads via Backstage tab");
      return;
    }

    showToast(
      block.length === 1
        ? "Copied 1 lead to check via Backstage"
        : `Copied ${block.length} leads to check via Backstage`
    );
    btn.textContent = "Copied!";
    btn.classList.add("is-success");
    setTimeout(() => {
      btn.textContent = "Copy leads";
      btn.classList.remove("is-success");
    }, 1600);
  } catch (error) {
    showToast(error.message || "Copy failed");
  } finally {
    btn.disabled = false;
  }
}

function setTab(tab) {
  state.activeTab = tab;
  els.tabs.forEach((button) => {
    const active = button.dataset.tab === tab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });

  Object.entries(els.panels).forEach(([key, panel]) => {
    const active = key === tab;
    panel.classList.toggle("is-active", active);
    panel.hidden = !active;
  });

  // Every visit to Copy refetches so status changes never leave stale usernames.
  if (tab === "copy") loadCopyLeads().catch((err) => showError(err.message));
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
      showToast(result.reason || "Refresh skipped.", { ms: 5500 });
    } else if (!result.ok) {
      showToast(result.error || "Refresh failed.", { ms: 6500 });
    } else if (result.added) {
      const added = Number(result.added) || 0;
      const kept = Number(result.tikleapKept) || added;
      const viaFeed = /tiktok_live_suggested|tiktok_feed/i.test(
        result.source || ""
      );
      const viaTikleap = /tikleap/i.test(result.source || "");
      els.metaRefresh.textContent = `Last refresh: just now (+${added}${
        viaFeed
          ? " via LIVE NOW → TikLeap → TikTok"
          : viaTikleap
            ? " via TikLeap"
            : ""
      })`;
      if (result.notice) {
        showToast(result.notice, { ms: 8000 });
      } else if (kept >= 200 || added >= 200) {
        showToast(
          viaFeed
            ? "Filled 200 UK leads (LIVE NOW → TikLeap → TikTok, L30 1K–150K when known)"
            : "Filled 200 UK leads (TikLeap LIVE NOW / last 14d, L30 1K–150K when known)",
          { ms: 4500 }
        );
      } else {
        showToast(
          added === 1
            ? "Added 1 UK lead (L30 band when known)"
            : `Added ${added} UK leads (L30 band when known)`,
          { ms: 4500 }
        );
      }
    } else {
      const seen = result.seen != null ? ` (saw ${result.seen})` : "";
      const tagged = [
        result.regionTagged ? `${result.regionTagged} region-filtered` : "",
        result.denylistTagged ? `${result.denylistTagged} denylist` : "",
        result.tikleapSkipped ? `${result.tikleapSkipped} filtered` : "",
      ]
        .filter(Boolean)
        .join(", ");
      showToast(
        `Refresh finished — no new UK leads (last 14d) added${seen}${
          tagged ? ` — ${tagged}` : ""
        }.`,
        { ms: 5500 }
      );
    }

    await loadMeta();
    // Refresh response already toasted — don't re-toast a persisted error.
    if (state.meta?.lastRefreshError) {
      try {
        await api("/api/meta/refresh-error", { method: "DELETE" });
      } catch {
        /* ignore */
      }
      state.meta.lastRefreshError = null;
    }
    state.allLeadsCache = null;
    await loadLeads();
    if (state.activeTab === "copy") await loadCopyLeads();
  } catch (error) {
    stopRefreshPoll();
    showToast(error.message || "Refresh failed.", { ms: 6500 });
  } finally {
    if (!refreshPollTimer) setRefreshBusy(false);
  }
}

els.tabs.forEach((tab) => {
  tab.addEventListener("click", () => setTab(tab.dataset.tab));
});

if (els.refreshBtn) {
  els.refreshBtn.addEventListener("click", refreshNow);
}

if (els.copyLeadsBtn) {
  els.copyLeadsBtn.addEventListener("click", () => {
    copyLeadsFromHeader().catch((err) => showToast(err.message || "Copy failed"));
  });
}

async function clearAllLeads() {
  if (!els.clearLeadsBtn) return;
  const total = state.meta?.totalLeads ?? state.statusCounts?.all ?? state.leads.length;
  const confirmed = window.confirm(
    total
      ? `Erase all ${total} lead${total === 1 ? "" : "s"} from the board?\n\nYour status memory is kept (in a network, ineligible, etc.) so those accounts will not reappear in New.`
      : "Erase all leads from the board?\n\nYour status memory is kept so previously tagged accounts will not reappear in New."
  );
  if (!confirmed) return;

  els.clearLeadsBtn.disabled = true;
  if (els.refreshBtn) els.refreshBtn.disabled = true;
  if (els.copyLeadsBtn) els.copyLeadsBtn.disabled = true;
  els.clearLeadsBtn.textContent = "Clearing…";
  showError("");

  try {
    await api("/api/leads", { method: "DELETE" });
    state.allLeadsCache = null;
    state.leads = [];
    applyStatusCounts([]);
    await loadMeta();
    await loadLeads();
    if (state.activeTab === "copy") await loadCopyLeads();
    showToast("All leads erased");
  } catch (error) {
    showError(error.message);
  } finally {
    els.clearLeadsBtn.disabled = false;
    if (els.refreshBtn) els.refreshBtn.disabled = false;
    if (els.copyLeadsBtn) els.copyLeadsBtn.disabled = false;
    els.clearLeadsBtn.textContent = "Erase all leads";
  }
}

if (els.clearLeadsBtn) {
  els.clearLeadsBtn.addEventListener("click", () => {
    clearAllLeads().catch((err) => showError(err.message));
  });
}

if (els.logoutBtn) {
  els.logoutBtn.addEventListener("click", async () => {
    try {
      await api("/api/auth/logout", { method: "POST", body: "{}" });
    } catch {
      // still leave
    }
    window.location.href = "/";
  });
}

const notifyWrap = els.notifyBell?.closest(".notify-wrap");

if (els.notifyBell) {
  els.notifyBell.addEventListener("click", (event) => {
    event.stopPropagation();
    setNotifyPanelOpen(!notifyPanelOpen);
  });
}

if (notifyWrap) {
  notifyWrap.addEventListener("mouseenter", () => {
    clearNotifyHoverDismiss();
    setNotifyPanelOpen(true);
  });
  notifyWrap.addEventListener("mouseleave", () => {
    scheduleNotifyHoverDismiss();
  });
}

if (els.notifyClear) {
  els.notifyClear.addEventListener("click", (event) => {
    event.stopPropagation();
    saveNotifyHistory([]);
    setUnreadCount(0);
    renderNotifyPanel();
  });
}

document.addEventListener("click", (event) => {
  if (!notifyPanelOpen) return;
  if (notifyWrap && notifyWrap.contains(event.target)) return;
  setNotifyPanelOpen(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && notifyPanelOpen) {
    setNotifyPanelOpen(false);
  }
});

els.leadSearch.addEventListener("input", () => {
  state.searchQuery = els.leadSearch.value;
  // Non-empty search from Copy/DM (or any non-Leads tab) → show results on Leads.
  if (normalizeSearchQuery(state.searchQuery) && state.activeTab !== "leads") {
    setTab("leads");
  }
  loadLeads().catch((err) => showError(err.message));
});

els.copyStatus.addEventListener("change", () => {
  state.copyFilter = els.copyStatus.value;
  loadCopyLeads().catch((err) => showError(err.message));
});

async function init() {
  updateNotifyBadge();
  try {
    const me = await api("/api/auth/me");
    if (!me.user) {
      window.location.href = "/?login=1";
      return;
    }
    if (me.user.role === "admin") {
      window.location.href = "/admin";
      return;
    }
    if (els.userChip) {
      els.userChip.hidden = false;
      els.userChip.textContent = `@${me.user.username}`;
    }

    const meta = await loadMeta();
    renderFilters();
    renderCopyStatusOptions();

    // Server is source of truth; restore any newer/missing statuses from localStorage.
    const all = await api("/api/leads");
    const serverLeads = all.leads || [];
    await reconcileStatusBackup(serverLeads);
    syncBackupFromLeads(serverLeads);
    applyStatusCounts(serverLeads);
    renderFilters();

    await loadLeads();
    // Users don't trigger scrapes — skip admin refresh-error toasts.
    if (els.refreshBtn) {
      await consumeLastRefreshError(meta);
      if (meta.refreshInProgress) {
        watchRefreshUntilIdle({ announce: true });
      }
    }
  } catch (error) {
    showError(error.message || "Failed to load CreatorRadar.");
  }
}

init();
