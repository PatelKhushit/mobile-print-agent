# Mobile-to-PC Cloud Printing System (Test Version)

Send a print job from a phone's browser, have it queue in a cloud backend,
and have a Windows PC automatically pick it up and print it on a real
USB/Wi-Fi printer.

```text
Mobile Web Page  --HTTPS-->  Cloud Backend  <--HTTPS polling--  Local Print Agent  -->  Windows Printer
```

The printer is **never** exposed to the internet. The Local Print Agent runs
on the printer's PC and makes outbound requests to the backend - nothing
ever connects inbound to the PC or the printer.

## Project layout

```text
mobile-print-system/
├── backend/       Node.js + Express cloud API, job queue, job claiming
├── frontend/      React mobile-first "Test Print" web page
├── print-agent/   Windows Node.js agent + local dashboard (localhost:3001)
└── README.md      This file
```

---

## 1. Install Node.js

Download and install the LTS version from https://nodejs.org (v18 or newer).
Verify with:

```bash
node -v
npm -v
```

## 2. Backend setup

```bash
cd backend
npm install
cp .env.example .env
```

Edit `backend/.env`:

- `PUBLIC_BASE_URL` - the URL this backend is reachable at. For a same-machine
  trial, `http://localhost:4000` is fine. If your phone needs to reach it
  over Wi-Fi, use your PC's LAN IP, e.g. `http://192.168.1.20:4000`, and make
  sure `PORT` matches.
- `AGENT_CREDENTIALS` - one `agentId:secret` pair per PC that will run a
  Local Print Agent, e.g. `PC-001:pick-a-long-random-secret`. Add more,
  comma-separated, as you add PCs.

Start it:

```bash
npm start
```

You should see:

```text
Print system backend listening on port 4000
Public base URL: http://localhost:4000
Configured agents: PC-001
```

## 3. Frontend setup

```bash
cd frontend
npm install
cp .env.example .env
```

Edit `frontend/.env` so `VITE_BACKEND_URL` points at the backend from step 2
(same host/port as `PUBLIC_BASE_URL` above).

```bash
npm run dev
```

Open the printed `http://localhost:5173` URL - on a phone on the same
Wi-Fi, use your PC's LAN IP instead, e.g. `http://192.168.1.20:5173`.

## 4. Print Agent setup (on the Windows PC with the printer attached)

```bash
cd print-agent
npm install
cp .env.example .env
```

Edit `print-agent/.env`:

- `BACKEND_URL` - same backend URL as above.
- `PRINT_AGENT_ID` / `PRINT_AGENT_SECRET` - must exactly match one of the
  `agentId:secret` pairs you put in `backend/.env`'s `AGENT_CREDENTIALS`.

### Find your Windows printer name and select it

```bash
npm run setup-printer
```

This lists every printer Windows knows about and lets you pick one by
number. It writes the exact name into `.env`'s `PRINTER_NAME`. You can
re-run this any time, or change the printer later from the local dashboard
(see below) without editing files by hand.

### Start the agent

```bash
node agent.js
```

Expected output:

```text
[11:20:01] Agent started
[11:20:01] Dashboard available at http://localhost:3001
[11:20:05] Checking jobs
```

Open `http://localhost:3001` in a browser on that PC to see the local
dashboard: agent ID, backend connection status, configured printer and
whether it's ready, last job, jobs printed today, and buttons for **Test
Printer**, **Refresh**, and **View Logs**. You can also pick/change the
printer from a dropdown right there instead of using `setup-printer`.

## 5. Perform a test print

1. Make sure backend, frontend, and print agent are all running (steps 2-4).
2. Open the frontend page on your phone (or a desktop browser).
3. Optionally pick a PDF, or leave it blank to use a generated test PDF.
4. Set copies / color if you want, then press **TEST PRINT**.
5. Watch the status flow: Queued → PC Connected / Job Claimed → Printing →
   Completed. On success you'll see **✓ PRINT COMPLETED**; the printer
   should have physically printed a page within a few seconds (the agent
   polls every `POLL_INTERVAL` ms, 5 seconds by default).

If it fails, the page shows the reason (see Troubleshooting below).

---

## How job claiming works (no double-printing)

Every print job moves through: `queued → claimed → printing → completed`
(or `failed`). `GET /api/print-jobs/pending` atomically claims the oldest
queued job for the requesting agent - Node's single-threaded event loop
means two simultaneous polls can never both claim the same job. A job
claimed by one agent will never be handed to another. If an agent crashes
mid-job, the claim automatically expires after `JOB_CLAIM_TIMEOUT_MS`
(default 2 minutes) and the job is requeued.

## Security notes

- The printer and the PC never accept inbound connections; the agent only
  makes outbound HTTPS/HTTP calls to the backend.
- `PRINT_AGENT_SECRET` lives only in `print-agent/.env` and the backend's
  `.env` - never in frontend code, which ships to every visitor's browser.
- Every agent-only endpoint (`/pending`, `/printing`, `/complete`, `/fail`)
  requires the `X-Agent-Id` / `X-Agent-Secret` headers to match a configured
  agent.
- Uploads are restricted to `application/pdf`, capped at `MAX_FILE_SIZE_MB`
  (10 MB by default), and stored with randomly generated filenames.
- `/api` is rate-limited per IP (`RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX`).
- For real deployment, put the backend behind HTTPS (a reverse proxy like
  Caddy/Nginx with a free Let's Encrypt certificate, or a host that
  terminates TLS for you) and set `PUBLIC_BASE_URL`/`VITE_BACKEND_URL` to
  the `https://` URL.

## Troubleshooting

| Message | Meaning | Fix |
|---|---|---|
| `Printer is not available.` | The printer exists but the print command failed | Check it's powered on, has paper, and isn't jammed/offline in Windows |
| `Configured printer was not found.` | `PRINTER_NAME` in `print-agent/.env` doesn't match any installed printer | Run `npm run setup-printer` again, or select one on the dashboard |
| `Cannot connect to cloud backend. Retrying...` | The agent can't reach `BACKEND_URL` | Check the backend is running and the URL/port are correct; check firewall |
| `Unable to download print document.` | The agent couldn't fetch the PDF from `fileUrl` | Check the backend is reachable from the PC and the file wasn't deleted |
| `Print agent authentication failed.` | `PRINT_AGENT_ID`/`PRINT_AGENT_SECRET` don't match the backend's `AGENT_CREDENTIALS` | Make sure both files use the exact same id and secret |
| `This print job has already been claimed.` | Another agent (or a stale request) already owns this job | Expected behavior of the duplicate-print protection - no action needed |

Agent activity is always logged to `print-agent/logs/agent.log` and shown
live in the dashboard's **View Logs** panel.

## Running the Print Agent automatically on Windows startup

For the trial, running `node agent.js` manually is fine. For a PC that
should always be ready to print, use **Task Scheduler** so it starts
without anyone logging in and running a command:

1. Open **Task Scheduler** → **Create Task...** (not "Basic Task", so you
   get the "Run whether user is logged on or not" option).
2. **General** tab: name it e.g. "Print Agent"; check "Run whether user is
   logged on or not"; check "Run with highest privileges".
3. **Triggers** tab → **New...** → "At startup".
4. **Actions** tab → **New...**:
   - Program/script: `node.exe` (or the full path from `where node`)
   - Add arguments: `agent.js`
   - Start in: the full path to the `print-agent` folder, e.g.
     `C:\mobile-print-system\print-agent`
5. **Conditions**/**Settings** tabs: uncheck "Start the task only if the
   computer is on AC power" if this is a desktop.
6. Save (you'll be asked for the Windows account password since it runs
   whether logged in or not).

Test it by rebooting the PC and checking `http://localhost:3001` comes up
on its own, or right-click the task → **Run**.

## Final end-to-end test procedure

1. Start the backend (`npm start` in `backend/`).
2. Start the frontend (`npm run dev` in `frontend/`).
3. Make sure a USB/Wi-Fi printer is connected and installed on the PC.
4. Start the print agent (`node agent.js` in `print-agent/`) - dashboard
   should show "Connected" and the configured printer as "Ready".
5. Open the frontend on a phone.
6. Optionally select a PDF.
7. Press **TEST PRINT**.
8. Backend creates `JOB-XXXX`.
9. The agent claims it within one poll cycle (≤5s).
10. The agent downloads the PDF.
11. The agent sends the real print command to Windows.
12. The printer physically prints the page.
13. The backend job status moves `printing → completed`.
14. The mobile page shows **✓ PRINT COMPLETED**.

## What's next (already designed for, not built in this trial)

- **Multiple PCs/printers**: give each PC its own `agentId` (e.g.
  `PC-AHM-001`, `PC-GNR-001`) and its own line in `AGENT_CREDENTIALS`; the
  job-claiming logic already supports any number of agents polling at once.
- **Swapping the JSON job store for MongoDB/PostgreSQL**: all job
  persistence goes through `backend/src/db/jobStore.js` - only that file's
  internals need to change; `backend/src/routes/printJobs.js` never touches
  storage directly.
- **Restaurant billing integration**: any system that can `POST` a PDF URL
  to `/api/print-jobs` can reuse this exact pipeline for bills, kitchen
  tickets, GST invoices, or thermal receipts - no changes needed on the
  backend or agent side.
