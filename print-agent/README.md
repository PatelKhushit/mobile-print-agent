# Print Agent

Runs on any PC that's on the same local network as one or more printers.
Self-registers with the cloud backend on first run, auto-detects and
registers every installed printer, then polls for jobs. Never accepts
inbound connections - only makes outbound requests to the backend.

See the [project README](../README.md) for the full setup walkthrough. Quick
reference:

```bash
npm install
cp .env.example .env      # set BACKEND_URL and PRINT_AGENT_ID; leave PRINT_AGENT_TOKEN blank
node agent.js              # registers itself, detects printers, starts polling + dashboard
```

Dashboard: http://localhost:3001 (cloud status, detected printers, Test
Print per printer, live logs).

Logs are written to `logs/agent.log` and mirrored in the dashboard.

## How it identifies printers

Every printer Windows reports is auto-registered with a stable ID derived
from `agentId + printer name` (see `printer-discovery.js`'s `printerIdFor`),
so the same printer keeps the same ID across restarts without needing a
local ID file. Nothing to configure by hand - if a new printer gets
installed on this PC, it shows up in the mobile app's printer list within
30 seconds.

## Files

- `agent.js` - orchestrates registration, heartbeat, polling, and job handling.
- `cloud-client.js` - all HTTP calls to the backend.
- `printer-discovery.js` - lists installed Windows printers (via PowerShell + JSON, not pdf-to-printer's own lister - see the comment in that file for why).
- `printer-service.js` + `adapters/` - picks a `PrinterAdapter` (Windows today; an IPP stub is scaffolded for direct network printers later) and sends the file to it.
- `server/dashboard.js` + `public/index.html` - the local status dashboard.

Job lifecycle handled here: `assigned → downloading → printing → completed`
or `failed`, reported back to the backend via a per-agent secret token
issued at registration (never hardcoded).
