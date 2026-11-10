# Course Enrollment Kiosk

A self-service course enrollment kiosk (PWA). A student searches for a course,
reviews it, enters **only** a name and mobile number, pays, and gets a receipt.
No login, no cart, no accounts.

**Stack:** Next.js 16 (App Router) · HeroUI v3 · Tailwind CSS v4 · DM Sans ·
Bun API · SQLite · Razorpay

---

## Quick start

```bash
bun install
bun run seed          # 17 dummy courses + 90 days of sample enrollments
bun run dev:api       # API   → http://localhost:4000
bun run dev:web       # Kiosk → http://localhost:3000
```

Both at once: `bun run dev`

---

## Repository layout

```
shared/     @course-lms/shared — the API contract, imported by both sides
backend/    Bun.serve API, bun:sqlite, Razorpay integration
frontend/   Next.js kiosk
scripts/    screenshots.mjs — drives the whole flow and captures every screen
design.md   the design system (read this before touching UI)
```

---

## Payments

Payment runs through a **gateway selector** shown after the student enters their
name and mobile number. Gateways are pluggable — each implements the same
contract, so adding one touches no UI code.

| Gateway | What it does |
| --- | --- |
| **Razorpay** | Real hosted checkout — cards, UPI, net banking, wallets |
| **Offline demo** | Simulated gateway; no network. Keeps the flow demoable offline |

### Razorpay setup

Credentials live in the **repo-root `.env`** (loaded by the backend by walking
up from its working directory):

```bash
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxx
RAZORPAY_CURRENCY=INR
```

The API logs which mode it is in at startup. A `rzp_test_*` key puts the kiosk
in test mode and the UI shows a **"Test mode — no real money is charged"** badge
next to the gateway.

**How a payment is actually confirmed:**

1. `POST /api/payments/intent` creates a Razorpay **order** server-side.
2. The browser opens Razorpay Checkout with that order and the *publishable*
   key id. The secret never leaves the server.
3. `POST /api/payments/verify` recomputes the HMAC-SHA256 signature over
   `order_id|payment_id`, compares it in constant time, then **re-fetches the
   payment from Razorpay** and checks its status, order and amount before
   confirming anything.

That last step is the security boundary: without it a student could POST a
made-up payment id and get a confirmed enrollment.

### Testing a decline

The offline demo gateway has deterministic triggers so the failure/retry path is
demonstrable:

| Method | Value that declines |
| --- | --- |
| Card | `4000 0000 0000 0002` |
| UPI | any id starting `fail@` |
| Net banking | bank code `FAIL` |

Razorpay's own test cards are in
[their docs](https://razorpay.com/docs/payments/payments/test-card-details/).

---

## Receipt printing

The receipt **prints automatically** when the confirmation screen appears. It is
rendered as a self-contained HTML document (no external assets, so it prints
identically offline) into a hidden iframe.

By default the browser shows its print dialog. For a real kiosk you want silent
printing to the attached printer — launch Chrome with:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --kiosk \
  --kiosk-printing \
  http://localhost:3000
```

`--kiosk-printing` makes `window.print()` go straight to the default printer
with no dialog. Set the receipt printer as the system default first.

Behaviour worth knowing:

- The auto-return countdown **pauses while printing** so the kiosk can't reset
  mid-job.
- It prints **once** per enrollment; **Print again** on the confirmation screen
  reprints on demand.
- Turn it off per-site with `kiosk.autoPrintReceipt: false` (via
  `PATCH /api/admin/config`), and tune `kiosk.autoPrintDelayMs` if the printer
  needs the screen settled first.

## Admin access

The admin panel at `/admin` is behind a password. The API checks it server-side and
issues a **signed, httpOnly session cookie** — nothing secret is ever sent to the
browser's JavaScript.

If `ADMIN_PASSWORD` is not set, the API generates one at startup and prints it:

```
  ⚠ No ADMIN_PASSWORD set. Generated one for this run:

        admin password:  agy2-j7he-7nb5

    Set ADMIN_PASSWORD in .env to make it permanent.
```

Set `ADMIN_PASSWORD` in `.env` to pin it, and `ADMIN_SESSION_SECRET` to keep sessions
alive across restarts (otherwise a restart signs admins out).

> An earlier version read `NEXT_PUBLIC_ADMIN_TOKEN` in the browser. That is gone:
> `NEXT_PUBLIC_*` values are inlined into the client bundle, so the admin secret
> shipped in readable JavaScript to every visitor. Auth is now cookie-based and
> **fails closed** — with no password configured, admin endpoints return 401 rather
> than running unauthenticated.

### Admin password is rejected

Run the diagnostic on the machine serving the API — it reports facts only, never
prints a password, and exits non-zero when it finds something that would break the
login:

```bash
bash scripts/diagnose-admin.sh
```

It reads the API port from your `.env` rather than assuming one, and checks the five
things that actually cause this: a deployment predating the `.env` loading fix, a
missing `ADMIN_PASSWORD`, a quoted or space-padded value, a stale process still
serving its own older password, and a process manager whose `env` block overrides
the file.


The startup banner says which case you are in:

| Banner | Meaning |
| --- | --- |
| `Admin: password set from ADMIN_PASSWORD (… fingerprint …)` | Your configured password is in force. |
| `⚠ No ADMIN_PASSWORD set` | A throwaway password was generated, and **it changes on every restart**. |

A refused login logs why — lengths and fingerprints of both sides, never the
passwords themselves — including whether it would match once trimmed.

**Quote any value containing `#`.** An unquoted `#` opens a comment, so the
first line below sets the password to `abc`, not `abc#def`:

```bash
ADMIN_PASSWORD=abc#def       # password is "abc"
ADMIN_PASSWORD="abc#def"     # password is "abc#def"
```

Every dotenv parser behaves this way. The API warns at startup when it finds a
value cut short like this, because the symptom is indistinguishable from simply
having the wrong password.

If a password that should be right keeps failing, check that a stale process is
not still holding the port. The old one keeps serving, with its old password,
while the new one fails to bind:

```bash
lsof -nP -iTCP:4000 -sTCP:LISTEN     # expect exactly one
lsof -ti:4000 | xargs kill           # if a restart seems to do nothing
```

## Environment

All ports live in the root `.env` and nothing hard-codes them. `scripts/env.mjs`
resolves them once; `scripts/dev.mjs` hands each server the `PORT` it already
understands, and `NEXT_PUBLIC_API_URL` is derived from `API_PORT` unless set
explicitly.

```bash
API_PORT=4000
WEB_PORT=3000
API_HOST=0.0.0.0
```

`.claude/launch.json` needs literal ports (JSON can't interpolate), so it is
**generated**. After changing a port:

```bash
bun run sync:launch
```

> Note: the resolver deliberately ignores a bare `PORT`. A launcher sets `PORT`
> for the process it starts, so honouring it made the web server resolve the
> API's port to its own — the kiosk then called itself and every request 404'd.

### Pointing the kiosk at the API

The browser calls **same-origin `/api/...`**, and the Next server proxies those
to the API (`rewrites` in `next.config.ts`). Two consequences worth knowing:

- **No CORS.** All traffic is same-origin as far as the browser is concerned.
- **No rebuild to move the API.** `API_URL` is read when the server boots, not
  when the bundle is compiled, so one build runs against any API:

  ```bash
  API_URL=http://192.168.1.50:4000 bun run --cwd frontend start
  ```

Set `NEXT_PUBLIC_API_URL` **only** if the browser must call the API directly on
another origin. It disables the proxy, is inlined into the bundle at build time
(so it cannot be changed without recompiling), and requires CORS on the API.

| Variable | Default | Purpose |
| --- | --- | --- |
| `API_PORT` | `4000` | API port |
| `WEB_PORT` | `3000` | Kiosk port |
| `API_HOST` | `0.0.0.0` | API bind address |
| `API_URL` | `http://localhost:$API_PORT` | Proxy target — **runtime**, no rebuild |
| `NEXT_PUBLIC_API_URL` | _unset_ | Direct browser→API origin. **Build-time**; needs CORS |
| `RAZORPAY_KEY_ID` / `_SECRET` | — | Razorpay credentials |
| `ADMIN_TOKEN` | unset | When set, admin endpoints require `X-Admin-Token` |
| `PAYMENT_LATENCY_MS` | `1200` | Simulated gateway latency |
| `PAYMENT_FAILURE_RATE` | `0` | Random failure rate for the simulated gateway |
| `DEFAULT_COUNTRY_CODE` | `91` | Applied to bare 10-digit mobile numbers |
| `ENABLE_SIMULATED_GATEWAY` | `true` | Set `false` to hide the offline gateway |

---

## Verifying a change

```bash
bun run typecheck                 # both workspaces
bun scripts/screenshots.mjs       # drives the full flow, writes ./screenshots
```

`screenshots.mjs` is the real end-to-end test: it searches, filters, opens a
course, fills the form, chooses a gateway, opens Razorpay Checkout, declines a
card, retries, and lands on the confirmation — at **desktop and phone**
viewports, plus dark mode and Arabic RTL. If it completes, the flow works.

---

## Notable behaviours

- **Modals become bottom drawers under 768px** (`components/ui/ResponsiveDialog.tsx`).
- **The whole journey lives in one overlay.** Details → enroll → pay → confirm
  swap views inside a single dialog; two sibling overlays race React Aria's
  focus restoration.
- **Course art is generated**, not fetched — a deterministic gradient from the
  course slug. A kiosk must render with no network. Admin uploads override it.
- **The filter row never wraps.** It scrolls sideways, and goes full-bleed when
  it sticks. It hides on scroll-down and returns on scroll-up.
- **Auto-return**: the confirmation screen counts down and returns to the
  listing; touching anything cancels it. Idle anywhere resets the session.
- **Prices and IDs always use Latin digits**, even in Arabic.

---

## API

Public: `/api/health` · `/api/config` · `/api/categories` · `/api/courses` ·
`/api/courses/:id` · `/api/enrollments` · `/api/enrollments/:id` ·
`/api/enrollments/:id/receipt` · `/api/payments` · `/api/payments/gateways` ·
`/api/payments/intent` · `/api/payments/verify` · `/api/payments/failure`

Admin (`/api/admin/…`): `stats` · `courses` CRUD + `/status` · `categories` CRUD ·
`enrollments` + `/export` (CSV) · `payments` + `/:id/refund` ·
`reports/{revenue,enrollments,popular-courses,payment-methods}` · `config` · `logs` ·
`uploads`

Every enrollment and payment event is written to an append-only `activity_logs`
table.
