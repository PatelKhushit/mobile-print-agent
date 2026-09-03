const ONLINE_WINDOW_MS = 90000; // agent heartbeats every ~5s; generous margin

/**
 * Shared by both the legacy global printer list (routes/printers.js) and
 * the shop-scoped printer list (routes/shops.js) so "online" means exactly
 * the same thing - and gets fixed in exactly one place - everywhere it's
 * computed: the owning agent must be alive AND that agent's last discovery
 * scan must still include this printer (spec section 20: never fabricate a
 * status neither of those actually confirms).
 */
function computeStatus(printer, agentsById) {
  if (printer.status === 'disabled') return 'disabled';
  const agent = agentsById.get(printer.agentId);
  const agentOnline = !!(agent && agent.lastSeenAt && Date.now() - agent.lastSeenAt.getTime() < ONLINE_WINDOW_MS);
  if (!agentOnline) return 'offline';
  if (!agent.printers.includes(printer.localPrinterName)) return 'unavailable';
  return 'online';
}

function publicPrinter(p, status) {
  return {
    printerId: p.printerId,
    name: p.name,
    brand: p.brand,
    model: p.model,
    location: p.location,
    agentId: p.agentId,
    protocol: p.protocol,
    capabilities: p.capabilities,
    status,
  };
}

module.exports = { ONLINE_WINDOW_MS, computeStatus, publicPrinter };
