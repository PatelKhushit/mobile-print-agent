const express = require('express');
const Printer = require('../models/Printer');
const Agent = require('../models/Agent');
const config = require('../src/config');
const printQueue = require('../services/printQueue');
const { agentAuth, jwtAuth, requireAdmin } = require('../middleware/auth');
const logger = require('../src/utils/logger');

const ONLINE_WINDOW_MS = 90000; // agent heartbeats every ~5s; generous margin

const router = express.Router();

/**
 * POST /api/printers/register
 * An agent declares a printer it can serve (spec section 7). printerId is
 * globally unique - re-registering from a different agent than the one
 * that owns it is rejected rather than silently reassigning someone else's
 * printer.
 */
router.post('/register', agentAuth, async (req, res) => {
  const { printerId, name, location, localPrinterName, capabilities } = req.body || {};
  if (!printerId || !name || !localPrinterName) {
    return res
      .status(400)
      .json({ success: false, error: 'printerId, name, and localPrinterName are required.' });
  }

  const existing = await Printer.findOne({ printerId });
  if (existing && existing.agentId !== req.agentId) {
    return res.status(409).json({ success: false, error: 'printerId is already registered to a different agent.' });
  }

  const printer = await Printer.findOneAndUpdate(
    { printerId },
    {
      printerId,
      name,
      location: location || '',
      agentId: req.agentId,
      localPrinterName,
      status: 'online',
      capabilities: capabilities || {},
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  logger.info(`[printers] ${printer.printerId} registered to ${req.agentId} (${localPrinterName})`);
  res.json({ success: true, printer });
});

async function computeStatus(printer, agentsById) {
  if (printer.status === 'disabled') return 'disabled';
  const agent = agentsById.get(printer.agentId);
  const agentOnline = !!(agent && agent.lastSeenAt && Date.now() - agent.lastSeenAt.getTime() < ONLINE_WINDOW_MS);
  if (!agentOnline) return 'offline';
  if (!agent.printers.includes(printer.localPrinterName)) return 'unavailable';
  return 'online';
}

// GET /api/printers - mobile printer picker
router.get('/', async (req, res) => {
  const printers = await Printer.find({ status: { $ne: 'disabled' } }).lean();
  const agentIds = [...new Set(printers.map((p) => p.agentId))];
  const agents = await Agent.find({ agentId: { $in: agentIds } }).lean();
  const agentsById = new Map(agents.map((a) => [a.agentId, a]));

  const result = await Promise.all(
    printers.map(async (p) => ({
      printerId: p.printerId,
      name: p.name,
      location: p.location,
      agentId: p.agentId,
      status: await computeStatus(p, agentsById),
    }))
  );
  res.json({ success: true, printers: result });
});

// GET /api/printers/:printerId/status
router.get('/:printerId/status', async (req, res) => {
  const printer = await Printer.findOne({ printerId: req.params.printerId }).lean();
  if (!printer) return res.status(404).json({ success: false, error: 'Printer not found.' });
  const agent = await Agent.findOne({ agentId: printer.agentId }).lean();
  const agentsById = new Map(agent ? [[agent.agentId, agent]] : []);
  const status = await computeStatus(printer, agentsById);
  res.json({ success: true, printerId: printer.printerId, status });
});

// GET /api/printers/admin/all - admin panel view, includes disabled printers
router.get('/admin/all', jwtAuth, requireAdmin, async (req, res) => {
  const printers = await Printer.find({}).lean();
  const agentIds = [...new Set(printers.map((p) => p.agentId))];
  const agents = await Agent.find({ agentId: { $in: agentIds } }).lean();
  const agentsById = new Map(agents.map((a) => [a.agentId, a]));

  const result = await Promise.all(
    printers.map(async (p) => ({
      printerId: p.printerId,
      name: p.name,
      location: p.location,
      agentId: p.agentId,
      localPrinterName: p.localPrinterName,
      status: await computeStatus(p, agentsById),
    }))
  );
  res.json({ success: true, printers: result });
});

// PATCH /api/printers/:printerId - rename, relocate, reassign, enable/disable
router.patch('/:printerId', jwtAuth, requireAdmin, async (req, res) => {
  const { name, location, agentId, disabled } = req.body || {};
  const printer = await Printer.findOne({ printerId: req.params.printerId });
  if (!printer) return res.status(404).json({ success: false, error: 'Printer not found.' });

  if (name) printer.name = name;
  if (location !== undefined) printer.location = location;
  if (agentId) printer.agentId = agentId;
  if (disabled !== undefined) printer.status = disabled ? 'disabled' : 'online';
  await printer.save();

  logger.info(`[printers] ${printer.printerId} updated by admin`);
  res.json({ success: true, printer });
});

// DELETE /api/printers/:printerId
router.delete('/:printerId', jwtAuth, requireAdmin, async (req, res) => {
  const result = await Printer.deleteOne({ printerId: req.params.printerId });
  if (result.deletedCount === 0) return res.status(404).json({ success: false, error: 'Printer not found.' });
  logger.info(`[printers] ${req.params.printerId} deleted by admin`);
  res.json({ success: true });
});

// POST /api/printers/:printerId/test-print - real job, real print, from the admin panel
router.post('/:printerId/test-print', jwtAuth, requireAdmin, async (req, res) => {
  const printer = await Printer.findOne({ printerId: req.params.printerId });
  if (!printer) return res.status(404).json({ success: false, error: 'Printer not found.' });

  const job = await printQueue.createJob({
    printerId: printer.printerId,
    fileUrl: `${config.publicBaseUrl}/public/sample-test-page.pdf`,
    copies: 1,
    color: false,
  });
  logger.info(`[printers] Admin test print ${job.jobId} -> ${printer.printerId}`);
  res.status(201).json({ success: true, jobId: job.jobId, status: job.status });
});

module.exports = router;
