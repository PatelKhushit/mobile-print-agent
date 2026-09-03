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

/** Gate for shop-owner endpoints. Must run after jwtAuth. */
function requireShopOwner(req, res, next) {
  if (!req.user || req.user.role !== 'shop_owner' || !req.user.shopId) {
    return res.status(403).json({ success: false, error: 'Shop owner access required.' });
  }
  next();
}

/**
 * Verifies a customer's short-lived guest session, issued by
 * POST /api/shops/:shopId/session after a QR scan (spec section 72). Same
 * jwt.verify() mechanism as jwtAuth, but a distinctly-shaped, short-expiry
 * payload so a customer token can never be mistaken for (or reused as) a
 * mobile-user login token.
 */
function customerSessionAuth(req, res, next) {
  const header = req.header('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ success: false, error: 'Print session required - please scan the shop QR code again.' });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.type !== 'customer' || !payload.shopId || !payload.sid) {
      throw new Error('not a customer session token');
    }
    req.customerSession = payload;
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Print session expired - please scan the shop QR code again.' });
  }
}

/**
 * Accepts either a logged-in user (mobile JWT) or a QR customer session,
 * normalizing both into req.actor so routes shared between the legacy
 * personal-print flow and the new shop QR flow (e.g. print job creation)
 * don't need two copies of the same handler.
 */
function eitherAuth(req, res, next) {
  const header = req.header('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ success: false, error: 'Authentication required.' });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.type === 'customer' && payload.shopId && payload.sid) {
      req.customerSession = payload;
      req.actor = { type: 'customer', shopId: payload.shopId, userId: null };
    } else {
      req.user = payload;
      req.actor = { type: 'user', shopId: payload.shopId || null, userId: payload.sub };
    }
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Invalid or expired session.' });
  }
}

module.exports = { agentAuth, jwtAuth, requireAdmin, requireShopOwner, customerSessionAuth, eitherAuth };
