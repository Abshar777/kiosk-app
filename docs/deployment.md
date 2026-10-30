# Deployment

## Read this first: where the backend runs is not a free choice

The card machine is reached over the kiosk's **LAN** or a **USB cable**. Neither is
reachable from a cloud host — a server in a Vercel region cannot open a TCP socket to a
terminal sitting in your branch, and certainly cannot open a serial port.

**If you take card payments on a terminal, the Bun API must run on the kiosk machine.**
That is not a limitation of this code; it is what "the terminal is on the local network"
means.

This gives two shapes, and they are not alternatives — most sites want both.

---

## Shape A — the kiosk itself (required for the card machine)

Both the API and the Next.js server run on the kiosk PC. The browser talks to
`localhost`, the API talks to the terminal. Works with no internet beyond what the
online gateway needs.

```
┌─ kiosk PC ─────────────────────────────┐
│  Chrome --kiosk  →  localhost:3000     │   Next.js
│                     localhost:4000     │   Bun API  ──LAN/USB──▶ card terminal
│                     data/kiosk.sqlite  │
└────────────────────────────────────────┘
```

### What to install

- **Bun** 1.3+ (`curl -fsSL https://bun.sh/install | bash`, or the Windows installer)
- **Google Chrome**
- Nothing else — SQLite is built into Bun

### Setup

```bash
git clone <this repo>
cd "course lms"
bun install
bun run --cwd backend seed      # first run only; creates data/kiosk.sqlite
bun run --cwd frontend build
```

`.env` at the repo root:

```bash
API_PORT=4000
WEB_PORT=3000
API_HOST=127.0.0.1              # loopback only: nothing off-machine should reach the API
ADMIN_PASSWORD=<choose one>
ADMIN_SESSION_SECRET=<64 random hex chars>
```

> `ADMIN_SESSION_SECRET` matters here. Without it a new signing key is generated at every
> boot, so a restart signs admins out. Generate one with `openssl rand -hex 32`.

### Running it as a service

Both processes must come back after a power cut. On Windows use
[NSSM](https://nssm.cc/) or Task Scheduler "At startup"; on Linux, systemd:

```ini
# /etc/systemd/system/kiosk-api.service
[Service]
WorkingDirectory=/opt/kiosk
ExecStart=/usr/local/bin/bun run --cwd backend start
Restart=always
EnvironmentFile=/opt/kiosk/.env
[Install]
WantedBy=multi-user.target
```

Same again for the web server with `bun run --cwd frontend start`.

### Launching the browser

```bash
chrome --kiosk --kiosk-printing --noerrdialogs \
       --disable-pinch --overscroll-history-navigation=0 \
       http://localhost:3000
```

`--kiosk-printing` is what makes the receipt print silently. Set the receipt printer as
the **system default** first, or Chrome prints to whatever is.

### Backups

Everything lives in `backend/data/kiosk.sqlite`. Back it up on a schedule — it holds
every enrolment and payment. Copy it with the API stopped, or use
`sqlite3 kiosk.sqlite ".backup out.sqlite"` which is safe while running.

---

## Shape B — Vercel, for the admin panel

Useful when head office needs reports without walking to a kiosk.

### What Vercel can and cannot host

| | Vercel |
| --- | --- |
| Next.js frontend | **Yes** |
| Bun API | **No** |

The API is a long-lived process with a SQLite file on disk and (for LAN terminals) raw
TCP sockets. Vercel's functions are serverless: no persistent disk, no long-lived
sockets. Putting the API there would lose every enrolment on redeploy.

**So the API needs a real host** — a small VPS, or the kiosk machine exposed through a
tunnel. It must be reachable over **HTTPS**, because the session cookie is marked
`Secure` the moment the request arrives over TLS.

### Vercel project settings

- **Root directory:** `frontend`
- **Framework preset:** Next.js
- **Build command:** `bun run build` (or leave the default)
- **Environment variables:**

  | Name | Value | Notes |
  | --- | --- | --- |
  | `API_URL` | `https://api.your-domain.ae` | Runtime. The Next server proxies `/api/*` here. |

That is the only one required. **Do not set `NEXT_PUBLIC_API_URL`** — it would disable
the proxy, make the browser call the API cross-origin, and the `SameSite=Strict` session
cookie would stop being sent. Leaving it unset keeps everything same-origin.

### API host

Put the Bun API behind a TLS terminator (Caddy, nginx, or a managed load balancer):

```
Caddyfile
api.your-domain.ae {
    reverse_proxy 127.0.0.1:4000
}
```

Caddy sets `X-Forwarded-Proto: https`, which is how the API knows to mark the session
cookie `Secure`.

**A cloud-hosted API cannot drive a card terminal.** Keep card payments on the kiosk's
own API; use the cloud one for admin and reporting.

---

## Checklist before going live

- [ ] `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET` set — not the generated ones
- [ ] `API_HOST=127.0.0.1` on the kiosk, so the API is not exposed on the LAN
- [ ] Real gateway credentials, and `isTestMode` confirmed off in the gateway list
- [ ] Receipt printer is the system default; `--kiosk-printing` verified with a real sale
- [ ] `data/kiosk.sqlite` backup scheduled and a restore actually tested
- [ ] Both services restart after a reboot — pull the plug and check
- [ ] Card machine: Terminal ID confirmed in **integrated (ECR)** mode by the acquirer
