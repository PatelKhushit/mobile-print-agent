const express = require('express');
const storage = require('../services/storage');
const logger = require('../src/utils/logger');

const router = express.Router();

/**
 * GET /api/files/:fileId?exp=...&sig=...
 * Signed, time-limited download for uploaded PDFs (spec section 19/20) -
 * the file itself is never a public URL. Only the Print Agent (and
 * whoever created the job) ever sees a valid link, and it stops working
 * once exp passes.
 */
router.get('/:fileId', (req, res) => {
  const { exp, sig } = req.query;
  if (!storage.verifySignature(req.params.fileId, exp, sig)) {
    return res.status(403).json({ success: false, error: 'Invalid or expired download link.' });
  }

  let stream;
  try {
    stream = storage.openDownloadStream(req.params.fileId);
  } catch {
    return res.status(404).json({ success: false, error: 'File not found.' });
  }

  res.setHeader('Content-Type', 'application/pdf');
  stream.on('error', (err) => {
    logger.warn(`[files] Download failed for ${req.params.fileId}: ${err.message}`);
    if (!res.headersSent) res.status(404).json({ success: false, error: 'File not found.' });
  });
  stream.pipe(res);
});

module.exports = router;
