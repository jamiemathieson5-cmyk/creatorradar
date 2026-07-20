/**
 * Lightweight .env loader (no dotenv dependency).
 * Loads first existing of: process CWD `.env`, then `data/.env.runtime`.
 * Does not override variables already set in the environment.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CANDIDATES = [
  path.join(ROOT, ".env"),
  path.join(ROOT, "data", ".env.runtime"),
];

function parseLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const exportPrefix = trimmed.startsWith("export ")
    ? trimmed.slice(7).trim()
    : trimmed;
  const eq = exportPrefix.indexOf("=");
  if (eq <= 0) return null;
  const key = exportPrefix.slice(0, eq).trim();
  let value = exportPrefix.slice(eq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;
  return { key, value };
}

function loadEnvFiles() {
  for (const filePath of CANDIDATES) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const text = fs.readFileSync(filePath, "utf8");
      for (const line of text.split(/\r?\n/)) {
        const parsed = parseLine(line);
        if (!parsed) continue;
        if (process.env[parsed.key] === undefined) {
          process.env[parsed.key] = parsed.value;
        }
      }
    } catch {
      // ignore unreadable env files
    }
  }
}

loadEnvFiles();

module.exports = { loadEnvFiles };
