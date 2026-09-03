# Remote Cloud Printing System

Send a print job from a phone on any internet connection (5G, a different
Wi-Fi, anywhere) and have it print on a Wi-Fi/network printer at a
completely different location. The phone and the printer never need to be
on the same network.

```text
📱 Mobile (any network)
      │ HTTPS
      ▼
☁️  Cloud Backend (MongoDB-backed job queue, JWT auth)
      │ HTTPS polling (outbound only, from the printer's side)
      ▼
🖥️  Print Agent (on the printer's network)
      │ Local Wi-Fi/USB
      ▼
🖨️  Printer
```

The printer's IP/port is **never** exposed to the internet, no router port
forwarding is required, and the Print Agent only ever makes outbound
requests - nothing connects inbound to the printer's network.

## Project layout

```text
mobile-print-system/
├── backend/       Node.js + Express + MongoDB cloud API (auth, printers, jobs)
├── frontend/      React mobile-first print page + admin panel
├── print-agent/   Windows agent: self-registers, auto-detects printers,
│                  polls for jobs, local dashboard (localhost:3001)
└── README.md      This file
```

---

## 1. Install Node.js

https://nodejs.org (v18+). Verify with `node -v`.

## 2. Set up MongoDB

You need a MongoDB connection string - a free [MongoDB Atlas](https://mongodb.com/cloud/atlas/register)
M0 cluster works fine:

1. Create a free cluster.
2. **Database Access** → add a database user with a password.
3. **Network Access** → allow `0.0.0.0/0` (needed since most hosts don't
   have a fixed outbound IP).
4. **Connect** → **Drivers** → copy the connection string
   (`mongodb+srv://user:password@cluster0.xxxxx.mongodb.net/`).

## 3. Backend setup

```bash
cd backend
npm install
cp .env.example .env
```

Edit `backend/.env`:

- `MONGODB_URI` - the connection string from step 2.
- `JWT_SECRET` - a long random value, e.g.
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- `PUBLIC_BASE_URL` - the HTTPS URL this backend is reachable at. For a
  same-machine trial `http://localhost:4000` is fine; for real remote use
  (phone on a different network) this **must** be a real public HTTPS URL
  (see Deployment below).

```bash
npm start
```

You should see `MongoDB connected` and `Print system backend listening on port 4000`.

## 4. Create your account

The **first** account ever registered automatically becomes an admin (no
separate seed script needed):

```bash
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"a-strong-password","name":"You"}'
```

Save the returned `token`, or just log in from the mobile page itself
(it has a "Create account" link).

## 5. Frontend setup

```bash
cd frontend
npm install
cp .env.example .env    # set VITE_BACKEND_URL to match backend's PUBLIC_BASE_URL
npm run dev
```

Open the printed URL, sign in (or create an account).

## 6. Print Agent setup (on the network with the printer)

```bash
cd print-agent
npm install
cp .env.example .env
```

Edit `print-agent/.env`:

- `BACKEND_URL` - same backend URL as above.
- `PRINT_AGENT_ID` - pick anything unique, e.g. `PC-001`.
- Leave `PRINT_AGENT_TOKEN` blank.

```bash
node agent.js
```

On first run the agent **registers itself** with the backend (spec
section 8: register → receive a secret token → store it locally in
`.env` → connect). Every printer Windows knows about is then
**auto-registered** with the backend and immediately selectable from the
mobile page - there's no manual "pick your printer" step.

Expected output:

```text
[11:20:01] Agent started
[11:20:01] Registering agent "PC-001" with backend...
[11:20:02] Agent registered and token saved to .env
[11:20:05] Dashboard available at http://localhost:3001
[11:20:05] Checking jobs
```

Open `http://localhost:3001` for the local dashboard: cloud connection
status, every detected printer, last job, jobs printed today, and a
**Test Print** button per printer.

## 7. Send a print job

1. Open the frontend, sign in.
2. Select a printer from the dropdown (shows 🟢 online / 🟠 unavailable / 🔴 offline).
3. Optionally pick a PDF, set copies/color, press **PRINT**.
4. Watch the status flow: Job Created → Printer Connected → Document
   Downloaded → Printing → **✓ Print Completed**.

For a true "different networks" test: run the Print Agent at Location B,
then open the mobile page from a phone on mobile data (Wi-Fi off) at
Location A. Nothing about the flow changes - that's the point.

---

## How the job lifecycle works (no double-printing)

```text
queued → assigned → downloading → printing → completed
                                            ↘ failed (after maxRetries)
```

- `GET /api/print-jobs/pending` atomically claims the oldest queued job for
  a printer the polling agent owns - `findOneAndUpdate` is atomic in
  MongoDB, so this is race-safe even across multiple backend instances.
- Job creation accepts an `idempotencyKey`; a retried create request with
  the same key returns the original job instead of creating a duplicate
  print (covers browser refresh / network retry / API retry).
- If an agent crashes mid-job, the claim expires after
  `JOB_CLAIM_TIMEOUT_MS` and the job is requeued - up to `maxRetries` (3)
  times, then permanently failed. It never retries forever.

## Security

- **Mobile auth**: JWT, 30-day tokens. `POST /api/print-jobs` and
  `POST /api/upload` require a valid token.
- **Agent auth**: each agent registers once and gets a random 32-byte
  token; only its bcrypt hash is stored, so a database leak alone can't
  be used to impersonate an agent. Never hardcoded, never in `.env.example`.
- **Files**: PDF-only, capped at `MAX_FILE_SIZE_MB`, stored in MongoDB
  GridFS (not local disk - survives restarts/redeploys), served only via
  signed, time-limited download links (`/api/files/:id?exp=&sig=`) that a
  database leak or URL guess can't turn into permanent access.
- **Network**: HTTPS end to end in production; the printer's IP/port is
  never reachable from the internet; the agent only makes outbound calls.
- **Admin actions** (rename/disable/delete a printer, trigger a test
  print) require `role: "admin"` on the JWT.

## Admin panel

Any admin account sees a **Manage Printers** link on the mobile page:
rename, disable/enable, delete, or trigger a real test print on any
registered printer, across every agent/location.

## Multi-shop mode (optional)

Everything above still works exactly as described - it's the personal/
single-tenant mode, and nothing about it changes unless you opt into
shops. Multi-shop mode adds a tenancy layer on top for running this as a
service across multiple Xerox/printing shops, each with its own QR code,
printers, and isolated data.

```text
Super Admin (you)
      │ creates shops
      ▼
   Shop (own QR code, own owner login, own printers/jobs)
      │
      ├── Print Agent(s), paired via a one-time pairing code (or SHOP_ID)
      │        └── that shop's printers only
      │
      └── Customers scan the shop's QR → guest session → upload PDF →
          print, scoped to that shop's printers only
```

**1. Create a shop** (super admin → **Shops** tab in the admin panel, or
directly):

```bash
curl -X POST $BACKEND_URL/api/admin/shops \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"shopName":"Patel Xerox Center","ownerEmail":"owner@example.com","ownerPassword":"a-strong-password"}'
```

This creates the shop (`shopId` like `SHOP-001`) and a `shop_owner` login
in one call. The shop owner signs in on the regular login page and lands
on their own dashboard (QR download, printers, print history) instead of
the personal print page.

**2. Pair a Print Agent to that shop.** The shop owner's dashboard has a
setup guide for this (**Connect New Print Agent** → generates a short,
one-time pairing code like `K7M-492-XQ2`, valid 15 minutes). Run the
Print Agent from a real console for the first time and it will prompt for
the code interactively - enter it, and the agent registers itself to that
shop automatically. A shop isn't limited to one agent; generate a new
code and connect another PC the same way.

For scripted/headless setups, the equivalent is setting `PAIRING_CODE=` in
`print-agent/.env` before first run, or the older direct route - add
`SHOP_ID=SHOP-001` to `.env`, delete `PRINT_AGENT_TOKEN` from the same
file, and restart to force re-registration under the shop. Leave both
`SHOP_ID` and `PAIRING_CODE` blank (the default) to keep an agent as
personal/standalone - it never touches shop data either way. **A shop's
printers, agents, and jobs are only ever visible to that shop's own
dashboard, the super admin, and customers who scanned that shop's own
QR** - enforced server-side, not just hidden in the UI.

**3. Customers print without any login**: scanning the shop's QR opens
`/print/shop/:shopId?t=<token>`, which exchanges the QR's token for a
short-lived (2h) guest session, then shows only that shop's printers.
Regenerating a shop's QR (super admin → Regenerate QR) invalidates old
printed QR codes without touching the shop's printers/history.

## Troubleshooting

| Message | Meaning | Fix |
|---|---|---|
| `Configured printer was not found.` | The job's target printer isn't in the agent's currently-detected list | Printer may be off/unplugged; check the dashboard's printer list |
| `Cannot connect to cloud backend. Retrying...` | Agent can't reach `BACKEND_URL` | Check the backend is running/reachable; check firewall |
| `Print agent authentication failed.` | The saved `PRINT_AGENT_TOKEN` is invalid (e.g. re-registered elsewhere) | Delete `PRINT_AGENT_TOKEN` from `.env` and restart - it will re-register |
| `Invalid or expired download link.` | The signed file URL's 24h window passed, or the signature doesn't match | Normal for very old retried jobs; create a new print job |
| `This print job has already been claimed.` | Another agent (or a stale retry) already owns this job | Expected - the duplicate-print protection working as intended |
| 401 on mobile actions | JWT expired or missing | Sign in again |

Agent activity is logged to `print-agent/logs/agent.log` and shown live in
the dashboard's **View Logs** panel.

## Running the Print Agent automatically on Windows startup

Use **Task Scheduler** so it starts without anyone logging in:

1. **Create Task...** (not "Basic Task") → General: check "Run whether
   user is logged on or not" + "Run with highest privileges".
2. Triggers → New → "At startup".
3. Actions → New → Program: `node.exe`, Arguments: `agent.js`, Start in:
   the full path to `print-agent/`.
4. Settings: uncheck "only if on AC power" for a desktop.

## Deployment (making it work from anywhere)

- **Frontend**: any static host (Vercel, Netlify, ...) - it's a Vite
  build (`npm run build` → `dist/`).
- **Backend**: needs a host that runs a real long-lived Node process (not
  stateless serverless) - Render, Railway, Fly.io, or a VPS all work. Set
  `MONGODB_URI`, `JWT_SECRET`, and `PUBLIC_BASE_URL` (the backend's own
  public HTTPS URL) as environment variables there.
- **Print Agent**: stays on a PC on the printer's network, always. It
  never gets "deployed" anywhere public - that's the entire point of this
  architecture.

## Reusing this for billing/invoices

Any system that can `POST` a PDF URL to `/api/print-jobs` (with a valid
JWT and a registered `printerId`) can reuse this exact pipeline - bills,
GST invoices, kitchen tickets, receipts, reports. No backend or agent
changes needed; just point another app's "generate PDF → print" step at
this API.
