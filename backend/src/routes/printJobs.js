const express = require('express');
const axios = require('axios');
const config = require('../config');
const agentAuth = require('../middleware/agentAuth');
const logger = require('../utils/logger');

function parseAgentPrinters(header) {
  if (!header) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(header));
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

function buildRouter(jobStore, agentRegistry) {
  const router = express.Router();

  // POST /api/print-jobs - mobile creates a print job
  router.post('/', async (req, res) => {
    const { fileUrl, copies, color, printerId } = req.body || {};

    if (!fileUrl || typeof fileUrl !== 'string' || !/^https?:\/\//i.test(fileUrl)) {
      return res.status(400).json({ success: false, error: 'A valid fileUrl (http/https) is required.' });
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

    const job = jobStore.createJob({
      fileUrl,
      copies: copiesNum,
      color: !!color,
      printerId: printerId || 'DEFAULT',
    });

    logger.info(`[print-jobs] Created ${job.jobId} (printerId=${job.printerId}, copies=${job.copies})`);
    res.status(201).json({ success: true, jobId: job.jobId, status: job.status });
  });

  // GET /api/print-jobs/pending - Local Print Agent polls for work
  router.get('/pending', agentAuth, (req, res) => {
    const agentPrinters = parseAgentPrinters(req.header('X-Agent-Printers'));
    agentRegistry.heartbeat(req.agentId, agentPrinters);

    const job = jobStore.claimNextPendingJob(req.agentId, config.jobClaimTimeoutMs, agentPrinters);
    if (!job) {
      return res.json({ job: null });
    }
    logger.info(`[print-jobs] ${job.jobId} claimed by ${req.agentId}`);
    res.json({
      job: {
        jobId: job.jobId,
        fileUrl: job.fileUrl,
        copies: job.copies,
        color: job.color,
        printerId: job.printerId,
      },
    });
  });

  // GET /api/print-jobs/:jobId - mobile polls status
  router.get('/:jobId', (req, res) => {
    const job = jobStore.getJob(req.params.jobId);
    if (!job) return res.status(404).json({ success: false, error: 'Job not found.' });
    res.json({ success: true, job });
  });

  // POST /api/print-jobs/:jobId/printing - agent marks job as actively printing
  router.post('/:jobId/printing', agentAuth, (req, res) => {
    const result = jobStore.markPrinting(req.params.jobId, req.agentId);
    if (result.error === 'not_found') return res.status(404).json({ success: false, error: 'Job not found.' });
    if (result.error === 'not_owner') {
      return res.status(409).json({ success: false, error: 'This print job has already been claimed.' });
    }
    if (result.error === 'invalid_state') {
      return res.status(409).json({ success: false, error: `Job is in state "${result.job.status}".` });
    }
    res.json({ success: true, jobId: result.job.jobId, status: result.job.status });
  });

  // POST /api/print-jobs/:jobId/complete
  router.post('/:jobId/complete', agentAuth, (req, res) => {
    const result = jobStore.markCompleted(req.params.jobId, req.agentId);
    if (result.error === 'not_found') return res.status(404).json({ success: false, error: 'Job not found.' });
    if (result.error === 'not_owner') {
      return res.status(409).json({ success: false, error: 'This print job has already been claimed.' });
    }
    if (result.error === 'invalid_state') {
      return res.status(409).json({ success: false, error: `Job is in state "${result.job.status}".` });
    }
    logger.info(`[print-jobs] ${result.job.jobId} completed by ${req.agentId}`);
    res.json({ success: true, jobId: result.job.jobId, status: result.job.status });
  });

  // POST /api/print-jobs/:jobId/fail
  router.post('/:jobId/fail', agentAuth, (req, res) => {
    const { error } = req.body || {};
    const result = jobStore.markFailed(req.params.jobId, req.agentId, error);
    if (result.error === 'not_found') return res.status(404).json({ success: false, error: 'Job not found.' });
    if (result.error === 'not_owner') {
      return res.status(409).json({ success: false, error: 'This print job has already been claimed.' });
    }
    if (result.error === 'invalid_state') {
      return res.status(409).json({ success: false, error: `Job is in state "${result.job.status}".` });
    }
    logger.warn(`[print-jobs] ${result.job.jobId} failed: ${error}`);
    res.json({ success: true, jobId: result.job.jobId, status: result.job.status });
  });

  return router;
}

module.exports = buildRouter;
