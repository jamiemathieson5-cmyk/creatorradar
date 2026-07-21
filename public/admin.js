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

/** Cumulative pipeline stages for outreach conversion (current CRM status). */
const FUNNEL_STAGES = [
  { id: "collected", label: "Collected", statuses: null },
  {
    id: "contacted",
    label: "Contacted",
    statuses: ["contacted", "in_network", "applied", "approved_joined"],
  },
  {
    id: "in_network",
    label: "In a network",
    statuses: ["in_network", "applied", "approved_joined"],
  },
  {
    id: "applied",
    label: "Applied",
    statuses: ["applied", "approved_joined"],
  },
  {
    id: "approved_joined",
    label: "Approved / joined",
    statuses: ["approved_joined"],
  },
];

const CRM_PAGE_SIZE = 30;

const els = {
  metaTotal: document.getElementById("meta-total"),
  metaPool: document.getElementById("meta-pool"),
  metaMode: document.getElementById("meta-mode"),
  metaProxy: document.getElementById("meta-proxy"),
  metaRefresh: document.getElementById("meta-refresh"),
  errorBanner: document.getElementById("error-banner"),
  refreshBtn: document.getElementById("refresh-btn"),
  clearLeadsBtn: document.getElementById("clear-leads-btn"),
  copyLeadsBtn: document.getElementById("copy-leads-btn"),
  logoutBtn: document.getElementById("logout-btn"),
  accountTrigger: document.getElementById("account-trigger"),
  accountLabel: document.getElementById("account-label"),
  accountAvatar: document.getElementById("account-avatar"),
  notifyRoot: document.getElementById("admin-notify"),
  notifyBell: document.getElementById("notify-bell"),
  notifyBadge: document.getElementById("notify-badge"),
  notifyPanel: document.getElementById("notify-panel"),
  notifyList: document.getElementById("notify-list"),
  notifyEmpty: document.getElementById("notify-empty"),
  notifyClear: document.getElementById("notify-clear"),
  statGrid: document.getElementById("stat-grid"),
  conversionFunnel: document.getElementById("conversion-funnel"),
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
  issuedUsername: document.getElementById("issued-username"),
  issuedPassword: document.getElementById("issued-password"),
  copyLoginDetailsBtn: document.getElementById("copy-login-details-btn"),
  assignTbody: document.getElementById("assign-tbody"),
  usersEmpty: document.getElementById("users-empty"),
  reclaimModalRoot: document.getElementById("reclaim-modal-root"),
  reclaimForm: document.getElementById("reclaim-form"),
  reclaimUserId: document.getElementById("reclaim-user-id"),
  reclaimCount: document.getElementById("reclaim-count"),
  reclaimStatus: document.getElementById("reclaim-status"),
  reclaimConfirmHint: document.getElementById("reclaim-confirm-hint"),
  reclaimSubmitBtn: document.getElementById("reclaim-submit-btn"),
  reclaimModalSub: document.getElementById("reclaim-modal-sub"),
  crmBody: document.getElementById("crm-body"),
  crmToggle: document.getElementById("crm-toggle"),
  crmShowMore: document.getElementById("crm-show-more"),
  crmTruncHint: document.getElementById("crm-trunc-hint"),
  statusFilters: document.getElementById("status-filters"),
  leadSearch: document.getElementById("lead-search"),
  leadList: document.getElementById("lead-list"),
  leadsEmpty: document.getElementById("leads-empty"),
  toast: document.getElementById("toast"),
  eaTbody: document.getElementById("ea-tbody"),
  eaEmpty: document.getElementById("ea-empty"),
  eaRefreshBtn: document.getElementById("ea-refresh-btn"),
  eaMailHint: document.getElementById("ea-mail-hint"),
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
  crmExpanded: false,
  crmVisibleLimit: CRM_PAGE_SIZE,
  earlyAccess: [],
  earlyAccessMail: null,
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

/**
 * Region chip for lead meta. `feed_gb` means UK-feed keep without confirmed
 * creator country — never display that as confirmed GB.
 */
function regionMetaLabel(lead) {
  const src = String(lead?.regionSource || "");
  if (src === "feed_gb") return "Feed";
  if (lead?.region) return lead.region;
  if (src === "feed_gb_signal") return "Feed";
  return null;
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

let notifyHoverDismissTimer = null;

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
    setNotifyOpen(false);
  }, 180);
}

function updateNotifyBadge() {
  if (!els.notifyBadge) return;
  const unread = Number(state.unreadCount) || 0;
  if (unread <= 0) {
    els.notifyBadge.classList.add("hidden");
    els.notifyBadge.textContent = "0";
    if (els.notifyBell) {
      els.notifyBell.setAttribute("aria-label", "Notifications");
    }
    return;
  }
  els.notifyBadge.textContent = unread > 99 ? "99+" : String(unread);
  els.notifyBadge.classList.remove("hidden");
  if (els.notifyBell) {
    els.notifyBell.setAttribute("aria-label", `Notifications, ${unread} unread`);
  }
}

function renderNotifications() {
  if (!els.notifyList || !els.notifyEmpty) return;
  updateNotifyBadge();

  const items = state.notifications || [];
  els.notifyList.innerHTML = "";
  if (!items.length) {
    els.notifyEmpty.classList.remove("hidden");
    return;
  }
  els.notifyEmpty.classList.add("hidden");
  const frag = document.createDocumentFragment();
  for (const n of items) {
    const li = document.createElement("li");
    li.className = `notify-item${n.readAt ? "" : " is-unread"}`;
    const msg = document.createElement("span");
    msg.className = "notify-item-msg";
    msg.textContent = n.detail
      ? `${n.title || "Notification"} — ${n.detail}`
      : n.title || "Notification";
    const time = document.createElement("span");
    time.className = "notify-item-time";
    time.textContent = formatRelative(n.createdAt);
    li.append(msg, time);
    frag.appendChild(li);
  }
  els.notifyList.appendChild(frag);
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

async function clearNotificationHistory() {
  const data = await api("/api/admin/notifications/clear", {
    method: "POST",
    body: JSON.stringify({}),
  });
  state.notifications = data.notifications || [];
  state.unreadCount = data.unreadCount || 0;
  renderNotifications();
}

function setNotifyOpen(open) {
  clearNotifyHoverDismiss();
  state.notifyOpen = Boolean(open);
  if (!els.notifyPanel || !els.notifyBell) return;
  els.notifyBell.setAttribute("aria-expanded", state.notifyOpen ? "true" : "false");
  if (state.notifyOpen) {
    els.notifyPanel.classList.remove("hidden");
    els.notifyPanel.hidden = false;
  } else {
    els.notifyPanel.classList.add("hidden");
    els.notifyPanel.hidden = true;
  }
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

function pasteShortcutHint() {
  const mac =
    /Mac|iPhone|iPad|iPod/.test(navigator.platform) ||
    (navigator.userAgentData?.platform || "").includes("macOS") ||
    /Mac OS X/.test(navigator.userAgent);
  return mac ? "Cmd+V" : "Ctrl+V";
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

/** Resolve assignee handle from overview assignments (admin-only context). */
function assigneeLabel(lead) {
  const uid = lead?.assignedToUserId;
  if (!uid) return "pool";
  const row = (state.overview?.assignments || []).find((a) => a.userId === uid);
  return row?.username ? `@${row.username}` : "assigned";
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

/** Prefill CRM search with a handle so the list shows only that creator. */
function prefillLeadSearch(username) {
  const handle = String(username || "")
    .replace(/^@+/, "")
    .trim();
  if (!handle || !els.leadSearch) return;
  state.searchQuery = handle;
  els.leadSearch.value = handle;
  state.crmVisibleLimit = CRM_PAGE_SIZE;
  if (!state.crmExpanded) setCrmExpanded(true);
  else {
    renderFilters();
    renderLeads();
  }
}

async function openLeadMessage(lead, url) {
  const target = url || lead.messageUrl || messageUrl(lead);
  prefillLeadSearch(lead?.username);
  const dm = generateLeadDm(lead);
  const copyPromise = dm ? copyText(dm) : Promise.resolve(false);
  window.open(target, "_blank", "noopener,noreferrer");
  const copied = await copyPromise;
  if (copied) {
    showToast(`DM copied — paste in TikTok (${pasteShortcutHint()})`);
  } else if (dm) {
    showToast("DM generated but copy failed — set templates in /app DM Generator");
  } else {
    showToast("Opened TikTok — set a DM template in /app DM Generator to auto-copy");
  }
}

/** PATCH lead status; keep current filter/search (unlike /app). */
async function applyLeadStatus(lead, status) {
  const { lead: updated } = await api(`/api/leads/${lead.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  const idx = state.leads.findIndex((l) => l.id === lead.id);
  if (idx >= 0) {
    state.leads[idx] = { ...state.leads[idx], ...updated };
  } else {
    Object.assign(lead, updated);
  }
  showToast(`Marked @${updated.username} as ${labelFor(updated.status)}`, {
    ms: 2200,
  });
  renderFilters();
  renderLeads();
  await loadOverview().catch(() => {});
  return updated;
}

function sumStatuses(byStatus, statuses) {
  if (!statuses) return 0;
  let n = 0;
  for (const status of statuses) {
    n += Number(byStatus[status]) || 0;
  }
  return n;
}

function formatPct(part, whole) {
  if (!whole || whole <= 0) return "—";
  const pct = (100 * part) / whole;
  if (pct >= 10) return `${Math.round(pct)}%`;
  if (pct >= 1) return `${pct.toFixed(1)}%`;
  if (part > 0) return "<1%";
  return "0%";
}

function renderFunnel() {
  if (!els.conversionFunnel) return;
  const o = state.overview || {};
  const byStatus = o.byStatus || {};
  const collected = Number(o.totalLeads) || 0;

  const stages = FUNNEL_STAGES.map((stage) => {
    const count =
      stage.statuses == null ? collected : sumStatuses(byStatus, stage.statuses);
    return { ...stage, count };
  });

  const maxCount = Math.max(collected, 1);
  els.conversionFunnel.innerHTML = "";

  const title = document.createElement("h3");
  title.className = "funnel-title";
  title.textContent = "Conversion funnel";
  els.conversionFunnel.appendChild(title);

  const list = document.createElement("ol");
  list.className = "funnel-stages";

  stages.forEach((stage, index) => {
    const prev = index === 0 ? null : stages[index - 1];
    const ofPrev = prev ? formatPct(stage.count, prev.count) : null;
    const ofCollected = index === 0 ? null : formatPct(stage.count, collected);
    const widthPct = Math.max(8, Math.round((100 * stage.count) / maxCount));

    const li = document.createElement("li");
    li.className = "funnel-stage";
    li.innerHTML = `
      <div class="funnel-stage-head">
        <span class="funnel-label">${escapeHtml(stage.label)}</span>
        <span class="funnel-count">${stage.count}</span>
      </div>
      <div class="funnel-bar-track" aria-hidden="true">
        <div class="funnel-bar" style="width:${widthPct}%"></div>
      </div>
      ${
        ofPrev
          ? `<p class="funnel-conv">${escapeHtml(ofPrev)} of previous · ${escapeHtml(
              ofCollected
            )} of collected</p>`
          : `<p class="funnel-conv">All leads in CRM</p>`
      }
    `;
    list.appendChild(li);
  });

  els.conversionFunnel.appendChild(list);
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

  renderFunnel();

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

    const newCount = row.byStatus?.new || 0;
    const contactedCount = row.byStatus?.contacted || 0;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>@${row.username}</td>
      <td>${row.total}</td>
      <td>${newCount}</td>
      <td>${contactedCount}</td>
      <td class="assign-actions">
        <button
          type="button"
          class="btn btn-ghost btn-compact"
          data-reclaim-user="${row.userId}"
          ${row.total ? "" : "disabled"}
        >
          Take back
        </button>
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
    const reclaimBtn = tr.querySelector("[data-reclaim-user]");
    reclaimBtn?.addEventListener("click", () => {
      openReclaimModal(row);
    });
    const deleteBtn = tr.querySelector("[data-delete-user]");
    deleteBtn?.addEventListener("click", () => {
      closeUserAccount(row.userId, row.username, row.total || 0);
    });
    els.assignTbody.appendChild(tr);
  }
}

function reclaimStatusLabel(status) {
  if (status === "any" || status === "all") return "any status";
  return labelFor(status) || status || "New";
}

function updateReclaimHint() {
  if (!els.reclaimConfirmHint) return;
  const handle = els.reclaimModalRoot?.dataset.username || "user";
  const count = Math.max(1, Math.floor(Number(els.reclaimCount?.value) || 0));
  const status = els.reclaimStatus?.value || "new";
  const available = Number(els.reclaimModalRoot?.dataset.available || 0);
  const willTake = Math.min(count, available);
  els.reclaimConfirmHint.textContent = available
    ? `About to return up to ${willTake} lead${willTake === 1 ? "" : "s"} (${reclaimStatusLabel(
        status
      )}) from @${handle} to the unassigned pool. ${available} matching assigned.`
    : `No matching assigned leads for @${handle} (${reclaimStatusLabel(status)}).`;
  if (els.reclaimSubmitBtn) {
    els.reclaimSubmitBtn.disabled = !available || willTake < 1;
  }
}

function availableForReclaim(row, status) {
  if (!row) return 0;
  if (status === "any" || status === "all") return Number(row.total) || 0;
  return Number(row.byStatus?.[status]) || 0;
}

function openReclaimModal(row) {
  if (!els.reclaimModalRoot || !row?.userId) return;
  const handle = row.username || "user";
  const newCount = Number(row.byStatus?.new) || 0;
  const defaultCount = Math.min(10, Math.max(1, newCount || row.total || 1));
  els.reclaimModalRoot.dataset.username = handle;
  els.reclaimModalRoot.dataset.total = String(row.total || 0);
  els.reclaimModalRoot._row = row;
  if (els.reclaimUserId) els.reclaimUserId.value = row.userId;
  if (els.reclaimStatus) els.reclaimStatus.value = "new";
  if (els.reclaimCount) {
    els.reclaimCount.value = String(defaultCount);
    els.reclaimCount.max = String(Math.max(1, row.total || 1));
  }
  if (els.reclaimModalSub) {
    els.reclaimModalSub.textContent = `@${handle} has ${row.total || 0} assigned (${newCount} New). Leads are kept — only unassigned to the pool.`;
  }
  const available = availableForReclaim(row, "new");
  els.reclaimModalRoot.dataset.available = String(available);
  updateReclaimHint();
  els.reclaimModalRoot.classList.remove("hidden");
  els.reclaimModalRoot.hidden = false;
  els.reclaimCount?.focus();
}

function closeReclaimModal() {
  if (!els.reclaimModalRoot) return;
  els.reclaimModalRoot.classList.add("hidden");
  els.reclaimModalRoot.hidden = true;
  delete els.reclaimModalRoot._row;
}

async function submitReclaim(event) {
  event.preventDefault();
  const userId = els.reclaimUserId?.value;
  const count = Number(els.reclaimCount?.value);
  const status = els.reclaimStatus?.value || "new";
  const handle = els.reclaimModalRoot?.dataset.username || "user";
  if (!userId || !Number.isFinite(count) || count < 1) {
    showToast("Enter a valid count.");
    return;
  }
  const available = Number(els.reclaimModalRoot?.dataset.available || 0);
  const willTake = Math.min(count, available);
  const ok = window.confirm(
    `Reclaim ${willTake} lead${willTake === 1 ? "" : "s"} (${reclaimStatusLabel(
      status
    )}) from @${handle}?\n\nThey return to the unassigned pool. Leads are not deleted.`
  );
  if (!ok) return;

  if (els.reclaimSubmitBtn) els.reclaimSubmitBtn.disabled = true;
  try {
    const result = await api("/api/admin/leads/reclaim", {
      method: "POST",
      body: JSON.stringify({ userId, count, status }),
    });
    if (result.overview) {
      state.overview = result.overview;
      renderOverview();
      renderUsers();
    } else {
      await loadOverview();
    }
    await loadLeads();
    closeReclaimModal();
    const n = result.reclaimed || 0;
    showToast(
      n
        ? `Reclaimed ${n} lead${n === 1 ? "" : "s"} from @${handle}`
        : `No matching leads to reclaim from @${handle}`
    );
    await loadNotifications().catch(() => {});
  } catch (error) {
    showToast(error.message || "Failed to reclaim leads.");
  } finally {
    if (els.reclaimSubmitBtn) els.reclaimSubmitBtn.disabled = false;
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

function filteredLeads() {
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
  return [...list].sort((a, b) => {
    const ta = Date.parse(a.updatedAt || "") || 0;
    const tb = Date.parse(b.updatedAt || "") || 0;
    return tb - ta;
  });
}

function setCrmExpanded(expanded) {
  state.crmExpanded = Boolean(expanded);
  if (els.crmBody) {
    els.crmBody.classList.toggle("is-collapsed", !state.crmExpanded);
  }
  if (els.crmToggle) {
    els.crmToggle.setAttribute("aria-expanded", state.crmExpanded ? "true" : "false");
    els.crmToggle.textContent = state.crmExpanded ? "Hide leads" : "Show leads";
  }
  if (state.crmExpanded) {
    renderFilters();
    renderLeads();
  }
}

function renderFilters() {
  if (!els.statusFilters || !state.crmExpanded) return;
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
      state.crmVisibleLimit = CRM_PAGE_SIZE;
      renderFilters();
      renderLeads();
    });
    els.statusFilters.appendChild(button);
  }
}

function renderLeads() {
  if (!els.leadList) return;
  if (!state.crmExpanded) {
    els.leadList.innerHTML = "";
    if (els.crmShowMore) els.crmShowMore.classList.add("hidden");
    if (els.crmTruncHint) els.crmTruncHint.classList.add("hidden");
    if (els.leadsEmpty) els.leadsEmpty.classList.add("hidden");
    return;
  }

  const list = filteredLeads();
  const limit = Math.max(CRM_PAGE_SIZE, Number(state.crmVisibleLimit) || CRM_PAGE_SIZE);
  const visible = list.slice(0, limit);
  const remaining = Math.max(0, list.length - visible.length);

  els.leadList.innerHTML = "";
  if (!list.length) {
    if (els.leadsEmpty) els.leadsEmpty.classList.remove("hidden");
    if (els.crmShowMore) els.crmShowMore.classList.add("hidden");
    if (els.crmTruncHint) els.crmTruncHint.classList.add("hidden");
    return;
  }
  if (els.leadsEmpty) els.leadsEmpty.classList.add("hidden");

  const frag = document.createDocumentFragment();
  for (const lead of visible) {
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
    const regionLabel = regionMetaLabel(lead);
    if (regionLabel) bits.push(regionLabel);
    bits.push(assigneeLabel(lead));
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
        showToast(error.message);
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
        showToast(error.message);
      }
    });

    regionBtn.addEventListener("click", async () => {
      setQuickBusy(true);
      try {
        await applyLeadStatus(lead, "unsupported_region");
      } catch (error) {
        setQuickBusy(false);
        showToast(error.message);
      }
    });

    networkBtn.addEventListener("click", async () => {
      setQuickBusy(true);
      try {
        await applyLeadStatus(lead, "in_network");
      } catch (error) {
        setQuickBusy(false);
        showToast(error.message);
      }
    });

    dmsOffBtn.addEventListener("click", async () => {
      setQuickBusy(true);
      try {
        await applyLeadStatus(lead, "dms_off");
      } catch (error) {
        setQuickBusy(false);
        showToast(error.message);
      }
    });

    ineligibleBtn.addEventListener("click", async () => {
      setQuickBusy(true);
      try {
        await applyLeadStatus(lead, "ineligible");
      } catch (error) {
        setQuickBusy(false);
        showToast(error.message);
      }
    });

    premBtn.addEventListener("click", async () => {
      setQuickBusy(true);
      try {
        await applyLeadStatus(lead, "premium_invite_required");
      } catch (error) {
        setQuickBusy(false);
        showToast(error.message);
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
    const statusLabelId = `admin-lead-status-${lead.id}`;
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
    frag.appendChild(row);
  }
  els.leadList.appendChild(frag);

  if (els.crmShowMore) {
    if (remaining > 0) {
      const nextBatch = Math.min(CRM_PAGE_SIZE, remaining);
      els.crmShowMore.classList.remove("hidden");
      els.crmShowMore.textContent = `Show ${nextBatch} more`;
    } else {
      els.crmShowMore.classList.add("hidden");
    }
  }
  if (els.crmTruncHint) {
    if (list.length > CRM_PAGE_SIZE || remaining > 0) {
      els.crmTruncHint.classList.remove("hidden");
      els.crmTruncHint.textContent =
        remaining > 0
          ? `Showing ${visible.length} of ${list.length} (most recently updated)`
          : `Showing all ${list.length} matching leads`;
    } else {
      els.crmTruncHint.classList.add("hidden");
      els.crmTruncHint.textContent = "";
    }
  }
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

function renderEarlyAccess() {
  if (!els.eaTbody) return;
  const rows = state.earlyAccess || [];
  if (els.eaMailHint && state.earlyAccessMail) {
    const mail = state.earlyAccessMail;
    if (mail.configured && mail.provider === "resend") {
      els.eaMailHint.textContent =
        "Email delivery: Resend is configured. Requests also appear here and in data/early-access.json.";
    } else if (mail.configured && mail.provider === "smtp") {
      els.eaMailHint.textContent =
        "Email delivery: Gmail/SMTP is configured (App Password path). Prefer RESEND_API_KEY if you want API-key-only setup.";
    } else {
      els.eaMailHint.innerHTML =
        "Email not configured — requests still save here. Recommended Railway vars: <code>RESEND_API_KEY</code> + <code>EARLY_ACCESS_TO</code>. Optional: <code>GMAIL_USER</code> + <code>GMAIL_APP_PASSWORD</code> (16-char App Password only, never your normal Gmail password).";
    }
  }
  if (!rows.length) {
    els.eaTbody.innerHTML = "";
    els.eaEmpty?.classList.remove("hidden");
    return;
  }
  els.eaEmpty?.classList.add("hidden");
  els.eaTbody.innerHTML = "";
  for (const row of rows) {
    const when = formatWhen(row.createdAt);
    const mailCell = row.emailed
      ? `<span class="ea-mail-ok">Sent</span>`
      : `<span class="ea-mail-off" title="${escapeHtml(row.emailError || "Not emailed")}">Saved</span>`;
    const emailCell = row.email
      ? `<a href="mailto:${escapeHtml(row.email)}">${escapeHtml(row.email)}</a>`
      : "—";
    const tr = document.createElement("tr");
    tr.innerHTML = `
        <td>${escapeHtml(when)}</td>
        <td>${escapeHtml(row.name)}</td>
        <td>${emailCell}</td>
        <td>${escapeHtml(row.organization || "—")}</td>
        <td class="ea-reason">${escapeHtml(row.reason)}</td>
        <td>${mailCell}</td>
        <td class="ea-actions">
          <button type="button" class="btn btn-danger btn-compact" data-ea-dismiss>
            Dismiss
          </button>
        </td>
      `;
    tr.querySelector("[data-ea-dismiss]")?.addEventListener("click", () => {
      dismissEarlyAccess(row.id, row.name, row.email);
    });
    els.eaTbody.appendChild(tr);
  }
}

async function dismissEarlyAccess(id, name, email) {
  const label = name || email || "this request";
  const ok = window.confirm(
    `Dismiss early access request from ${label}?\n\nThis permanently removes it from the list (not interested).`
  );
  if (!ok) return;
  try {
    await api(`/api/admin/early-access/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    showToast(`Dismissed request from ${label}`);
    await loadEarlyAccess();
  } catch (error) {
    showError(error.message || "Could not dismiss request.");
  }
}

async function loadEarlyAccess() {
  const data = await api("/api/admin/early-access");
  state.earlyAccess = data.submissions || [];
  state.earlyAccessMail = data.mail || null;
  renderEarlyAccess();
  return data;
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
  if (state.crmExpanded) {
    renderFilters();
    renderLeads();
  }
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

els.eaRefreshBtn?.addEventListener("click", async () => {
  try {
    await loadEarlyAccess();
    showToast("Early access list refreshed.");
  } catch (error) {
    showError(error.message || "Could not refresh early access list.");
  }
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

const LOGIN_URL = "https://tiktokcreatorradar.com";

function formatLoginDetailsMessage(username, password) {
  return [
    "CreatorRadar login",
    `Username: ${username}`,
    `Password: ${password}`,
    `Log in at: ${LOGIN_URL}`,
  ].join("\n");
}

function showIssuedLoginDetails(username, password) {
  if (!els.createUserResult) return;
  if (els.issuedUsername) els.issuedUsername.textContent = username;
  if (els.issuedPassword) els.issuedPassword.textContent = password;
  els.createUserResult.dataset.username = username;
  els.createUserResult.dataset.password = password;
  els.createUserResult.classList.remove("hidden");
}

function hideIssuedLoginDetails() {
  if (!els.createUserResult) return;
  els.createUserResult.classList.add("hidden");
  delete els.createUserResult.dataset.username;
  delete els.createUserResult.dataset.password;
  if (els.issuedUsername) els.issuedUsername.textContent = "";
  if (els.issuedPassword) els.issuedPassword.textContent = "";
}

els.copyLoginDetailsBtn?.addEventListener("click", async () => {
  const username = els.createUserResult?.dataset.username || "";
  const password = els.createUserResult?.dataset.password || "";
  if (!username || !password) {
    showToast("No login details to copy");
    return;
  }
  try {
    await navigator.clipboard.writeText(formatLoginDetailsMessage(username, password));
    showToast("Login details copied");
  } catch {
    showToast("Copy failed");
  }
});

els.createUserForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!els.createUserBtn) return;
  els.createUserBtn.disabled = true;
  hideIssuedLoginDetails();
  try {
    const password = String(els.createPassword?.value || "").trim();
    if (!password) {
      showToast("Password is required");
      return;
    }
    if (password.length < 8) {
      showToast("Password must be at least 8 characters");
      return;
    }
    const result = await api("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        username: els.createUsername?.value,
        password,
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
    showIssuedLoginDetails(user.username, password);
    showToast(`User @${user.username} created`);
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

els.reclaimForm?.addEventListener("submit", submitReclaim);
els.reclaimCount?.addEventListener("input", updateReclaimHint);
els.reclaimStatus?.addEventListener("change", () => {
  const row = els.reclaimModalRoot?._row;
  const status = els.reclaimStatus?.value || "new";
  if (row && els.reclaimModalRoot) {
    els.reclaimModalRoot.dataset.available = String(availableForReclaim(row, status));
  }
  updateReclaimHint();
});
els.reclaimModalRoot?.querySelectorAll("[data-reclaim-close]").forEach((node) => {
  node.addEventListener("click", () => closeReclaimModal());
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (els.reclaimModalRoot && !els.reclaimModalRoot.hidden) {
    closeReclaimModal();
  }
});

els.leadSearch?.addEventListener("input", () => {
  state.searchQuery = els.leadSearch.value;
  state.crmVisibleLimit = CRM_PAGE_SIZE;
  renderLeads();
});

els.crmToggle?.addEventListener("click", () => {
  if (!state.crmExpanded) {
    state.crmVisibleLimit = CRM_PAGE_SIZE;
  }
  setCrmExpanded(!state.crmExpanded);
});

els.crmShowMore?.addEventListener("click", () => {
  state.crmVisibleLimit =
    (Number(state.crmVisibleLimit) || CRM_PAGE_SIZE) + CRM_PAGE_SIZE;
  renderLeads();
});

const notifyWrap = els.notifyRoot || els.notifyBell?.closest(".notify-wrap");

els.notifyBell?.addEventListener("click", (event) => {
  event.stopPropagation();
  if (state.notifyOpen) {
    closeNotifications();
    return;
  }
  openNotifications().catch(() => {});
});

if (notifyWrap) {
  notifyWrap.addEventListener("mouseenter", () => {
    clearNotifyHoverDismiss();
    if (!state.notifyOpen) {
      openNotifications().catch(() => {});
    }
  });
  notifyWrap.addEventListener("mouseleave", () => {
    scheduleNotifyHoverDismiss();
  });
}

els.notifyClear?.addEventListener("click", (event) => {
  event.stopPropagation();
  clearNotificationHistory().catch((error) => {
    showToast(error.message || "Failed to clear notifications");
  });
});

document.addEventListener("click", (event) => {
  if (!state.notifyOpen) return;
  if (notifyWrap && notifyWrap.contains(event.target)) return;
  closeNotifications();
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
    if (window.CreatorRadarAccount?.mountAccountMenu) {
      window.CreatorRadarAccount.mountAccountMenu({
        isAdmin: true,
        initialUser: me.user,
        showToast,
      });
    }
    const meta = await loadOverview();
    await loadLeads();
    await loadEarlyAccess().catch(() => {});
    await loadNotifications().catch(() => {});
    if (meta?.refreshInProgress || meta?.refreshProgress?.running) {
      watchRefreshUntilIdle({ announce: true });
    }
  } catch (error) {
    showError(error.message || "Failed to load admin dashboard.");
  }
}

init();
