# CreatorRadar

Multi-role TikTok Live lead finder: public landing, user CRM (assigned leads), and admin dashboard (scrape / erase / distribute).

## Roles

| Role | Access |
|------|--------|
| **Public** | Landing at `/` — Log in / Get started |
| **User** | `/app` — CRM for **assigned leads only** (no Get leads / erase / distribute) |
| **Admin** | `/admin` — Get leads, erase (tombstones), distribute pool → users, close accounts, overview |

Auth uses httpOnly signed session cookies. Logins are **username + password** (email is not required). Users live in `data/users.json` (scrypt password hashes). Sessions in `data/sessions.json`.

## Scrape modes (Railway)

**Default / production:** `SCRAPE_MODE=tiktok_feed`

- Scrapes TikTok Live **suggested feed** only (`chrome-tiktok-feed-profile`)
- Keeps creators with **GB/UK feed signals**
- **Unknown diamonds kept**; TikLeap diamond/month gates are skipped
- Chromium can run headless in Docker

**UK residential proxy (required for reliable Railway scrapes):** set `SCRAPE_PROXY` (or `LEAD_FINDER_PROXY`). Without it, Railway datacenter IPs usually get a non-UK suggested feed and many HTTP 403s on feed pagination → **0 GB keepers**.

**TikLeap (local/optional):** `ENABLE_TIKLEAP=1` and/or `SCRAPE_MODE=full`

- Priority pipeline: LIVE NOW → other TikLeap GB → TikTok feed
- Needs **headed Chrome**, Premium cookies, and usually fails on Railway (no display, Cloudflare blocks headless, ephemeral FS unless volume)

TikLeap is **not** required for Railway deploys. Keep `ENABLE_TIKLEAP` unset / off on Railway.

## Local start

```bash
cd lead-finder
cp .env.example .env   # edit secrets (also loaded from data/.env.runtime)
./start.sh             # or: npm start → node server/index.js
```

`server/loadEnv.js` reads `.env` then `data/.env.runtime` on boot (does not override existing env).

Open http://localhost:8787

Optional TikLeap locally:

```bash
export ENABLE_TIKLEAP=1 SCRAPE_MODE=full
./scripts/tikleap-login.sh
./start.sh
```

## Railway deploy

1. New project from this folder (Dockerfile).
2. **Volume** mount at `/app/data` so `leads.json`, `users.json`, sessions, denylist, and Chrome profiles persist.
3. Set env vars (below) — especially a **UK residential** `SCRAPE_PROXY`.
4. Deploy. Health: `GET /api/health` (includes `scrapeProxyConfigured`).

### Required env

| Variable | Purpose |
|----------|---------|
| `PORT` | Railway sets this; app already reads it |
| `SESSION_SECRET` | HMAC secret for session cookies |
| `ADMIN_USER` | Admin login username |
| `ADMIN_PASSWORD` | Admin login password (v1 plain env) |
| `SCRAPE_MODE` | `tiktok_feed` (recommended) |
| `COOKIE_SECURE` | `1` on HTTPS so cookies set `Secure` |

### Strongly recommended on Railway

| Variable | Purpose |
|----------|---------|
| `SCRAPE_PROXY` | UK **residential** HTTP or SOCKS5 proxy for Chromium (alias: `LEAD_FINDER_PROXY`) |

Formats (credentials in the URL are fine — a localhost forwarder injects `Proxy-Authorization` on HTTPS CONNECT; Chromium never sees user/pass):

```text
http://USERNAME:PASSWORD@host:port
```

IPRoyal UK example: `http://USER:PASS_country-gb@geo.iproyal.com:12321` (country suffix is part of the **password**).

URL-encode special characters in user/pass (`@` → `%40`, `#` → `%23`, `:` → `%3A`). Plain `_` in `PASS_country-gb` needs no encoding.

Use a **UK exit**. Rotating or sticky residential both work; sticky can be slightly more stable for one long Get-leads run. Do **not** use cheap datacenter proxies — TikTok treats them like Railway’s own IP.

Example providers (buy UK residential yourself; we don’t affiliate): **Bright Data**, **Oxylabs**, **IPRoyal**. Prefer **HTTP** residential endpoints (authenticated SOCKS5 is not supported by the local forwarder).

### Optional env

| Variable | Purpose |
|----------|---------|
| `LEAD_FINDER_PROXY` | Same as `SCRAPE_PROXY` if `SCRAPE_PROXY` is unset |
| `ENABLE_TIKLEAP` | Leave unset on Railway |
| `LEAD_FINDER_CHROME_PATH` | Path to Chromium (Dockerfile sets `/usr/bin/chromium`) |
| `LEAD_FINDER_HEADED` | `1` for visible Chrome (local only) |

### Verify after setting the proxy

1. Redeploy / restart so Chromium picks up the new env.
2. Check logs for `via local forwarder http://127.0.0.1:…`, `SCRAPE_PROXY exit probe: ip=… country=GB`, and `browser exit probe: ip=…` (credentials redacted).
3. Admin → **Get leads**. Expect fewer pagination 403s and some GB keepers in the pool.
4. Admin meta bar should show `Proxy: on (…)`; health JSON has `"scrapeProxyConfigured": true`.

### Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| Still 0 GB keepers, many 403s | Proxy not set, wrong var name, or redeploy not done |
| `ERR_TUNNEL` / `PROXY_TUNNEL_FAILED` | Auth/CONNECT failed or dead upstream — check user/pass + UK exit + IPRoyal traffic balance |
| `CDP Page.navigate timeout` / `PROXY_NAVIGATE_TIMEOUT` | Proxy too slow or unreachable |
| `PROXY_AUTH_FAILED` / HTTP 407 | Bad `user:pass` (unencoded `@`/`#`/`:`), missing `_country-gb`, **or IPRoyal balance $0.00 / inactive sub** |
| Exit probe `country` not GB/UK | Provider geo targeting wrong — fix `_country-gb` / sticky session |
| Creators seen but no GB signals | Exit IP is not UK (or not residential) — check provider geo |
| Cloudflare / challenge / no `max_time` with proxy on | Residential pool flagged **or** TikTok challenging **headless** Chromium — rotate session or scrape locally headed |
| Admin `Proxy: not set` | Variable missing on the Railway **service** (not only project) |

### Caveats (24/7 on Railway)

- Proxy quality and cost matter; TikTok may still challenge some providers.
- Without a volume, leads/users reset on every deploy/restart.
- Auto-refresh scheduler still runs; admin can also press **Get leads**.

## Lead distribution

1. Admin runs **Get leads** → new rows land in the **unassigned pool** (`assignedToUserId: null`).
2. Admin picks a user + count → **Assign** (`POST /api/admin/distribute`).
3. That user’s `/app` and `/api/leads` only return their assigned rows.
4. Status updates by users persist and are not clobbered by scrape (existing CRM/denylist rules).

## Close user accounts

From the admin users table, **Close account** permanently deletes the user from `data/users.json`, invalidates their sessions, and clears `assignedToUserId` on their leads so those leads return to the pool. Leads themselves are not deleted.

`DELETE /api/admin/users/:userId` (admin session required).

## Routes

- `GET /` — landing
- `GET /app` — user CRM (session)
- `GET /admin` — admin dashboard (admin session)
- `POST /api/auth/register` · `login` · `admin-login` · `logout`
- `GET /api/auth/me`
- `GET/PATCH /api/leads` — scoped by role
- `POST /api/refresh` · `DELETE /api/leads` — admin only
- `GET/POST /api/admin/users` · `DELETE /api/admin/users/:userId` · `GET /api/admin/overview` · `POST /api/admin/distribute`
