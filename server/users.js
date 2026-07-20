const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { promisify } = require("util");

const scryptAsync = promisify(crypto.scrypt);

const DATA_DIR = path.join(__dirname, "..", "data");
const USERS_PATH = path.join(DATA_DIR, "users.json");
const AVATARS_DIR = path.join(DATA_DIR, "avatars");

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LEN = 64;
/** Safety net after client-side compression (client targets ~1.8MB). */
const MAX_AVATAR_BYTES = Math.floor(2.5 * 1024 * 1024);
const AVATAR_MIME_TO_EXT = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
const AVATAR_EXT_TO_MIME = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function ensureAvatarsDir() {
  ensureDataDir();
  if (!fs.existsSync(AVATARS_DIR)) {
    fs.mkdirSync(AVATARS_DIR, { recursive: true });
  }
}

function readUsers() {
  try {
    if (!fs.existsSync(USERS_PATH)) return { users: [] };
    const data = JSON.parse(fs.readFileSync(USERS_PATH, "utf8"));
    return { users: Array.isArray(data.users) ? data.users : [] };
  } catch {
    return { users: [] };
  }
}

function writeUsers(data) {
  ensureDataDir();
  const tmp = `${USERS_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, USERS_PATH);
}

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 40);
}

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .slice(0, 120);
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scryptAsync(String(password), salt, KEY_LEN, SCRYPT_PARAMS);
  return `scrypt$${salt.toString("base64")}$${Buffer.from(derived).toString("base64")}`;
}

async function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  try {
    const salt = Buffer.from(parts[1], "base64");
    const expected = Buffer.from(parts[2], "base64");
    const derived = await scryptAsync(String(password), salt, expected.length, SCRYPT_PARAMS);
    return crypto.timingSafeEqual(expected, Buffer.from(derived));
  } catch {
    return false;
  }
}

function avatarUrlFor(user) {
  if (!user?.id || !user.avatarExt) return "";
  const v = user.avatarUpdatedAt
    ? `?v=${encodeURIComponent(String(user.avatarUpdatedAt))}`
    : "";
  return `/api/account/avatar/${encodeURIComponent(user.id)}${v}`;
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    email: user.email || "",
    role: user.role || "user",
    displayName: user.displayName || "",
    avatarUrl: avatarUrlFor(user),
    createdAt: user.createdAt,
  };
}

function normalizeDisplayName(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

function listUsers() {
  return readUsers().users.map(publicUser);
}

function findUserById(id) {
  return readUsers().users.find((u) => u.id === id) || null;
}

function findUserByLogin(login) {
  const key = String(login || "")
    .trim()
    .toLowerCase();
  if (!key) return null;
  // Username-only login. Legacy email match kept so old accounts still work.
  return (
    readUsers().users.find(
      (u) => u.username === key || (u.email && u.email === key)
    ) || null
  );
}

function generateTemporaryPassword(length = 14) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

/**
 * Create a standard user account (admin issuance). Public self-signup is disabled.
 * Username + password only; email is optional/legacy and omitted by default.
 * Password is required (min 8 characters).
 */
async function createUser({ username, email, password } = {}) {
  const uname = normalizeUsername(username);
  const mail = normalizeEmail(email);
  const pass = String(password || "").trim();

  if (uname.length < 3) {
    const err = new Error("Username must be at least 3 characters.");
    err.code = "INVALID_USERNAME";
    throw err;
  }
  if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
    const err = new Error("Email is invalid.");
    err.code = "INVALID_EMAIL";
    throw err;
  }
  if (!pass) {
    const err = new Error("Password is required.");
    err.code = "INVALID_PASSWORD";
    throw err;
  }
  if (pass.length < 8) {
    const err = new Error("Password must be at least 8 characters.");
    err.code = "INVALID_PASSWORD";
    throw err;
  }

  const data = readUsers();
  if (data.users.some((u) => u.username === uname)) {
    const err = new Error("Username is already taken.");
    err.code = "USERNAME_TAKEN";
    throw err;
  }
  if (mail && data.users.some((u) => u.email && u.email === mail)) {
    const err = new Error("Email is already registered.");
    err.code = "EMAIL_TAKEN";
    throw err;
  }

  const user = {
    id: crypto.randomUUID(),
    username: uname,
    email: mail || "",
    passwordHash: await hashPassword(pass),
    role: "user",
    displayName: "",
    avatarExt: "",
    avatarUpdatedAt: null,
    createdAt: new Date().toISOString(),
  };
  data.users.push(user);
  writeUsers(data);
  return {
    user: publicUser(user),
  };
}

/** @deprecated Public registration disabled — use createUser from admin only. */
async function registerUser(input) {
  const result = await createUser(input);
  return result.user;
}

async function authenticateUser(login, password) {
  const user = findUserByLogin(login);
  if (!user) return null;
  const ok = await verifyPassword(password, user.passwordHash);
  return ok ? user : null;
}

/**
 * Permanently remove a user from users.json.
 * Does not delete leads — callers should unassign them first.
 */
function deleteUser(userId) {
  const id = String(userId || "").trim();
  if (!id) {
    const err = new Error("userId is required.");
    err.code = "INVALID_USER";
    throw err;
  }
  if (id === "env-admin") {
    const err = new Error("Cannot delete the environment admin account.");
    err.code = "FORBIDDEN";
    throw err;
  }

  const data = readUsers();
  const index = data.users.findIndex((u) => u.id === id);
  if (index === -1) {
    const err = new Error("User not found.");
    err.code = "NOT_FOUND";
    throw err;
  }
  const target = data.users[index];
  if (target.role === "admin") {
    const err = new Error("Cannot delete an admin account.");
    err.code = "FORBIDDEN";
    throw err;
  }

  data.users.splice(index, 1);
  writeUsers(data);
  return publicUser(target);
}

/**
 * Env-configured admin (v1). Optional: promote/create matching store user.
 */
function getEnvAdminCredentials() {
  const username = String(process.env.ADMIN_USER || "").trim();
  const password = String(process.env.ADMIN_PASSWORD || "");
  if (!username || !password) return null;
  return { username, password };
}

async function authenticateAdmin(login, password) {
  const envAdmin = getEnvAdminCredentials();
  const loginKey = String(login || "")
    .trim()
    .toLowerCase();

  if (
    envAdmin &&
    loginKey === envAdmin.username.toLowerCase() &&
    password === envAdmin.password
  ) {
    // Prefer a stored admin user if one exists with that username.
    const stored = findUserByLogin(envAdmin.username);
    if (stored && stored.role === "admin") return stored;
    return {
      id: "env-admin",
      username: envAdmin.username,
      email: "",
      role: "admin",
      displayName: "",
      avatarExt: "",
      avatarUpdatedAt: null,
      createdAt: null,
      envAdmin: true,
    };
  }

  const user = await authenticateUser(login, password);
  if (user && user.role === "admin") return user;
  return null;
}

/**
 * Resolve a durable users.json row for the current session user.
 * Env-admin (id "env-admin") is promoted into a real admin row on first account save
 * so displayName / password / avatar persist without redeploying ADMIN_PASSWORD.
 */
async function ensurePersistedUser(sessionUser, { bootstrapPassword } = {}) {
  if (!sessionUser?.id) {
    const err = new Error("Not authenticated.");
    err.code = "UNAUTHORIZED";
    throw err;
  }

  if (sessionUser.id !== "env-admin") {
    const existing = findUserById(sessionUser.id);
    if (!existing) {
      const err = new Error("User not found.");
      err.code = "NOT_FOUND";
      throw err;
    }
    return existing;
  }

  const envAdmin = getEnvAdminCredentials();
  const username = normalizeUsername(
    sessionUser.username || envAdmin?.username || ""
  );
  if (!username) {
    const err = new Error("Admin username is missing.");
    err.code = "INVALID_USERNAME";
    throw err;
  }

  const existing = findUserByLogin(username);
  if (existing) {
    if (existing.role !== "admin") {
      const data = readUsers();
      const idx = data.users.findIndex((u) => u.id === existing.id);
      if (idx !== -1) {
        data.users[idx] = { ...data.users[idx], role: "admin" };
        writeUsers(data);
        return data.users[idx];
      }
    }
    return existing;
  }

  const pass =
    String(bootstrapPassword || "").trim() ||
    (envAdmin ? String(envAdmin.password) : "");
  if (!pass || pass.length < 8) {
    const err = new Error(
      "Cannot create admin profile without a password. Change password once, or set ADMIN_PASSWORD."
    );
    err.code = "INVALID_PASSWORD";
    throw err;
  }

  const user = {
    id: crypto.randomUUID(),
    username,
    email: "",
    passwordHash: await hashPassword(pass),
    role: "admin",
    displayName: normalizeDisplayName(sessionUser.displayName),
    avatarExt: "",
    avatarUpdatedAt: null,
    createdAt: new Date().toISOString(),
  };
  const data = readUsers();
  data.users.push(user);
  writeUsers(data);
  return user;
}

async function verifyUserPassword(user, password) {
  const pass = String(password || "");
  if (!user) return false;

  if (user.id === "env-admin" || user.envAdmin) {
    const envAdmin = getEnvAdminCredentials();
    if (envAdmin && pass === envAdmin.password) return true;
  }

  const stored =
    (user.id && user.id !== "env-admin" && findUserById(user.id)) ||
    findUserByLogin(user.username);
  if (stored?.passwordHash) {
    return verifyPassword(pass, stored.passwordHash);
  }

  const envAdmin = getEnvAdminCredentials();
  if (
    envAdmin &&
    String(user.username || "").toLowerCase() === envAdmin.username.toLowerCase() &&
    pass === envAdmin.password
  ) {
    return true;
  }
  return false;
}

async function updateDisplayName(sessionUser, displayName) {
  const name = normalizeDisplayName(displayName);
  const persisted = await ensurePersistedUser(sessionUser);
  const data = readUsers();
  const idx = data.users.findIndex((u) => u.id === persisted.id);
  if (idx === -1) {
    const err = new Error("User not found.");
    err.code = "NOT_FOUND";
    throw err;
  }
  data.users[idx] = {
    ...data.users[idx],
    displayName: name,
  };
  writeUsers(data);
  return { user: publicUser(data.users[idx]), persisted: data.users[idx] };
}

async function changePassword(sessionUser, { currentPassword, newPassword }) {
  const current = String(currentPassword || "");
  const next = String(newPassword || "").trim();
  if (!current) {
    const err = new Error("Current password is required.");
    err.code = "INVALID_PASSWORD";
    throw err;
  }
  if (next.length < 8) {
    const err = new Error("New password must be at least 8 characters.");
    err.code = "INVALID_PASSWORD";
    throw err;
  }
  if (current === next) {
    const err = new Error("New password must be different from the current password.");
    err.code = "INVALID_PASSWORD";
    throw err;
  }

  const ok = await verifyUserPassword(sessionUser, current);
  if (!ok) {
    const err = new Error("Current password is incorrect.");
    err.code = "WRONG_PASSWORD";
    throw err;
  }

  const persisted = await ensurePersistedUser(sessionUser, {
    bootstrapPassword: current,
  });
  const data = readUsers();
  const idx = data.users.findIndex((u) => u.id === persisted.id);
  if (idx === -1) {
    const err = new Error("User not found.");
    err.code = "NOT_FOUND";
    throw err;
  }
  data.users[idx] = {
    ...data.users[idx],
    passwordHash: await hashPassword(next),
  };
  writeUsers(data);
  return { user: publicUser(data.users[idx]), persisted: data.users[idx] };
}

function detectAvatarMime(buffer, declaredMime) {
  const declared = String(declaredMime || "")
    .trim()
    .toLowerCase()
    .split(";")[0];
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  if (buffer.length >= 6) {
    const head = buffer.toString("ascii", 0, 6);
    if (head === "GIF87a" || head === "GIF89a") return "image/gif";
  }
  if (AVATAR_MIME_TO_EXT[declared]) return declared;
  return null;
}

function parseDataUrlImage(dataUrl) {
  const raw = String(dataUrl || "").trim();
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(raw);
  if (!match) {
    const err = new Error("Avatar must be a base64 data URL image.");
    err.code = "INVALID_AVATAR";
    throw err;
  }
  const mime = match[1].toLowerCase();
  let buffer;
  try {
    buffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  } catch {
    const err = new Error("Avatar image is not valid base64.");
    err.code = "INVALID_AVATAR";
    throw err;
  }
  if (!buffer.length) {
    const err = new Error("Avatar image is empty.");
    err.code = "INVALID_AVATAR";
    throw err;
  }
  if (buffer.length > MAX_AVATAR_BYTES) {
    const err = new Error("Avatar is too large after upload.");
    err.code = "AVATAR_TOO_LARGE";
    throw err;
  }
  const detected = detectAvatarMime(buffer, mime);
  if (!detected || !AVATAR_MIME_TO_EXT[detected]) {
    const err = new Error("Avatar must be JPEG, PNG, WebP, or GIF.");
    err.code = "INVALID_AVATAR";
    throw err;
  }
  return { buffer, mime: detected, ext: AVATAR_MIME_TO_EXT[detected] };
}

function avatarFilePath(userId, ext) {
  const safeId = String(userId || "").replace(/[^a-zA-Z0-9._-]/g, "");
  const safeExt = String(ext || "").replace(/[^a-z0-9]/g, "");
  if (!safeId || !safeExt) return null;
  return path.join(AVATARS_DIR, `${safeId}.${safeExt}`);
}

function removeAvatarFiles(userId, keepExt = null) {
  ensureAvatarsDir();
  const safeId = String(userId || "").replace(/[^a-zA-Z0-9._-]/g, "");
  if (!safeId) return;
  for (const ext of Object.keys(AVATAR_EXT_TO_MIME)) {
    if (keepExt && ext === keepExt) continue;
    const filePath = path.join(AVATARS_DIR, `${safeId}.${ext}`);
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      /* ignore */
    }
  }
}

async function saveAvatar(sessionUser, { dataUrl } = {}) {
  const parsed = parseDataUrlImage(dataUrl);
  const persisted = await ensurePersistedUser(sessionUser);
  ensureAvatarsDir();
  const filePath = avatarFilePath(persisted.id, parsed.ext);
  if (!filePath) {
    const err = new Error("Could not store avatar.");
    err.code = "INVALID_AVATAR";
    throw err;
  }
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, parsed.buffer);
  fs.renameSync(tmp, filePath);
  removeAvatarFiles(persisted.id, parsed.ext);

  const data = readUsers();
  const idx = data.users.findIndex((u) => u.id === persisted.id);
  if (idx === -1) {
    const err = new Error("User not found.");
    err.code = "NOT_FOUND";
    throw err;
  }
  data.users[idx] = {
    ...data.users[idx],
    avatarExt: parsed.ext,
    avatarUpdatedAt: new Date().toISOString(),
  };
  writeUsers(data);
  return { user: publicUser(data.users[idx]), persisted: data.users[idx] };
}

function resolveAvatarFile(userId) {
  const id = String(userId || "").trim();
  if (!id) return null;
  const user = findUserById(id);
  if (!user?.avatarExt) return null;
  const filePath = avatarFilePath(user.id, user.avatarExt);
  if (!filePath || !fs.existsSync(filePath)) return null;
  const ext = user.avatarExt === "jpg" ? "jpeg" : user.avatarExt;
  return {
    filePath,
    mime: AVATAR_EXT_TO_MIME[user.avatarExt] || `image/${ext}`,
    updatedAt: user.avatarUpdatedAt || null,
  };
}

module.exports = {
  listUsers,
  findUserById,
  findUserByLogin,
  createUser,
  deleteUser,
  registerUser,
  generateTemporaryPassword,
  authenticateUser,
  authenticateAdmin,
  getEnvAdminCredentials,
  publicUser,
  hashPassword,
  verifyPassword,
  ensurePersistedUser,
  updateDisplayName,
  changePassword,
  saveAvatar,
  resolveAvatarFile,
  MAX_AVATAR_BYTES,
  usersPath: () => USERS_PATH,
  avatarsDir: () => AVATARS_DIR,
};
