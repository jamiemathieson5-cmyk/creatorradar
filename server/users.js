const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { promisify } = require("util");

const scryptAsync = promisify(crypto.scrypt);

const DATA_DIR = path.join(__dirname, "..", "data");
const USERS_PATH = path.join(DATA_DIR, "users.json");

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LEN = 64;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
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

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    email: user.email || "",
    role: user.role || "user",
    createdAt: user.createdAt,
  };
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
 * Pass password, or omit/empty to generate a temporary password (returned once).
 */
async function createUser({ username, email, password } = {}) {
  const uname = normalizeUsername(username);
  const mail = normalizeEmail(email);
  let pass = String(password || "");
  let generatedPassword = null;

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
    generatedPassword = generateTemporaryPassword();
    pass = generatedPassword;
  } else if (pass.length < 8) {
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
    createdAt: new Date().toISOString(),
  };
  data.users.push(user);
  writeUsers(data);
  return {
    user: publicUser(user),
    temporaryPassword: generatedPassword,
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
      createdAt: null,
      envAdmin: true,
    };
  }

  const user = await authenticateUser(login, password);
  if (user && user.role === "admin") return user;
  return null;
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
  usersPath: () => USERS_PATH,
};
