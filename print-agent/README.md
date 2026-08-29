# Local Print Agent

Runs on the Windows PC that has the printer attached. Polls the cloud
backend every `POLL_INTERVAL` ms for print jobs, downloads the PDF, and
prints it. Never accepts inbound connections - only makes outbound requests
to the backend.

See the [project README](../README.md) for the full setup walkthrough. Quick
reference:

```bash
npm install
cp .env.example .env      # then fill in BACKEND_URL / PRINT_AGENT_ID / PRINT_AGENT_SECRET
npm run setup-printer     # lists installed printers, saves your choice to .env
node agent.js             # starts polling + the local dashboard
```

Dashboard: http://localhost:3001 (agent status, printer picker, Test
Printer button, live logs).

Logs are written to `logs/agent.log` and mirrored in the dashboard.

Job lifecycle handled here: `claimed → printing → completed` or `failed`,
reported back to the backend via `X-Agent-Id` / `X-Agent-Secret` authenticated
requests so a job can never be claimed by more than one agent.
