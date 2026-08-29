const express = require('express');
const axios = require('axios');
const config = require('../src/config');
const Printer = require('../models/Printer');
const PrintJob = require('../models/PrintJob');
const printQueue = require('../services/printQueue');
const { agentAuth, jwtAuth } = require('../middleware/auth');
const logger = require('../src/utils/logger');

const router = express.Router();

// POST /api/print-jobs - mobile creates a print job (requires login)
router.post('/', jwtAuth, async (req, res) => {
  const { printerId, fileUrl, copies, color, idempotencyKey } = req.body || {};

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
      printerId: job.printerId,
      localPrinterName: printer ? printer.localPrinterName : null,
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

router.post('/:jobId/complete', agentAuth, async (req, res) => {
  const result = await printQueue.markCompleted(req.params.jobId, req.agentId);
  if (result.job && result.job.status === 'completed') {
    logger.info(`[print-jobs] ${result.job.jobId} completed by ${req.agentId}`);
  }
  handleTransitionResult(res, result);
});

router.post('/:jobId/fail', agentAuth, async (req, res) => {
  const { error } = req.body || {};
  const result = await printQueue.markFailed(req.params.jobId, req.agentId, error);
  if (result.job) {
    logger.warn(`[print-jobs] ${result.job.jobId} ${result.job.status} (attempt ${result.job.attempts}): ${error}`);
  }
  handleTransitionResult(res, result);
});

module.exports = router;
