const config = require('../config');
const logger = require('../utils/logger');

/**
 * Verifies the Local Print Agent making the request. The agent sends its
 * id/secret on every request; nothing about a printer or job is ever
 * reachable without this pair matching a configured agent.
 */
function agentAuth(req, res, next) {
  const agentId = req.header('X-Agent-Id');
  const agentSecret = req.header('X-Agent-Secret');

  if (!agentId || !agentSecret) {
    return res.status(401).json({ success: false, error: 'Print agent authentication failed.' });
  }

  const expectedSecret = config.agentCredentials.get(agentId);
  if (!expectedSecret || expectedSecret !== agentSecret) {
    logger.warn(`[auth] Rejected agent auth attempt for agentId=${agentId}`);
    return res.status(401).json({ success: false, error: 'Print agent authentication failed.' });
  }

  req.agentId = agentId;
  next();
}

module.exports = agentAuth;
