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

**TikLeap (local/optional):** `ENABLE_TIKLEAP=1` and/or `SCRAPE_MODE=full`

- Priority pipeline: LIVE NOW → other TikLeap GB → TikTok feed
- Needs **headed Chrome**, Premium cookies, and usually fails on Railway (no display, Cloudflare blocks headless, ephemeral FS unless volume)

TikLeap is **not** required for Railway deploys.

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
3. Set env vars (below).
4. Deploy. Health: `GET /api/health`.

### Required env

| Variable | Purpose |
|----------|---------|
| `PORT` | Railway sets this; app already reads it |
| `SESSION_SECRET` | HMAC secret for session cookies |
| `ADMIN_USER` | Admin login username |
| `ADMIN_PASSWORD` | Admin login password (v1 plain env) |
| `SCRAPE_MODE` | `tiktok_feed` (recommended) |
| `COOKIE_SECURE` | `1` on HTTPS so cookies set `Secure` |

### Optional env

| Variable | Purpose |
|----------|---------|
| `ENABLE_TIKLEAP` | `1` only if you intentionally run full TikLeap (not for Railway) |
| `LEAD_FINDER_CHROME_PATH` | Path to Chromium (Dockerfile sets `/usr/bin/chromium`) |
| `LEAD_FINDER_HEADED` | `1` for visible Chrome (local) |

### Caveats (24/7 on Railway)

- **Yes, with caveats:** the HTTP app + feed scrape can run 24/7 if Chromium works in the container and `data/` is on a volume.
- TikTok may still rate-limit or challenge headless browsers; scrapes can be flaky.
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
