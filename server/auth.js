const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { findUserById, findUserByLogin, publicUser } = require("./users");

const DATA_DIR = path.join(__dirname, "..", "data");
const SESSIONS_PATH = path.join(DATA_DIR, "sessions.json");
const COOKIE_NAME = "cr_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function sessionSecret() {
  const fromEnv = String(process.env.SESSION_SECRET || "").trim();
  if (fromEnv) return fromEnv;
  // Dev fallback — set SESSION_SECRET in production.
  return "creatorradar-dev-secret-change-me";
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readSessions() {
  try {
    if (!fs.existsSync(SESSIONS_PATH)) return { sessions: {} };
    const data = JSON.parse(fs.readFileSync(SESSIONS_PATH, "utf8"));
    return {
      sessions:
        data.sessions && typeof data.sessions === "object" ? data.sessions : {},
    };
  } catch {
    return { sessions: {} };
  }
}

function writeSessions(data) {
  ensureDataDir();
  const tmp = `${SESSIONS_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, SESSIONS_PATH);
}

function parseCookies(header) {
  const out = {};
  const raw = String(header || "");
  if (!raw) return out;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

function signSessionId(id) {
  const mac = crypto
    .createHmac("sha256", sessionSecret())
    .update(id)
    .digest("base64url");
  return `${id}.${mac}`;
}

function verifySignedSession(token) {
  const raw = String(token || "");
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const id = raw.slice(0, dot);
  const mac = raw.slice(dot + 1);
  const expected = crypto
    .createHmac("sha256", sessionSecret())
    .update(id)
    .digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return id;
}

function pruneExpired(sessions) {
  const now = Date.now();
  let changed = false;
  for (const [id, sess] of Object.entries(sessions)) {
    if (!sess?.expiresAt || Date.parse(sess.expiresAt) <= now) {
      delete sessions[id];
      changed = true;
    }
  }
  return changed;
}

function createSession(user) {
  const data = readSessions();
  pruneExpired(data.sessions);
  const id = crypto.randomBytes(24).toString("base64url");
  const now = Date.now();
  data.sessions[id] = {
    userId: user.id,
    role: user.role || "user",
    username: user.username || "",
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
  };
  writeSessions(data);
  return id;
}

function destroySession(sessionId) {
  if (!sessionId) return;
  const data = readSessions();
  if (data.sessions[sessionId]) {
    delete data.sessions[sessionId];
    writeSessions(data);
  }
}

/** Invalidate every session for a user (account close / password reset). */
function destroySessionsForUser(userId) {
  const id = String(userId || "").trim();
  if (!id) return 0;
  const data = readSessions();
  let removed = 0;
  for (const [sessionId, sess] of Object.entries(data.sessions)) {
    if (sess?.userId === id) {
      delete data.sessions[sessionId];
      removed += 1;
    }
  }
  if (removed) writeSessions(data);
  return removed;
}

/** Remap an active session onto a persisted user id (env-admin → users.json). */
function rebindSessionUser(sessionId, user) {
  if (!sessionId || !user?.id) return false;
  const data = readSessions();
  const sess = data.sessions[sessionId];
  if (!sess) return false;
  data.sessions[sessionId] = {
    ...sess,
    userId: user.id,
    role: user.role || sess.role || "user",
    username: user.username || sess.username || "",
  };
  writeSessions(data);
  return true;
}

function getSession(sessionId) {
  if (!sessionId) return null;
  const data = readSessions();
  const sess = data.sessions[sessionId];
  if (!sess) return null;
  if (!sess.expiresAt || Date.parse(sess.expiresAt) <= Date.now()) {
    delete data.sessions[sessionId];
    writeSessions(data);
    return null;
  }
  return sess;
}

function sessionCookieHeader(signedToken, { clear = false } = {}) {
  const secure =
    process.env.COOKIE_SECURE === "1" ||
    process.env.COOKIE_SECURE === "true" ||
    process.env.NODE_ENV === "production";
  if (clear) {
    return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${
      secure ? "; Secure" : ""
    }`;
  }
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${COOKIE_NAME}=${encodeURIComponent(
    signedToken
  )}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${
    secure ? "; Secure" : ""
  }`;
}

function readSessionFromRequest(req) {
  const cookies = parseCookies(req.headers?.cookie);
  const token = cookies[COOKIE_NAME];
  const sessionId = verifySignedSession(token);
  if (!sessionId) return null;
  const sess = getSession(sessionId);
  if (!sess) return null;
  return { sessionId, ...sess };
}

function resolveAuth(req) {
  const sess = readSessionFromRequest(req);
  if (!sess) return null;

  if (sess.userId === "env-admin" && sess.role === "admin") {
    const username = sess.username || process.env.ADMIN_USER || "admin";
    const stored = findUserByLogin(username);
    if (stored && stored.role === "admin") {
      // Prefer the persisted admin row (displayName / avatar / password hash).
      rebindSessionUser(sess.sessionId, stored);
      return {
        sessionId: sess.sessionId,
        user: publicUser(stored),
      };
    }
    return {
      sessionId: sess.sessionId,
      user: {
        id: "env-admin",
        username,
        email: "",
        role: "admin",
        displayName: "",
        avatarUrl: "",
        createdAt: sess.createdAt,
      },
    };
  }

  const user = findUserById(sess.userId);
  if (!user) {
    destroySession(sess.sessionId);
    return null;
  }
  return {
    sessionId: sess.sessionId,
    user: publicUser(user),
  };
}

function requireUser(req, res, sendJson) {
  const auth = resolveAuth(req);
  if (!auth) {
    sendJson(res, 401, { error: "Authentication required." });
    return null;
  }
  return auth;
}

function requireAdmin(req, res, sendJson) {
  const auth = resolveAuth(req);
  if (!auth) {
    sendJson(res, 401, { error: "Authentication required." });
    return null;
  }
  if (auth.user.role !== "admin") {
    sendJson(res, 403, { error: "Admin access required." });
    return null;
  }
  return auth;
}

module.exports = {
  COOKIE_NAME,
  createSession,
  destroySession,
  destroySessionsForUser,
  rebindSessionUser,
  getSession,
  sessionCookieHeader,
  signSessionId,
  resolveAuth,
  requireUser,
  requireAdmin,
  parseCookies,
};
