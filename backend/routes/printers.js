const express = require('express');
const Printer = require('../models/Printer');
const Agent = require('../models/Agent');
const config = require('../src/config');
const printQueue = require('../services/printQueue');
const { agentAuth, jwtAuth, requireAdmin } = require('../middleware/auth');
const logger = require('../src/utils/logger');
const { computeStatus, publicPrinter } = require('../services/printerStatus');

const SUPPORTED_PROTOCOLS = ['windows', 'ipp', 'ipps'];

const router = express.Router();

/**
 * POST /api/printers/register
 * An agent declares a printer it can serve (spec section 7). printerId is
 * globally unique - re-registering from a different agent than the one
 * that owns it is rejected rather than silently reassigning someone else's
 * printer. protocol defaults to "windows" (driver-based) since that's what
 * every USB/LPT/virtual printer needs; agents that discover real network
 * printers pass "ipp"/"ipps" explicitly along with an address.
 */
router.post('/register', agentAuth, async (req, res) => {
  const { printerId, name, brand, model, location, localPrinterName, protocol, address, capabilities } =
    req.body || {};
  if (!printerId || !name || !localPrinterName) {
    return res
      .status(400)
      .json({ success: false, error: 'printerId, name, and localPrinterName are required.' });
  }
  if (protocol && !SUPPORTED_PROTOCOLS.includes(protocol)) {
    return res.status(400).json({ success: false, error: `Unsupported protocol "${protocol}".` });
  }

  const existing = await Printer.findOne({ printerId });
  if (existing && existing.agentId !== req.agentId) {
    return res.status(409).json({ success: false, error: 'printerId is already registered to a different agent.' });
  }

  // name/location are admin-owned once a printer exists (spec section 32:
  // a custom display name must survive the agent's periodic re-sync) - set
  // only on first insert via $setOnInsert, never overwritten on repeat syncs.
  // status works the same way once a printer has been explicitly marked
  // "disabled" (admin) or made unavailable (shop owner - see PATCH
  // /api/shop/printers/:printerId): that's a deliberate override, not a
  // liveness signal, so a routine re-sync must never silently clear it.
  const statusUpdate = existing && existing.status === 'disabled' ? {} : { status: 'online' };

  const printer = await Printer.findOneAndUpdate(
    { printerId },
    {
      $set: {
        brand: brand || 'Unknown',
        model: model || 'Unknown',
        agentId: req.agentId,
        // Denormalized from the agent, not the request body - a printer can
        // never claim a shop the agent itself isn't paired with.
        shopId: req.agent.shopId || null,
        localPrinterName,
        protocol: protocol || 'windows',
        address: address || null,
        ...statusUpdate,
        capabilities: capabilities || {},
        lastSeenAt: new Date(),
      },
      $setOnInsert: { printerId, name, location: location || '' },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  logger.info(`[printers] ${printer.printerId} registered to ${req.agentId} (${localPrinterName}, ${printer.protocol})`);
  res.json({ success: true, printer });
});

/**
 * POST /api/printers/sync
 * Bulk version of /register (spec section 7/10): the agent sends its whole
 * discovered printer list in one call each periodic sync instead of one
 * HTTP round-trip per printer. Same upsert semantics as /register - name/
 * location are admin-owned and never overwritten after first insert.
 */
router.post('/sync', agentAuth, async (req, res) => {
  const { printers } = req.body || {};
  if (!Array.isArray(printers)) {
    return res.status(400).json({ success: false, error: 'printers must be an array.' });
  }

  const results = [];
  for (const p of printers) {
    const { printerId, name, brand, model, localPrinterName, protocol, address, capabilities } = p || {};
    if (!printerId || !name || !localPrinterName) continue;
    if (protocol && !SUPPORTED_PROTOCOLS.includes(protocol)) continue;

    const existing = await Printer.findOne({ printerId });
    if (existing && existing.agentId !== req.agentId) continue; // owned by another agent, skip rather than hijack

    // See the matching comment in /register - "disabled" is a deliberate
    // override and must survive routine re-syncs, not get reset to online
    // every ~30s just because the agent still sees the printer in Windows.
    const statusUpdate = existing && existing.status === 'disabled' ? {} : { status: 'online' };

    const printer = await Printer.findOneAndUpdate(
      { printerId },
      {
        $set: {
          brand: brand || 'Unknown',
          model: model || 'Unknown',
          agentId: req.agentId,
          shopId: req.agent.shopId || null,
          localPrinterName,
          protocol: protocol || 'windows',
          address: address || null,
          ...statusUpdate,
          capabilities: capabilities || {},
          lastSeenAt: new Date(),
        },
        $setOnInsert: { printerId, name, location: '' },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    results.push(printer.printerId);
  }

  logger.info(`[printers] Synced ${results.length} printer(s) for ${req.agentId}`);
  res.json({ success: true, synced: results });
});

// GET /api/printers - mobile printer picker (legacy, standalone printers only)
router.get('/', async (req, res) => {
  const printers = await Printer.find({ status: { $ne: 'disabled' }, shopId: null }).lean();
  const agentIds = [...new Set(printers.map((p) => p.agentId))];
  const agents = await Agent.find({ agentId: { $in: agentIds } }).lean();
  const agentsById = new Map(agents.map((a) => [a.agentId, a]));

  const result = await Promise.all(printers.map(async (p) => publicPrinter(p, await computeStatus(p, agentsById))));
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

// GET /api/printers/:printerId/capabilities
router.get('/:printerId/capabilities', async (req, res) => {
  const printer = await Printer.findOne({ printerId: req.params.printerId }).lean();
  if (!printer) return res.status(404).json({ success: false, error: 'Printer not found.' });
  res.json({
    success: true,
    printerId: printer.printerId,
    protocol: printer.protocol,
    capabilities: printer.capabilities,
  });
});

// GET /api/printers/admin/all - admin panel view, includes disabled printers
router.get('/admin/all', jwtAuth, requireAdmin, async (req, res) => {
  const printers = await Printer.find({}).lean();
  const agentIds = [...new Set(printers.map((p) => p.agentId))];
  const agents = await Agent.find({ agentId: { $in: agentIds } }).lean();
  const agentsById = new Map(agents.map((a) => [a.agentId, a]));

  const result = await Promise.all(
    printers.map(async (p) => ({
      ...publicPrinter(p, await computeStatus(p, agentsById)),
      shopId: p.shopId,
      localPrinterName: p.localPrinterName,
      address: p.address,
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

// POST /api/printers/:printerId/test-print - real job, real print, from the
// admin panel or a shop owner's own dashboard (never someone else's shop).
router.post('/:printerId/test-print', jwtAuth, async (req, res) => {
  const printer = await Printer.findOne({ printerId: req.params.printerId });
  if (!printer) return res.status(404).json({ success: false, error: 'Printer not found.' });

  const isOwnShopPrinter = req.user.role === 'shop_owner' && printer.shopId && printer.shopId === req.user.shopId;
  if (req.user.role !== 'admin' && !isOwnShopPrinter) {
    return res.status(403).json({ success: false, error: 'You can only test-print your own shop\'s printers.' });
  }

  const job = await printQueue.createJob({
    printerId: printer.printerId,
    fileUrl: `${config.publicBaseUrl}/public/sample-test-page.pdf`,
    copies: 1,
    color: false,
    userId: req.user.sub,
  });
  logger.info(`[printers] Admin test print ${job.jobId} -> ${printer.printerId}`);
  res.status(201).json({ success: true, jobId: job.jobId, status: job.status });
});

module.exports = router;
