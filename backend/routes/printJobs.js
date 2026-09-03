const express = require('express');
const axios = require('axios');
const config = require('../src/config');
const Printer = require('../models/Printer');
const PrintJob = require('../models/PrintJob');
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');
const printQueue = require('../services/printQueue');
const { agentAuth, jwtAuth, requireAdmin, eitherAuth } = require('../middleware/auth');
const logger = require('../src/utils/logger');

const router = express.Router();

// GET /api/print-jobs/admin/audit-log - who printed what, where, and when
router.get('/admin/audit-log', jwtAuth, requireAdmin, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const entries = await AuditLog.find({}).sort({ createdAt: -1 }).limit(limit).lean();
  res.json({ success: true, entries });
});

// POST /api/print-jobs - creates a print job. Accepts either a logged-in
// mobile user (legacy personal flow, unrestricted, exactly as before) or a
// QR customer session (spec section 35) - eitherAuth normalizes both into
// req.actor.
router.post('/', eitherAuth, async (req, res) => {
  const { printerId, fileUrl, copies, color, paperSize, orientation, duplex, idempotencyKey } = req.body || {};

  if (!fileUrl || typeof fileUrl !== 'string' || !/^https?:\/\//i.test(fileUrl)) {
    return res.status(400).json({ success: false, error: 'A valid fileUrl (http/https) is required.' });
  }
  if (!printerId || typeof printerId !== 'string') {
    return res.status(400).json({ success: false, error: 'printerId is required.' });
  }

  const printer = await Printer.findOne({ printerId });
  if (!printer || printer.status === 'disabled') {
    return res.status(404).json({ success: false, error: 'Printer not found.' });
  }

  // Mandatory isolation (spec section 45): a customer session may only ever
  // submit to the shop it scanned into, checked here server-side regardless
  // of what printerId the client sends - never trust the frontend for this.
  if (req.actor.type === 'customer' && printer.shopId !== req.actor.shopId) {
    return res.status(403).json({ success: false, error: 'This printer does not belong to your shop session.' });
  }

  let copiesNum = parseInt(copies, 10);
  if (!Number.isFinite(copiesNum) || copiesNum < 1) copiesNum = 1;
  if (copiesNum > 50) copiesNum = 50;

  // Best-effort validation that the file is actually a reachable PDF.
  // Never blocks job creation - the agent will surface a real download
  // error later if the URL turns out to be bad.
  if (!fileUrl.startsWith(config.publicBaseUrl)) {
    try {
      const head = await axios.head(fileUrl, { timeout: 4000 });
      const contentType = head.headers['content-type'] || '';
      if (contentType && !contentType.includes('application/pdf')) {
        logger.warn(`[print-jobs] fileUrl content-type is "${contentType}", expected application/pdf`);
      }
    } catch (err) {
      logger.warn(`[print-jobs] Could not verify fileUrl reachability: ${err.message}`);
    }
  }

  const job = await printQueue.createJob({
    printerId,
    fileUrl,
    copies: copiesNum,
    color: !!color,
    paperSize,
    orientation,
    duplex: !!duplex,
    userId: req.actor.type === 'user' ? req.actor.userId : null,
    shopId: printer.shopId || null,
    customerSessionId: req.actor.type === 'customer' ? req.customerSession.sid : null,
    idempotencyKey: idempotencyKey || null,
  });

  logger.info(`[print-jobs] Created ${job.jobId} (printerId=${job.printerId}, copies=${job.copies})`);
  res.status(201).json({ success: true, jobId: job.jobId, status: job.status });
});

// GET /api/print-jobs/pending - Local Print Agent polls for work
router.get('/pending', agentAuth, async (req, res) => {
  const printers = await Printer.find({ agentId: req.agentId, status: { $ne: 'disabled' } }).lean();
  const printerIds = printers.map((p) => p.printerId);

  const job = await printQueue.claimNextPendingJob(req.agentId, printerIds, config.jobClaimTimeoutMs);
  if (!job) {
    return res.json({ job: null });
  }

  const printer = printers.find((p) => p.printerId === job.printerId);
  logger.info(`[print-jobs] ${job.jobId} claimed by ${req.agentId}`);
  res.json({
    job: {
      jobId: job.jobId,
      fileUrl: job.fileUrl,
      copies: job.copies,
      color: job.color,
      paperSize: job.paperSize,
      orientation: job.orientation,
      duplex: job.duplex,
      printerId: job.printerId,
      localPrinterName: printer ? printer.localPrinterName : null,
      protocol: printer ? printer.protocol : 'windows',
      address: printer ? printer.address : null,
    },
  });
});

// POST /api/print-jobs/:jobId/claim - explicit idempotent claim (spec section 34)
router.post('/:jobId/claim', agentAuth, async (req, res) => {
  const job = await PrintJob.findOne({ jobId: req.params.jobId });
  if (!job) return res.status(404).json({ success: false, error: 'Job not found.' });

  if (job.agentId === req.agentId && ['assigned', 'downloading', 'printing'].includes(job.status)) {
    return res.json({ success: true, jobId: job.jobId, status: job.status }); // already ours
  }
  if (job.status !== 'queued') {
    return res.status(409).json({ success: false, error: 'This print job has already been claimed.' });
  }

  job.status = 'assigned';
  job.agentId = req.agentId;
  job.claimedAt = new Date();
  job.attempts += 1;
  await job.save();
  res.json({ success: true, jobId: job.jobId, status: job.status });
});

// POST /api/print-jobs/:jobId/cancel - the submitter (logged-in user or the
// customer session that created it) cancels their own job, or an admin cancels any
router.post('/:jobId/cancel', eitherAuth, async (req, res) => {
  const result = await printQueue.cancelJob(req.params.jobId, {
    requesterUserId: req.actor.type === 'user' ? req.actor.userId : null,
    requesterSessionId: req.actor.type === 'customer' ? req.customerSession.sid : null,
    isAdmin: req.actor.type === 'user' && req.user.role === 'admin',
  });
  if (result.error === 'not_found') return res.status(404).json({ success: false, error: 'Job not found.' });
  if (result.error === 'forbidden') {
    return res.status(403).json({ success: false, error: 'You can only cancel your own print jobs.' });
  }
  if (result.error === 'invalid_state') {
    return res
      .status(409)
      .json({ success: false, error: `Cannot cancel - job is already "${result.job.status}".` });
  }

  const printer = await Printer.findOne({ printerId: result.job.printerId }).lean();
  const cancelledBy = req.actor.type === 'user' ? req.user.email : 'customer session';
  await AuditLog.create({
    jobId: result.job.jobId,
    userId: result.job.userId,
    userEmail: req.actor.type === 'user' ? req.user.email : null,
    printerId: result.job.printerId,
    printerName: printer ? printer.name : result.job.printerId,
    agentId: result.job.agentId,
    copies: result.job.copies,
    status: 'cancelled',
  });

  logger.info(`[print-jobs] ${result.job.jobId} cancelled by ${cancelledBy}`);
  res.json({ success: true, jobId: result.job.jobId, status: result.job.status });
});

// GET /api/print-jobs/:jobId - mobile polls status
router.get('/:jobId', async (req, res) => {
  const job = await printQueue.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ success: false, error: 'Job not found.' });
  res.json({ success: true, job });
});

function handleTransitionResult(res, result) {
  if (result.error === 'not_found') return res.status(404).json({ success: false, error: 'Job not found.' });
  if (result.error === 'not_owner') {
    return res.status(409).json({ success: false, error: 'This print job has already been claimed.' });
  }
  if (result.error === 'invalid_state') {
    return res.status(409).json({ success: false, error: `Job is in state "${result.job.status}".` });
  }
  res.json({ success: true, jobId: result.job.jobId, status: result.job.status });
}

router.post('/:jobId/downloading', agentAuth, async (req, res) => {
  handleTransitionResult(res, await printQueue.markDownloading(req.params.jobId, req.agentId));
});

router.post('/:jobId/printing', agentAuth, async (req, res) => {
  handleTransitionResult(res, await printQueue.markPrinting(req.params.jobId, req.agentId));
});

async function writeAuditEntry(job, status, error) {
  const printer = await Printer.findOne({ printerId: job.printerId }).lean();
  const user = job.userId ? await User.findById(job.userId).lean() : null;
  await AuditLog.create({
    jobId: job.jobId,
    userId: job.userId,
    userEmail: user ? user.email : null,
    printerId: job.printerId,
    printerName: printer ? printer.name : job.printerId,
    agentId: job.agentId,
    copies: job.copies,
    status,
    error: error || null,
  });
}

router.post('/:jobId/complete', agentAuth, async (req, res) => {
  const result = await printQueue.markCompleted(req.params.jobId, req.agentId);
  if (result.job && result.job.status === 'completed') {
    logger.info(`[print-jobs] ${result.job.jobId} completed by ${req.agentId}`);
    await writeAuditEntry(result.job, 'completed');
  }
  handleTransitionResult(res, result);
});

router.post('/:jobId/fail', agentAuth, async (req, res) => {
  const { error } = req.body || {};
  const result = await printQueue.markFailed(req.params.jobId, req.agentId, error);
  if (result.job) {
    logger.warn(`[print-jobs] ${result.job.jobId} ${result.job.status} (attempt ${result.job.attempts}): ${error}`);
    if (result.job.status === 'failed') {
      await writeAuditEntry(result.job, 'failed', error);
    }
  }
  handleTransitionResult(res, result);
});

module.exports = router;
