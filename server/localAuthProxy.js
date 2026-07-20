/**
 * Local unauthenticated HTTP proxy that forwards to an authenticated upstream.
 *
 * Chromium's --proxy-server ignores user:pass, and CDP Fetch.authRequired cannot
 * inject credentials into the HTTPS CONNECT handshake (auth happens below Fetch).
 * Result without this: chrome-error ERR_TUNNEL_CONNECTION_FAILED.
 *
 * Chrome → http://127.0.0.1:LOCAL (no auth)
 *       → CONNECT target:443 + Proxy-Authorization → upstream HTTP proxy
 */

const http = require("http");
const net = require("net");
const tls = require("tls");
const { URL } = require("url");

function basicAuthHeader(username, password) {
  const token = Buffer.from(
    `${username || ""}:${password || ""}`,
    "utf8"
  ).toString("base64");
  return `Basic ${token}`;
}

function readHttpHead(socket, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("upstream proxy CONNECT timed out"));
    }, timeoutMs);

    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const idx = buf.indexOf("\r\n\r\n");
      if (idx === -1) {
        if (buf.length > 16_384) {
          cleanup();
          reject(new Error("upstream proxy CONNECT response too large"));
        }
        return;
      }
      cleanup();
      const head = buf.slice(0, idx).toString("utf8");
      const rest = buf.slice(idx + 4);
      resolve({ head, rest });
    };

    const onError = (err) => {
      cleanup();
      reject(err);
    };

    const cleanup = () => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onError);
    };

    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("close", () =>
      onError(new Error("upstream proxy closed during CONNECT"))
    );
  });
}

function parseStatusLine(head) {
  const line = String(head || "").split("\r\n")[0] || "";
  const m = /^HTTP\/\d\.\d\s+(\d+)/i.exec(line);
  return {
    status: m ? Number(m[1]) : 0,
    statusLine: line,
  };
}

/**
 * Start a localhost forwarder for an authenticated HTTP(S) upstream proxy.
 *
 * @param {{
 *   host: string,
 *   port: string | number,
 *   username?: string | null,
 *   password?: string | null,
 *   protocol?: string,
 * }} upstream
 * @returns {Promise<{
 *   port: number,
 *   serverUrl: string,
 *   authHeaderPresent: boolean,
 *   close: () => Promise<void>,
 *   stats: () => { connects: number, connectOk: number, connectFail: number, lastError: string | null },
 * }>}
 */
async function startLocalAuthProxy(upstream) {
  const host = String(upstream?.host || "").trim();
  const port = Number(upstream?.port);
  if (!host || !Number.isFinite(port) || port <= 0) {
    throw new Error("localAuthProxy: upstream host/port required");
  }

  const protocol = String(upstream?.protocol || "http").toLowerCase();
  if (protocol.startsWith("socks")) {
    const err = new Error(
      "Authenticated SOCKS proxies need a SOCKS forwarder; use an HTTP " +
        "residential endpoint for SCRAPE_PROXY (IPRoyal http://user:pass@host:port)."
    );
    err.code = "PROXY_SOCKS_UNSUPPORTED";
    throw err;
  }

  const username = upstream?.username || "";
  const password = upstream?.password || "";
  const authHeader =
    username || password ? basicAuthHeader(username, password) : null;

  let connects = 0;
  let connectOk = 0;
  let connectFail = 0;
  let lastError = null;

  const server = http.createServer((req, res) => {
    // Chromium mainly uses CONNECT for HTTPS; still forward plain HTTP.
    try {
      const target = new URL(req.url || "/", "http://example.invalid");
      const headers = { ...req.headers, host: target.host };
      if (authHeader) headers["proxy-authorization"] = authHeader;
      delete headers["proxy-connection"];

      const preq = http.request(
        {
          host,
          port,
          method: req.method,
          path: req.url,
          headers,
        },
        (pres) => {
          res.writeHead(pres.statusCode || 502, pres.headers);
          pres.pipe(res);
        }
      );
      preq.on("error", (err) => {
        lastError = err?.message || String(err);
        if (!res.headersSent) {
          res.writeHead(502, { "Content-Type": "text/plain" });
        }
        res.end(`upstream proxy error: ${lastError}`);
      });
      req.pipe(preq);
    } catch (err) {
      lastError = err?.message || String(err);
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end(lastError);
    }
  });

  server.on("connect", (req, clientSocket, head) => {
    connects += 1;
    const target = String(req.url || "").trim();
    if (!target || !target.includes(":")) {
      connectFail += 1;
      lastError = "invalid CONNECT target";
      try {
        clientSocket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      } catch {
        // ignore
      }
      clientSocket.destroy();
      return;
    }

    const upstreamSocket =
      protocol === "https"
        ? tls.connect({ host, port, servername: host })
        : net.connect({ host, port });

    const fail = (err) => {
      connectFail += 1;
      lastError = err?.message || String(err);
      try {
        if (!clientSocket.destroyed) {
          clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
        }
      } catch {
        // ignore
      }
      try {
        clientSocket.destroy();
      } catch {
        // ignore
      }
      try {
        upstreamSocket.destroy();
      } catch {
        // ignore
      }
    };

    upstreamSocket.once("error", fail);
    clientSocket.once("error", () => {
      try {
        upstreamSocket.destroy();
      } catch {
        // ignore
      }
    });

    upstreamSocket.once("connect", async () => {
      try {
        let connectReq =
          `CONNECT ${target} HTTP/1.1\r\n` +
          `Host: ${target}\r\n` +
          `Proxy-Connection: keep-alive\r\n`;
        if (authHeader) {
          connectReq += `Proxy-Authorization: ${authHeader}\r\n`;
        }
        connectReq += "\r\n";
        upstreamSocket.write(connectReq);

        const { head: respHead, rest } = await readHttpHead(upstreamSocket);
        const { status, statusLine } = parseStatusLine(respHead);
        if (status !== 200) {
          const err = new Error(
            status === 407
              ? `upstream proxy rejected credentials (HTTP 407) for CONNECT ${target}`
              : `upstream proxy CONNECT failed (${statusLine || status}) for ${target}`
          );
          err.code = status === 407 ? "PROXY_AUTH_FAILED" : "PROXY_CONNECT_FAILED";
          fail(err);
          return;
        }

        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (rest?.length) clientSocket.write(rest);
        if (head?.length) upstreamSocket.write(head);

        upstreamSocket.pipe(clientSocket);
        clientSocket.pipe(upstreamSocket);
        connectOk += 1;
      } catch (err) {
        fail(err);
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  const localPort = address && typeof address === "object" ? address.port : 0;
  if (!localPort) {
    server.close();
    throw new Error("localAuthProxy: failed to bind localhost port");
  }

  const serverUrl = `http://127.0.0.1:${localPort}`;

  return {
    port: localPort,
    serverUrl,
    authHeaderPresent: Boolean(authHeader),
    stats: () => ({ connects, connectOk, connectFail, lastError }),
    close: () =>
      new Promise((resolve) => {
        try {
          server.close(() => resolve());
          // Force-close lingering sockets so Railway scrapes don't leak.
          setTimeout(resolve, 1500).unref?.();
        } catch {
          resolve();
        }
      }),
  };
}

/**
 * Probe public exit IP (and optional country) through the local forwarder.
 * Uses HTTPS CONNECT so it exercises the same path Chromium will use.
 */
async function probeProxyExit(localProxyUrl, { timeoutMs = 25000 } = {}) {
  const local = new URL(localProxyUrl);
  const localPort = Number(local.port);
  const localHost = local.hostname || "127.0.0.1";

  const connectViaLocal = (host, port) =>
    new Promise((resolve, reject) => {
      const socket = net.connect({ host: localHost, port: localPort });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`proxy exit probe CONNECT timed out (${host}:${port})`));
      }, timeoutMs);

      socket.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });

      socket.once("connect", () => {
        socket.write(
          `CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`
        );
      });

      let buf = Buffer.alloc(0);
      socket.on("data", (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        const idx = buf.indexOf("\r\n\r\n");
        if (idx === -1) return;
        clearTimeout(timer);
        const head = buf.slice(0, idx).toString("utf8");
        const { status, statusLine } = parseStatusLine(head);
        if (status !== 200) {
          socket.destroy();
          const err = new Error(
            status === 407
              ? "proxy exit probe: HTTP 407 (bad user:pass)"
              : `proxy exit probe CONNECT failed: ${statusLine || status}`
          );
          err.code = status === 407 ? "PROXY_AUTH_FAILED" : "PROXY_CONNECT_FAILED";
          reject(err);
          return;
        }
        const rest = buf.slice(idx + 4);
        socket.removeAllListeners("data");
        resolve({ socket, headRest: rest });
      });
    });

  const httpsGet = async (hostname, path) => {
    const { socket, headRest } = await connectViaLocal(hostname, 443);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`proxy exit probe TLS/HTTP timed out (${hostname})`));
      }, timeoutMs);

      const secure = tls.connect(
        { socket, servername: hostname },
        () => {
          secure.write(
            `GET ${path} HTTP/1.1\r\nHost: ${hostname}\r\nConnection: close\r\nAccept: application/json\r\n\r\n`
          );
        }
      );
      if (headRest?.length) secure.write(headRest);

      let data = Buffer.alloc(0);
      secure.on("data", (c) => {
        data = Buffer.concat([data, c]);
      });
      secure.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      secure.on("end", () => {
        clearTimeout(timer);
        const text = data.toString("utf8");
        const bodyIdx = text.indexOf("\r\n\r\n");
        const body = bodyIdx >= 0 ? text.slice(bodyIdx + 4) : text;
        resolve(body.trim());
      });
    });
  };

  let ip = null;
  let country = null;
  let raw = null;

  try {
    raw = await httpsGet("api.ipify.org", "/?format=json");
    const parsed = JSON.parse(raw);
    ip = parsed?.ip || null;
  } catch (err) {
    // Fallback path
    try {
      raw = await httpsGet("ifconfig.me", "/ip");
      ip = String(raw || "")
        .trim()
        .split(/\s+/)[0] || null;
    } catch (err2) {
      const wrapped = new Error(
        `Could not probe exit IP via SCRAPE_PROXY: ${err2?.message || err?.message || err}`
      );
      wrapped.code = err?.code || err2?.code || "PROXY_PROBE_FAILED";
      wrapped.cause = err2 || err;
      throw wrapped;
    }
  }

  // Best-effort country (ipapi.co is free-ish; failures are non-fatal).
  if (ip) {
    try {
      const geoRaw = await httpsGet("ipapi.co", `/${encodeURIComponent(ip)}/json/`);
      const geo = JSON.parse(geoRaw);
      country = geo?.country_code || geo?.country || null;
    } catch {
      // ignore
    }
  }

  return { ip, country, raw };
}

module.exports = {
  startLocalAuthProxy,
  probeProxyExit,
};
