/**
 * Public early-access waitlist: validate, rate-limit, persist, email.
 *
 * Email delivery (prefer first configured):
 *   1. Resend — RESEND_API_KEY (+ EARLY_ACCESS_TO). API key only; no Gmail login.
 *   2. Gmail SMTP — GMAIL_USER (address only) + GMAIL_APP_PASSWORD
 *      (16-char Google App Password from Security → App passwords after 2FA;
 *      NEVER the normal Gmail password). Or generic SMTP_* vars.
 *
 * Submissions always save to data/early-access.json. Email is best-effort.
 * Admins can review requests via GET /api/admin/early-access without email.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "..", "data");
const STORE_PATH = path.join(DATA_DIR, "early-access.json");

const DEFAULT_TO = "jamiemathieson5@gmail.com";
const DEFAULT_RESEND_FROM = "CreatorRadar <onboarding@resend.dev>";
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX = 5;
const MAX_NAME = 120;
const MAX_EMAIL = 254;
const MIN_ORG = 2;
const MAX_ORG = 120;
const MIN_REASON = 50;
const MAX_REASON = 500;

/** @type {Map<string, number[]>} */
const hitsByIp = new Map();

let nodemailer = null;
try {
  nodemailer = require("nodemailer");
} catch {
  nodemailer = null;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readStore() {
  try {
    if (!fs.existsSync(STORE_PATH)) return { submissions: [] };
    const data = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    if (!data || !Array.isArray(data.submissions)) return { submissions: [] };
    return data;
  } catch {
    return { submissions: [] };
  }
}

function writeStore(data) {
  ensureDataDir();
  const tmp = `${STORE_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, STORE_PATH);
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim().slice(0, 64);
  }
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

function rateLimitOk(ip) {
  const now = Date.now();
  const prev = hitsByIp.get(ip) || [];
  const recent = prev.filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) {
    hitsByIp.set(ip, recent);
    return false;
  }
  recent.push(now);
  hitsByIp.set(ip, recent);
  return true;
}

function normalizeText(value, max) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, max);
}

function isValidEmail(email) {
  if (!email || email.length > MAX_EMAIL) return false;
  // Practical check — not full RFC.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function resolveToAddress() {
  return (process.env.EARLY_ACCESS_TO || DEFAULT_TO).trim() || DEFAULT_TO;
}

function resolveSmtpConfig() {
  const to = resolveToAddress();
  // GMAIL_USER is the sender address only (public-ish) — not a login secret.
  // GMAIL_APP_PASSWORD must be a 16-character Google App Password, never the
  // normal account password (Security → 2-Step Verification → App passwords).
  const gmailUser = (process.env.GMAIL_USER || "").trim();
  const gmailPass = (process.env.GMAIL_APP_PASSWORD || "").trim();
  const smtpUser = (process.env.SMTP_USER || gmailUser || "").trim();
  const smtpPass = (process.env.SMTP_PASS || gmailPass || "").trim();
  const host = (process.env.SMTP_HOST || (gmailUser ? "smtp.gmail.com" : "")).trim();
  const portRaw = process.env.SMTP_PORT || (host === "smtp.gmail.com" ? "587" : "");
  const port = Number(portRaw) || 587;
  const from =
    (process.env.EARLY_ACCESS_FROM || smtpUser || "").trim() ||
    `"CreatorRadar Early Access" <${smtpUser}>`;

  if (!host || !smtpUser || !smtpPass) {
    return { configured: false, to, from, host, port, smtpUser, smtpPass };
  }
  return { configured: true, to, from, host, port, smtpUser, smtpPass };
}

function resolveResendConfig() {
  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  const to = resolveToAddress();
  const from =
    (process.env.RESEND_FROM || process.env.EARLY_ACCESS_FROM || "").trim() ||
    DEFAULT_RESEND_FROM;
  return {
    configured: Boolean(apiKey),
    apiKey,
    to,
    from,
  };
}

function mailProviderStatus() {
  const resend = resolveResendConfig();
  const smtp = resolveSmtpConfig();
  if (resend.configured) return { provider: "resend", configured: true };
  if (smtp.configured) return { provider: "smtp", configured: true };
  return { provider: null, configured: false };
}

function buildEmailBodies(entry) {
  const subject = `CreatorRadar early access: ${entry.name}`;
  const text = [
    "New CreatorRadar early access request",
    "",
    `Name: ${entry.name}`,
    `Email: ${entry.email}`,
    `Network / Agency / Team: ${entry.organization || ""}`,
    "",
    "Why they want access:",
    entry.reason,
    "",
    `Submitted at: ${entry.createdAt}`,
    `Id: ${entry.id}`,
  ].join("\n");

  const html = `
    <h2>New CreatorRadar early access request</h2>
    <p><strong>Name:</strong> ${escapeHtml(entry.name)}<br/>
    <strong>Email:</strong> ${escapeHtml(entry.email)}<br/>
    <strong>Network / Agency / Team:</strong> ${escapeHtml(entry.organization || "")}</p>
    <p><strong>Why they want access:</strong></p>
    <p>${escapeHtml(entry.reason).replace(/\n/g, "<br/>")}</p>
    <p style="color:#666;font-size:12px">Submitted at ${escapeHtml(entry.createdAt)} · Id ${escapeHtml(entry.id)}</p>
  `;

  return { subject, text, html };
}

async function sendViaResend(entry) {
  const cfg = resolveResendConfig();
  if (!cfg.configured) {
    return { sent: false, skipped: true };
  }

  const { subject, text, html } = buildEmailBodies(entry);

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: cfg.from,
        to: [cfg.to],
        reply_to: entry.email,
        subject,
        text,
        html,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      const snippet = detail.slice(0, 240);
      return {
        sent: false,
        error: `Resend HTTP ${response.status}${snippet ? `: ${snippet}` : ""}`,
      };
    }
    return { sent: true, provider: "resend" };
  } catch (error) {
    return {
      sent: false,
      error: error && error.message ? error.message : "Resend request failed",
    };
  }
}

async function sendViaSmtp(entry) {
  const cfg = resolveSmtpConfig();
  if (!cfg.configured) {
    return { sent: false, skipped: true };
  }
  if (!nodemailer) {
    return {
      sent: false,
      error: "Nodemailer is not installed. Run npm install on the server.",
    };
  }

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: {
      user: cfg.smtpUser,
      pass: cfg.smtpPass,
    },
  });

  const { subject, text, html } = buildEmailBodies(entry);

  try {
    await transporter.sendMail({
      from: cfg.from,
      to: cfg.to,
      replyTo: entry.email,
      subject,
      text,
      html,
    });
    return { sent: true, provider: "smtp" };
  } catch (error) {
    return {
      sent: false,
      error: error && error.message ? error.message : "Failed to send email",
    };
  }
}

async function sendEarlyAccessEmail(entry) {
  // Prefer Resend (API key only) over Gmail/SMTP App Password.
  const resend = await sendViaResend(entry);
  if (!resend.skipped) return resend;

  const smtp = await sendViaSmtp(entry);
  if (!smtp.skipped) return smtp;

  return {
    sent: false,
    error:
      "Email is not configured. Recommended: set RESEND_API_KEY + EARLY_ACCESS_TO. Optional: GMAIL_USER + GMAIL_APP_PASSWORD (App Password only, not your normal Gmail password).",
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function persistSubmission(entry) {
  const store = readStore();
  store.submissions.push(entry);
  writeStore(store);
  return entry;
}

/**
 * Hard-delete one waitlist submission by id (admin dismiss / not interested).
 * @returns {{ ok: true, removed: object, total: number } | { ok: false, notFound?: boolean, error?: string }}
 */
function deleteEarlyAccessSubmission(id) {
  const targetId = String(id || "").trim();
  if (!targetId) {
    return { ok: false, error: "Missing id" };
  }
  const store = readStore();
  const idx = store.submissions.findIndex((s) => s.id === targetId);
  if (idx < 0) {
    return { ok: false, notFound: true };
  }
  const [removed] = store.submissions.splice(idx, 1);
  writeStore(store);
  return { ok: true, removed, total: store.submissions.length };
}

/**
 * Admin listing — newest first. Omits raw IP/userAgent from the default payload
 * shape used by the dashboard (still present on disk for ops).
 */
function listEarlyAccessSubmissions({ limit = 200 } = {}) {
  const store = readStore();
  const cap = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const items = [...store.submissions]
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
    .slice(0, cap)
    .map((s) => ({
      id: s.id,
      name: s.name,
      email: s.email,
      organization: s.organization || "",
      reason: s.reason,
      createdAt: s.createdAt,
      emailed: Boolean(s.emailed),
      emailError: s.emailError || null,
    }));
  return {
    submissions: items,
    total: store.submissions.length,
    mail: mailProviderStatus(),
  };
}

/**
 * @returns {Promise<{ ok: true, emailed: boolean, id: string, warning?: string } | { ok: false, status: number, error: string }>}
 */
async function handleEarlyAccess(req, body) {
  const ip = clientIp(req);
  if (!rateLimitOk(ip)) {
    return {
      ok: false,
      status: 429,
      error: "Too many requests. Please try again in a few minutes.",
    };
  }

  // Honeypot — bots fill hidden fields; humans leave blank.
  const honeypot = normalizeText(body?.website || body?.company || body?.hp, 200);
  if (honeypot) {
    return { ok: true, emailed: false, id: "ignored", honeypot: true };
  }

  const name = normalizeText(body?.name, MAX_NAME);
  const email = normalizeText(body?.email, MAX_EMAIL).toLowerCase();
  const organization = normalizeText(
    body?.organization || body?.network || body?.agency || body?.team,
    MAX_ORG
  );
  const reason = normalizeText(body?.reason || body?.why, MAX_REASON);

  if (!name) {
    return { ok: false, status: 400, error: "Name is required." };
  }
  if (name.length < 2) {
    return { ok: false, status: 400, error: "Please enter your name." };
  }
  if (!email) {
    return { ok: false, status: 400, error: "Email is required." };
  }
  if (!isValidEmail(email)) {
    return { ok: false, status: 400, error: "Please enter a valid email address." };
  }
  if (!organization) {
    return {
      ok: false,
      status: 400,
      error: "Network / Agency / Team is required.",
    };
  }
  if (organization.length < MIN_ORG) {
    return {
      ok: false,
      status: 400,
      error: "Please enter a valid Network / Agency / Team name.",
    };
  }
  if (!reason) {
    return {
      ok: false,
      status: 400,
      error: "Please tell us why you want access.",
    };
  }
  if (reason.length < MIN_REASON) {
    return {
      ok: false,
      status: 400,
      error: `Please tell us briefly why you want access (at least ${MIN_REASON} characters).`,
    };
  }

  const entry = {
    id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex"),
    name,
    email,
    organization,
    reason,
    createdAt: new Date().toISOString(),
    ip,
    userAgent: String(req.headers["user-agent"] || "").slice(0, 300),
    emailed: false,
    emailError: null,
  };

  try {
    persistSubmission(entry);
  } catch {
    return {
      ok: false,
      status: 500,
      error: "Could not save your request. Please try again.",
    };
  }

  const mail = await sendEarlyAccessEmail(entry);
  entry.emailed = Boolean(mail.sent);
  entry.emailError = mail.sent ? null : mail.error || "Email failed";

  // Update persisted record with email outcome (best-effort).
  try {
    const store = readStore();
    const idx = store.submissions.findIndex((s) => s.id === entry.id);
    if (idx >= 0) {
      store.submissions[idx] = {
        ...store.submissions[idx],
        emailed: entry.emailed,
        emailError: entry.emailError,
      };
      writeStore(store);
    }
  } catch {
    // backup already has the submission without email flags
  }

  // Always success once saved — email is optional.
  if (!mail.sent) {
    return {
      ok: true,
      emailed: false,
      id: entry.id,
      warning:
        "Request saved. We’ll review it from the admin list even if email delivery is offline.",
    };
  }

  return { ok: true, emailed: true, id: entry.id };
}

module.exports = {
  handleEarlyAccess,
  listEarlyAccessSubmissions,
  deleteEarlyAccessSubmission,
  STORE_PATH,
  DEFAULT_TO,
  MIN_ORG,
  MAX_ORG,
  MIN_REASON,
  MAX_REASON,
  resolveSmtpConfig,
  resolveResendConfig,
  mailProviderStatus,
  // Back-compat alias used by older callers/tests
  resolveMailConfig: resolveSmtpConfig,
};
