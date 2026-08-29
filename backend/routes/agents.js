const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const Agent = require('../models/Agent');
const Printer = require('../models/Printer');
const { agentAuth, jwtAuth, requireAdmin } = require('../middleware/auth');
const logger = require('../src/utils/logger');

const router = express.Router();

/**
 * POST /api/agents/register
 * A Print Agent's first-run flow (spec section 8): pick an agentId, call
 * this once, and it gets back a secret token to store locally. Calling it
 * again for an existing agentId rotates the token (old one stops working
 * immediately) - useful if a PC is being re-provisioned or a token leaked.
 * The plaintext token is only ever shown in this response, never stored.
 */
router.post('/register', async (req, res) => {
  const { agentId, name } = req.body || {};
  if (!agentId || typeof agentId !== 'string') {
    return res.status(400).json({ success: false, error: 'agentId is required.' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = await bcrypt.hash(token, 10);

  const agent = await Agent.findOneAndUpdate(
    { agentId },
    { agentId, name: name || agentId, tokenHash, status: 'offline' },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  logger.info(`[agents] Registered ${agent.agentId} (token rotated)`);
  res.json({ success: true, agentId: agent.agentId, token });
});

/**
 * POST /api/agents/heartbeat
 * Called once per poll cycle before checking for jobs (spec section 14,
 * step 6: "Report printer status"). Updates presence + the printer list
 * this agent can currently serve, used to route jobs and populate the
 * mobile printer picker.
 */
router.post('/heartbeat', agentAuth, async (req, res) => {
  const { printers, version } = req.body || {};
  req.agent.status = 'online';
  req.agent.lastSeenAt = new Date();
  req.agent.printers = Array.isArray(printers) ? printers : [];
  if (version) req.agent.version = version;
  await req.agent.save();
  res.json({ success: true });
});

// GET /api/agents/:agentId/printers - admin view of everything one agent owns
router.get('/:agentId/printers', jwtAuth, requireAdmin, async (req, res) => {
  const printers = await Printer.find({ agentId: req.params.agentId }).lean();
  res.json({ success: true, printers });
});

module.exports = router;
