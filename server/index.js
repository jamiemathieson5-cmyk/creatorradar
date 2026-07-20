require("./loadEnv");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const store = require("./store");
const {
  runRefresh,
  startScheduler,
  isRefreshRunning,
  getRefreshProgress,
} = require("./scheduler");
const { DEMO_SEED_LEADS, importFeedPayload } = require("./fetcher");
const {
  PORT,
  STATUSES,
  STATUS_LABELS,
  DAILY_NEW_CAP,
  resolveTikleapLookupWorkers,
  resolveScrapeMode,
  isTikleapEnabled,
} = require("./constants");
const { startUserIdBackfill, backfillMissingUserIds } = require("./backfillUserIds");
const {
  createSession,
  destroySession,
  destroySessionsForUser,
  sessionCookieHeader,
  signSessionId,
  resolveAuth,
  requireUser,
  requireAdmin,
} = require("./auth");
const {
  createUser,
  deleteUser,
  authenticateUser,
  authenticateAdmin,
  listUsers,
  findUserById,
  publicUser,
  getEnvAdminCredentials,
} = require("./users");

const publicDir = path.join(__dirname, "..", "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(payload);
}

function sendFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const noCache = ext === ".html" || ext === ".css" || ext === ".js";
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": noCache ? "no-cache, must-revalidate" : "public, max-age=3600",
    });
    res.end(data);
  });
}

function redirect(res, location, status = 302) {
  res.writeHead(status, { Location: location, "Cache-Control": "no-store" });
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function safePublicPath(urlPath) {
  const cleaned = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, "");
  const resolved = path.join(publicDir, cleaned);
  if (!resolved.startsWith(publicDir)) return null;
  return resolved;
}

function setSessionCookie(resHeaders, user) {
  const sessionId = createSession(user);
  resHeaders["Set-Cookie"] = sessionCookieHeader(signSessionId(sessionId));
  return sessionId;
}

function clearSessionCookie(resHeaders, sessionId) {
  if (sessionId) destroySession(sessionId);
  resHeaders["Set-Cookie"] = sessionCookieHeader("", { clear: true });
}

function metaPayload() {
  const progress = getRefreshProgress();
  return {
    ...store.getMeta(),
    statusLabels: STATUS_LABELS,
    refreshInProgress: isRefreshRunning() || Boolean(progress.running),
    refreshProgress: progress,
    scrapeMode: resolveScrapeMode(),
    tikleapEnabled: isTikleapEnabled(),
  };
}

async function handleApi(req, res, url) {
  const { pathname } = url;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Credentials": "true",
    });
    res.end();
    return;
  }

  if (pathname === "/api/health" && req.method === "GET") {
    return sendJson(res, 200, {
      ok: true,
      scrapeMode: resolveScrapeMode(),
    });
  }

  // —— Auth ——
  if (pathname === "/api/auth/me" && req.method === "GET") {
    const auth = resolveAuth(req);
    if (!auth) return sendJson(res, 200, { user: null });
    return sendJson(res, 200, { user: auth.user });
  }

  if (pathname === "/api/auth/register" && req.method === "POST") {
    return sendJson(res, 403, {
      error: "Public registration is disabled. Ask an admin for an invite.",
    });
  }

  if (pathname === "/api/auth/login" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const login = body?.login || body?.username || body?.email;
      const password = body?.password;
      // Unified login: env/store admin credentials or regular users.
      const admin = await authenticateAdmin(login, password);
      const user = admin || (await authenticateUser(login, password));
      if (!user) {
        return sendJson(res, 401, { error: "Invalid username or password." });
      }
      const safeUser = publicUser(user) || {
        id: user.id,
        username: user.username,
        email: user.email || "",
        role: user.role || "user",
        createdAt: user.createdAt || null,
      };
      const headers = {};
      setSessionCookie(headers, safeUser);
      return sendJson(res, 200, { user: safeUser }, headers);
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (pathname === "/api/auth/admin-login" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const login = body?.login || body?.username || body?.email;
      const password = body?.password;
      const user = await authenticateAdmin(login, password);
      if (!user) {
        return sendJson(res, 401, { error: "Invalid admin credentials." });
      }
      const headers = {};
      setSessionCookie(headers, publicUser(user) || user);
      return sendJson(
        res,
        200,
        { user: publicUser(user) || { ...user, passwordHash: undefined } },
        headers
      );
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (pathname === "/api/auth/logout" && req.method === "POST") {
    const auth = resolveAuth(req);
    const headers = {};
    clearSessionCookie(headers, auth?.sessionId);
    return sendJson(res, 200, { ok: true }, headers);
  }

  // —— Meta (auth required; admin sees full, users see scoped totals) ——
  if (pathname === "/api/meta" && req.method === "GET") {
    const auth = requireUser(req, res, sendJson);
    if (!auth) return;
    const meta = metaPayload();
    if (auth.user.role !== "admin") {
      const mine = store.listLeads("all", { assignedToUserId: auth.user.id });
      meta.totalLeads = mine.length;
      meta.assignedOnly = true;
    }
    return sendJson(res, 200, { ...meta, user: auth.user });
  }

  if (pathname === "/api/meta/refresh-error" && req.method === "DELETE") {
    const auth = requireAdmin(req, res, sendJson);
    if (!auth) return;
    store.clearRefreshError();
    return sendJson(res, 200, { ok: true, meta: metaPayload() });
  }

  // —— Leads ——
  if (pathname === "/api/leads" && req.method === "GET") {
    const auth = requireUser(req, res, sendJson);
    if (!auth) return;
    const status = url.searchParams.get("status") || "all";
    if (store.leadsMissingUserId().length) {
      backfillMissingUserIds({ limit: 40 }).catch(() => {});
    }
    const scope =
      auth.user.role === "admin"
        ? {}
        : { assignedToUserId: auth.user.id };
    const leads = store.listLeads(status, scope);
    return sendJson(res, 200, {
      leads,
      count: leads.length,
      status,
      role: auth.user.role,
    });
  }

  if (pathname === "/api/leads" && req.method === "DELETE") {
    const auth = requireAdmin(req, res, sendJson);
    if (!auth) return;
    const result = store.clearLeads();
    return sendJson(res, 200, {
      ok: true,
      cleared: result.cleared,
      remaining: result.remaining,
      meta: metaPayload(),
    });
  }

  if (pathname.startsWith("/api/leads/") && req.method === "PATCH") {
    const auth = requireUser(req, res, sendJson);
    if (!auth) return;
    const id = pathname.slice("/api/leads/".length);
    try {
      const body = await readBody(req);
      const status = body?.status;
      if (!status || !STATUSES.includes(status)) {
        return sendJson(res, 400, { error: "Invalid status", allowed: STATUSES });
      }
      const opts =
        auth.user.role === "admin"
          ? {}
          : { assignedToUserId: auth.user.id };
      const lead = store.updateLeadStatus(id, status, opts);
      return sendJson(res, 200, { lead });
    } catch (error) {
      if (error.code === "NOT_FOUND") {
        return sendJson(res, 404, { error: "Lead not found" });
      }
      if (error.code === "FORBIDDEN") {
        return sendJson(res, 403, { error: error.message });
      }
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (pathname === "/api/refresh" && req.method === "POST") {
    const auth = requireAdmin(req, res, sendJson);
    if (!auth) return;
    try {
      const body = await readBody(req);
      const force = body?.force !== false;
      const result = await runRefresh({ force });
      return sendJson(res, 200, result);
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (pathname === "/api/import" && req.method === "POST") {
    const auth = requireAdmin(req, res, sendJson);
    if (!auth) return;
    try {
      const body = await readBody(req);
      const payload = body?.payload ?? body;
      if (!payload || typeof payload !== "object") {
        return sendJson(res, 400, {
          error: "Send a webcast/feed JSON payload in { payload: ... }.",
        });
      }

      const quota = store.remainingQuota();
      if (quota <= 0) {
        return sendJson(res, 200, {
          ok: true,
          skipped: true,
          reason: "Daily quota already filled for this 24h cycle.",
          meta: metaPayload(),
        });
      }

      const imported = importFeedPayload(payload, {
        limit: Math.min(DAILY_NEW_CAP, quota),
      });
      const addedResult = store.addLeads(imported.leads);
      return sendJson(res, 200, {
        ok: true,
        skipped: false,
        added: addedResult.added.length,
        seen: imported.rawSeen,
        source: imported.source,
        meta: metaPayload(),
      });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  // —— Admin: users + distribution ——
  if (pathname === "/api/admin/users" && req.method === "GET") {
    const auth = requireAdmin(req, res, sendJson);
    if (!auth) return;
    const users = listUsers().filter((u) => u.role !== "admin");
    const overview = store.assignmentOverview(listUsers());
    return sendJson(res, 200, {
      users,
      overview,
      envAdminConfigured: Boolean(getEnvAdminCredentials()),
    });
  }

  if (pathname === "/api/admin/users" && req.method === "POST") {
    const auth = requireAdmin(req, res, sendJson);
    if (!auth) return;
    try {
      const body = await readBody(req);
      const result = await createUser({
        username: body?.username,
        email: body?.email,
        password: body?.password,
      });
      return sendJson(res, 201, {
        user: result.user,
        temporaryPassword: result.temporaryPassword,
        overview: store.assignmentOverview(listUsers()),
      });
    } catch (error) {
      const status =
        error.code === "USERNAME_TAKEN" || error.code === "EMAIL_TAKEN"
          ? 409
          : 400;
      return sendJson(res, status, { error: error.message });
    }
  }

  // DELETE /api/admin/users/:userId — permanent close; leads return to pool
  const adminUserMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (adminUserMatch && req.method === "DELETE") {
    const auth = requireAdmin(req, res, sendJson);
    if (!auth) return;
    const userId = decodeURIComponent(adminUserMatch[1]);
    try {
      const existing = findUserById(userId);
      if (!existing) {
        return sendJson(res, 404, { error: "User not found." });
      }
      if (existing.role === "admin") {
        return sendJson(res, 403, { error: "Cannot delete an admin account." });
      }
      const { unassigned } = store.unassignLeadsForUser(userId);
      const sessionsRemoved = destroySessionsForUser(userId);
      const user = deleteUser(userId);
      return sendJson(res, 200, {
        ok: true,
        user,
        leadsReturnedToPool: unassigned,
        sessionsInvalidated: sessionsRemoved,
        overview: store.assignmentOverview(listUsers()),
      });
    } catch (error) {
      const status =
        error.code === "NOT_FOUND"
          ? 404
          : error.code === "FORBIDDEN"
            ? 403
            : 400;
      return sendJson(res, status, { error: error.message });
    }
  }

  if (pathname === "/api/admin/overview" && req.method === "GET") {
    const auth = requireAdmin(req, res, sendJson);
    if (!auth) return;
    return sendJson(res, 200, {
      overview: store.assignmentOverview(listUsers()),
      meta: metaPayload(),
    });
  }

  if (pathname === "/api/admin/distribute" && req.method === "POST") {
    const auth = requireAdmin(req, res, sendJson);
    if (!auth) return;
    try {
      const body = await readBody(req);
      const userId = body?.userId;
      const count = body?.count;
      if (!userId) {
        return sendJson(res, 400, { error: "userId is required" });
      }
      const result = store.distributeLeads(userId, count, {
        status: body?.status || "new",
      });
      return sendJson(res, 200, {
        ok: true,
        ...result,
        overview: store.assignmentOverview(listUsers()),
      });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  return sendJson(res, 404, { error: "API route not found" });
}

function servePage(res, name) {
  sendFile(res, path.join(publicDir, name));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const { pathname } = url;

    if (pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    // Soft page routes
    if (pathname === "/" || pathname === "/index.html") {
      servePage(res, "landing.html");
      return;
    }

    if (pathname === "/app" || pathname === "/app.html") {
      const auth = resolveAuth(req);
      if (!auth) {
        redirect(res, "/?login=1");
        return;
      }
      if (auth.user.role === "admin") {
        redirect(res, "/admin");
        return;
      }
      servePage(res, "app.html");
      return;
    }

    if (pathname === "/admin" || pathname === "/admin.html") {
      const auth = resolveAuth(req);
      if (!auth || auth.user.role !== "admin") {
        redirect(res, "/?login=1");
        return;
      }
      servePage(res, "admin.html");
      return;
    }

    let filePath = safePublicPath(pathname);
    if (!filePath) {
      sendJson(res, 400, { error: "Invalid path" });
      return;
    }

    fs.stat(filePath, (err, stats) => {
      if (!err && stats.isFile()) {
        sendFile(res, filePath);
        return;
      }
      // Unknown HTML routes → landing
      servePage(res, "landing.html");
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error" });
  }
});

if (process.env.LEAD_FINDER_SEED === "1") {
  store.seedIfEmpty(DEMO_SEED_LEADS);
}

function isNonFatalRuntimeError(error) {
  const msg = String(error && error.message ? error.message : error || "");
  const code = error && error.code ? String(error.code) : "";
  if (
    code === "CHROME_TRANSFORM_ABORT" ||
    code === "CHROME_LAUNCH_FAILED" ||
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "ENOTFOUND" ||
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "ABORT_ERR"
  ) {
    return true;
  }
  if (/chrome|puppeteer|devtools|fetch failed|network|ECONN|ETIMEDOUT|socket hang up/i.test(msg)) {
    return true;
  }
  return false;
}

function isFatalProcessError(error) {
  const code = error && error.code ? String(error.code) : "";
  return code === "ERR_OUT_OF_MEMORY" || /out of memory/i.test(String(error && error.message));
}

server.on("error", (error) => {
  if (error && error.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} is already in use — CreatorRadar is probably already running.\n` +
        `Open http://localhost:${PORT}\n` +
        `Or stop the other process first: kill $(lsof -tiTCP:${PORT} -sTCP:LISTEN)`
    );
    process.exit(1);
  }
  console.error(error);
  process.exit(1);
});

process.on("uncaughtException", (error) => {
  console.error("[uncaughtException]", error);
  if (isFatalProcessError(error)) {
    process.exit(1);
  }
  if (isNonFatalRuntimeError(error)) {
    console.error("[uncaughtException] non-fatal — keeping HTTP server up");
    return;
  }
  console.error("[uncaughtException] continuing (watchdog will restart if process dies)");
});

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
  if (isFatalProcessError(reason)) {
    process.exit(1);
  }
  if (isNonFatalRuntimeError(reason)) {
    console.error("[unhandledRejection] non-fatal — keeping HTTP server up");
  }
});

server.listen(PORT, () => {
  const scrapeMode = resolveScrapeMode();
  console.log(`CreatorRadar running at http://localhost:${PORT}`);
  console.log(`[scrape] mode=${scrapeMode}` + (isTikleapEnabled() ? " (TikLeap enabled)" : " (feed-only)"));
  if (isTikleapEnabled()) {
    const lookupWorkers = resolveTikleapLookupWorkers();
    console.log(
      `[tikleap] lookup workers ready: ${lookupWorkers}` +
        ` (+1 list tab → ${lookupWorkers + 1} Chrome tabs;` +
        ` override LEAD_FINDER_TIKLEAP_WORKERS)`
    );
  }
  if (!getEnvAdminCredentials()) {
    console.warn(
      "[auth] ADMIN_USER / ADMIN_PASSWORD not set — configure before production admin login"
    );
  }
  if (!process.env.SESSION_SECRET) {
    console.warn(
      "[auth] SESSION_SECRET not set — using insecure dev default; set before production"
    );
  }
  const falseInactive = store.unlearnFalseInactiveFromTikleapCache();
  if (falseInactive.removed) {
    console.log(
      `[denylist] cleared ${falseInactive.removed} false inactive_lost` +
        ` (masked/unknown L30; learned total now ${falseInactive.total})`
    );
  }
  const inactive = store.backfillInactiveFromDiamonds();
  if (inactive.updated || inactive.already) {
    console.log(
      `[inactive] L30 < ${inactive.threshold}: marked ${inactive.updated}` +
        (inactive.already ? ` (already ${inactive.already})` : "") +
        ` (unknown skipped ${inactive.skippedUnknown}, total ${inactive.total})`
    );
  }
  const denylist = store.backfillDenylist();
  if (denylist.updated || denylist.removed) {
    console.log(
      `[denylist] backfill: updated ${denylist.updated}, removed ${denylist.removed}, skipped ${denylist.skipped} (total ${denylist.total})`
    );
  }
  const regions = store.backfillRegions();
  if (regions.updated) {
    console.log(
      `[region] backfill: updated ${regions.updated}` +
        (regions.promoted ? ` (promoted ${regions.promoted} → new)` : "") +
        ` (skipped ${regions.skipped}, ok ${regions.alreadyOk}, total ${regions.total})`
    );
  }
  const learned = store.backfillLearnedFromLeads(store.listLeads("all"));
  if (learned.added) {
    console.log(
      `[denylist] learned from existing leads: +${learned.added} (total ${learned.total})`
    );
  }
  const scraped = store.seedScrapedUidsFromLeads(store.listLeads("all"));
  console.log(
    `[scraped-uids] registry: ${scraped.total} uid(s)` +
      (scraped.added ? ` (+${scraped.added} seeded from leads)` : "") +
      ` → ${store.scrapedUidsPath()}`
  );
  startScheduler();
  startUserIdBackfill();
});
