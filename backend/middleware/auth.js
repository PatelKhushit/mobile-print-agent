const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Agent = require('../models/Agent');
const logger = require('../src/utils/logger');

/**
 * Verifies the Local Print Agent making the request against its registered,
 * hashed token (see routes/agents.js for issuance). Replaces the old
 * static-secret-in-.env scheme with a real per-agent credential the backend
 * can revoke by clearing tokenHash.
 */
async function agentAuth(req, res, next) {
  const agentId = req.header('X-Agent-Id');
  const agentSecret = req.header('X-Agent-Secret');

  if (!agentId || !agentSecret) {
    return res.status(401).json({ success: false, error: 'Print agent authentication failed.' });
  }

  try {
    const agent = await Agent.findOne({ agentId });
    if (!agent) {
      return res.status(401).json({ success: false, error: 'Print agent authentication failed.' });
    }
    const valid = await bcrypt.compare(agentSecret, agent.tokenHash);
    if (!valid) {
      logger.warn(`[auth] Rejected agent auth attempt for agentId=${agentId}`);
      return res.status(401).json({ success: false, error: 'Print agent authentication failed.' });
    }
    req.agentId = agentId;
    req.agent = agent;
    next();
  } catch (err) {
    logger.error(`[auth] Agent auth error: ${err.message}`);
    res.status(500).json({ success: false, error: 'Internal server error.' });
  }
}

/** Verifies a mobile user's JWT (see routes/auth.js for issuance). */
function jwtAuth(req, res, next) {
  const header = req.header('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ success: false, error: 'Authentication required.' });
  }
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Invalid or expired token.' });
  }
}

/** Gate for admin-only endpoints. Must run after jwtAuth. */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required.' });
  }
  next();
}

module.exports = { agentAuth, jwtAuth, requireAdmin };
