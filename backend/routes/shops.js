const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
const Shop = require('../models/Shop');
const User = require('../models/User');
const Agent = require('../models/Agent');
const Printer = require('../models/Printer');
const PrintJob = require('../models/PrintJob');
const config = require('../src/config');
const { jwtAuth, requireAdmin, requireShopOwner, customerSessionAuth } = require('../middleware/auth');
const { ONLINE_WINDOW_MS, computeStatus, publicPrinter } = require('../services/printerStatus');
const logger = require('../src/utils/logger');

/** SHOP-001, SHOP-002, ... - human-readable, matches the spec's own examples.
 * Falls back to a random suffix only if the sequential slot is contended. */
async function generateShopId() {
  for (let i = 0; i < 5; i++) {
    const count = await Shop.countDocuments({});
    const candidate = `SHOP-${String(count + 1).padStart(3, '0')}`;
    if (!(await Shop.findOne({ shopId: candidate }))) return candidate;
  }
  return `SHOP-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function publicShop(shop) {
  return {
    shopId: shop.shopId,
    shopName: shop.shopName,
    ownerName: shop.ownerName,
    phone: shop.phone,
    email: shop.email,
    address: shop.address,
    status: shop.status,
    createdAt: shop.createdAt,
  };
}

/** The only place a shop's QR URL is assembled - the frontend route it
 * points to (spec section 6) plus the current rotatable qrToken (never the
 * shopId alone, so regenerating one doesn't require changing the other). */
async function buildQrPayload(shop) {
  const qrUrl = `${config.frontendBaseUrl}/print/shop/${shop.shopId}?t=${shop.qrToken}`;
  const qrDataUrl = await QRCode.toDataURL(qrUrl, { margin: 1, width: 320 });
  return { qrUrl, qrDataUrl };
}

// A shop can have more than one Print Agent (spec section 41: "1 Shop ->
// Agent 1, Agent 2"), so agentsByShop maps to an array, not a single agent.
async function shopSummary(shop, agentsByShop, printersByShop, jobsTodayByShop) {
  const agents = agentsByShop.get(shop.shopId) || [];
  const agentsOnline = agents.filter(
    (a) => a.lastSeenAt && Date.now() - new Date(a.lastSeenAt).getTime() < ONLINE_WINDOW_MS
  ).length;
  const printers = printersByShop.get(shop.shopId) || [];
  const agentsById = new Map(agents.map((a) => [a.agentId, a]));
  const onlinePrinters = await Promise.all(printers.map((p) => computeStatus(p, agentsById)));
  const jobs = jobsTodayByShop.get(shop.shopId) || { total: 0, completed: 0, failed: 0 };

  return {
    ...publicShop(shop),
    agents: { total: agents.length, online: agentsOnline },
    printers: { total: printers.length, online: onlinePrinters.filter((s) => s === 'online').length },
    jobsToday: jobs,
  };
}

// ---------------------------------------------------------------------------
// Super Admin: create/manage shops, regenerate QR (mounted at /api/admin/shops)
// ---------------------------------------------------------------------------
const adminRouter = express.Router();

// POST /api/admin/shops - creates the Shop plus its shop_owner login in one call
adminRouter.post('/', jwtAuth, requireAdmin, async (req, res) => {
  const { shopName, ownerName, phone, email, address, ownerEmail, ownerPassword } = req.body || {};
  if (!shopName || typeof shopName !== 'string') {
    return res.status(400).json({ success: false, error: 'shopName is required.' });
  }
  if (!ownerEmail || !ownerPassword || ownerPassword.length < 8) {
    return res
      .status(400)
      .json({ success: false, error: 'ownerEmail and an ownerPassword (min 8 chars) are required.' });
  }

  const existing = await User.findOne({ email: ownerEmail.toLowerCase() });
  if (existing) {
    return res.status(409).json({ success: false, error: 'An account with this owner email already exists.' });
  }

  const shopId = await generateShopId();
  const passwordHash = await bcrypt.hash(ownerPassword, 10);
  const ownerUser = await User.create({
    email: ownerEmail.toLowerCase(),
    passwordHash,
    name: ownerName || '',
    role: 'shop_owner',
    shopId,
  });
  const shop = await Shop.create({
    shopId,
    shopName,
    ownerUserId: ownerUser._id,
    ownerName: ownerName || '',
    phone: phone || '',
    email: email || ownerEmail.toLowerCase(),
    address: address || '',
  });

  logger.info(`[shops] Created ${shop.shopId} "${shop.shopName}" (owner ${ownerUser.email})`);
  res.status(201).json({ success: true, shop: publicShop(shop) });
});

// GET /api/admin/shops - list every shop with a live agent/printer/jobs-today summary
adminRouter.get('/', jwtAuth, requireAdmin, async (req, res) => {
  const shops = await Shop.find({}).sort({ createdAt: -1 }).lean();
  const shopIds = shops.map((s) => s.shopId);

  const [agents, printers, jobs] = await Promise.all([
    Agent.find({ shopId: { $in: shopIds } }).lean(),
    Printer.find({ shopId: { $in: shopIds } }).lean(),
    PrintJob.find({ shopId: { $in: shopIds }, createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) } }).lean(),
  ]);

  const agentsByShop = new Map();
  for (const a of agents) {
    if (!agentsByShop.has(a.shopId)) agentsByShop.set(a.shopId, []);
    agentsByShop.get(a.shopId).push(a);
  }
  const printersByShop = new Map();
  for (const p of printers) {
    if (!printersByShop.has(p.shopId)) printersByShop.set(p.shopId, []);
    printersByShop.get(p.shopId).push(p);
  }
  const jobsTodayByShop = new Map();
  for (const j of jobs) {
    const bucket = jobsTodayByShop.get(j.shopId) || { total: 0, completed: 0, failed: 0 };
    bucket.total += 1;
    if (j.status === 'completed') bucket.completed += 1;
    if (j.status === 'failed') bucket.failed += 1;
    jobsTodayByShop.set(j.shopId, bucket);
  }

  const result = await Promise.all(shops.map((s) => shopSummary(s, agentsByShop, printersByShop, jobsTodayByShop)));
  res.json({ success: true, shops: result });
});

// PATCH /api/admin/shops/:shopId - edit details, suspend/reactivate
adminRouter.patch('/:shopId', jwtAuth, requireAdmin, async (req, res) => {
  const { shopName, ownerName, phone, email, address, status } = req.body || {};
  const shop = await Shop.findOne({ shopId: req.params.shopId });
  if (!shop) return res.status(404).json({ success: false, error: 'Shop not found.' });

  if (shopName) shop.shopName = shopName;
  if (ownerName !== undefined) shop.ownerName = ownerName;
  if (phone !== undefined) shop.phone = phone;
  if (email !== undefined) shop.email = email;
  if (address !== undefined) shop.address = address;
  if (status && ['active', 'suspended'].includes(status)) shop.status = status;
  await shop.save();

  logger.info(`[shops] ${shop.shopId} updated by admin (status=${shop.status})`);
  res.json({ success: true, shop: publicShop(shop) });
});

// POST /api/admin/shops/:shopId/qr/regenerate - rotates qrToken only (spec section 44:
// old printed QR stops working, shopId and everything owned by it is untouched)
adminRouter.post('/:shopId/qr/regenerate', jwtAuth, requireAdmin, async (req, res) => {
  const shop = await Shop.findOne({ shopId: req.params.shopId });
  if (!shop) return res.status(404).json({ success: false, error: 'Shop not found.' });

  shop.qrToken = Shop.generateQrToken();
  await shop.save();
  logger.info(`[shops] QR regenerated for ${shop.shopId}`);
  const { qrUrl, qrDataUrl } = await buildQrPayload(shop);
  res.json({ success: true, qrUrl, qrDataUrl });
});

// ---------------------------------------------------------------------------
// Public / customer QR flow (mounted at /api/shops)
// ---------------------------------------------------------------------------
const publicRouter = express.Router();

// GET /api/shops/:shopId/public?t=<qrToken> - what the QR landing page shows
// before a session exists. Deliberately minimal: no printer list, no owner
// info, nothing that isn't needed to render "Welcome to <Shop Name>" (spec section 8).
publicRouter.get('/:shopId/public', async (req, res) => {
  const shop = await Shop.findOne({ shopId: req.params.shopId }).lean();
  if (!shop || shop.qrToken !== req.query.t) {
    return res.status(404).json({ success: false, error: 'Shop not found, or this QR code is no longer valid.' });
  }
  if (shop.status !== 'active') {
    return res.status(403).json({ success: false, error: 'This shop is not currently accepting print jobs.' });
  }
  res.json({ success: true, shopId: shop.shopId, shopName: shop.shopName });
});

// POST /api/shops/:shopId/session - exchanges a valid QR token for a short-lived
// guest print session (spec section 72/74: no customer registration required)
publicRouter.post('/:shopId/session', async (req, res) => {
  const { t } = req.body || {};
  const shop = await Shop.findOne({ shopId: req.params.shopId }).lean();
  if (!shop || shop.qrToken !== t) {
    return res.status(404).json({ success: false, error: 'Shop not found, or this QR code is no longer valid.' });
  }
  if (shop.status !== 'active') {
    return res.status(403).json({ success: false, error: 'This shop is not currently accepting print jobs.' });
  }

  const sid = crypto.randomBytes(12).toString('hex');
  const expiresIn = 2 * 60 * 60; // 2h - long enough for one visit, short enough to not be a standing credential
  const token = jwt.sign({ type: 'customer', shopId: shop.shopId, sid }, process.env.JWT_SECRET, { expiresIn });

  logger.info(`[shops] Customer session issued for ${shop.shopId}`);
  res.json({ success: true, token, shopName: shop.shopName, expiresIn });
});

// GET /api/shops/:shopId/printers - shop-scoped printer picker, only reachable
// with a session already issued for THIS shop (spec section 30/45 isolation)
publicRouter.get('/:shopId/printers', customerSessionAuth, async (req, res) => {
  if (req.customerSession.shopId !== req.params.shopId) {
    return res.status(403).json({ success: false, error: 'This print session is not valid for this shop.' });
  }

  const printers = await Printer.find({ shopId: req.params.shopId, status: { $ne: 'disabled' } }).lean();
  const agents = await Agent.find({ agentId: { $in: [...new Set(printers.map((p) => p.agentId))] } }).lean();
  const agentsById = new Map(agents.map((a) => [a.agentId, a]));
  const result = await Promise.all(printers.map(async (p) => publicPrinter(p, await computeStatus(p, agentsById))));
  res.json({ success: true, printers: result });
});

// ---------------------------------------------------------------------------
// Shop owner self-service (mounted at /api/shop) - every query below is
// scoped to req.user.shopId, never a value the client can supply.
// ---------------------------------------------------------------------------
const ownerRouter = express.Router();

ownerRouter.get('/me', jwtAuth, requireShopOwner, async (req, res) => {
  const shop = await Shop.findOne({ shopId: req.user.shopId }).lean();
  if (!shop) return res.status(404).json({ success: false, error: 'Shop not found.' });
  const { qrUrl, qrDataUrl } = await buildQrPayload(shop);
  res.json({ success: true, shop: publicShop(shop), qrUrl, qrDataUrl });
});

ownerRouter.get('/printers', jwtAuth, requireShopOwner, async (req, res) => {
  const printers = await Printer.find({ shopId: req.user.shopId }).lean();
  const agents = await Agent.find({ agentId: { $in: [...new Set(printers.map((p) => p.agentId))] } }).lean();
  const agentsById = new Map(agents.map((a) => [a.agentId, a]));
  const result = await Promise.all(
    printers.map(async (p) => ({
      ...publicPrinter(p, await computeStatus(p, agentsById)),
      localPrinterName: p.localPrinterName,
    }))
  );
  res.json({ success: true, printers: result });
});

// POST /api/shop/agent/pairing-code - generates a fresh single-use code
// (spec section 45), replacing any code this shop previously generated.
// The plaintext code is only ever shown here - the agent redeems and
// invalidates it via POST /api/agents/register.
const PAIRING_CODE_TTL_MS = 15 * 60 * 1000;
ownerRouter.post('/agent/pairing-code', jwtAuth, requireShopOwner, async (req, res) => {
  const shop = await Shop.findOne({ shopId: req.user.shopId });
  if (!shop) return res.status(404).json({ success: false, error: 'Shop not found.' });

  shop.pairingCode = Shop.generatePairingCode();
  shop.pairingCodeExpiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS);
  await shop.save();

  logger.info(`[shops] Pairing code generated for ${shop.shopId}`);
  res.json({ success: true, pairingCode: shop.pairingCode, expiresAt: shop.pairingCodeExpiresAt });
});

// GET /api/shop/agents - every Print Agent paired to this shop (spec
// section 41: a shop isn't limited to exactly one agent).
ownerRouter.get('/agents', jwtAuth, requireShopOwner, async (req, res) => {
  const agents = await Agent.find({ shopId: req.user.shopId }).sort({ createdAt: 1 }).lean();
  const result = agents.map((agent) => {
    const online = !!(agent.lastSeenAt && Date.now() - new Date(agent.lastSeenAt).getTime() < ONLINE_WINDOW_MS);
    return {
      agentId: agent.agentId,
      status: online ? 'online' : 'offline',
      lastSeenAt: agent.lastSeenAt,
      printers: agent.printers,
      version: agent.version,
    };
  });
  res.json({ success: true, agents: result });
});

ownerRouter.get('/jobs', jwtAuth, requireShopOwner, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const jobs = await PrintJob.find({ shopId: req.user.shopId }).sort({ createdAt: -1 }).limit(limit).lean();
  res.json({ success: true, jobs });
});

module.exports = { adminRouter, publicRouter, ownerRouter };
