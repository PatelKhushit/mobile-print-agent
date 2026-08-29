const ONLINE_WINDOW_MS = 90000; // agent polls every 5s by default; generous margin

/**
 * Tracks which printers each connected agent currently reports (refreshed
 * on every /pending poll via the X-Agent-Printers header). In-memory only -
 * this is live presence, not data that needs to survive a restart.
 */
class AgentRegistry {
  constructor() {
    this.agents = new Map(); // agentId -> { printers: string[], lastSeenAt: number }
  }

  heartbeat(agentId, printers) {
    this.agents.set(agentId, {
      printers: Array.isArray(printers) ? printers : [],
      lastSeenAt: Date.now(),
    });
  }

  /** Printers currently reported by a specific agent (used for job-claim eligibility). */
  getPrinters(agentId) {
    const entry = this.agents.get(agentId);
    return entry ? entry.printers : [];
  }

  /** Flattened {agentId, printerName} list across all agents seen recently. */
  listOnlinePrinters() {
    const now = Date.now();
    const result = [];
    for (const [agentId, entry] of this.agents.entries()) {
      if (now - entry.lastSeenAt > ONLINE_WINDOW_MS) continue;
      entry.printers.forEach((printerName) => result.push({ agentId, printerName }));
    }
    return result;
  }
}

module.exports = { AgentRegistry };
