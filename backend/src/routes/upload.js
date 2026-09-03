const express = require('express');
const multer = require('multer');
const { PDFDocument } = require('pdf-lib');
const config = require('../config');
const logger = require('../utils/logger');
const { jwtAuth } = require('../../middleware/auth');
const storage = require('../../services/storage');

const router = express.Router();

const ACCEPTED_MIMETYPES = ['application/pdf', 'image/jpeg', 'image/png'];

function fileFilter(req, file, cb) {
  if (!ACCEPTED_MIMETYPES.includes(file.mimetype)) {
    return cb(new Error('INVALID_FILE_TYPE'));
  }
  cb(null, true);
}

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: config.maxFileSizeMb * 1024 * 1024 },
});

const A4 = { width: 595.28, height: 841.89 };
const PAGE_MARGIN = 36; // 0.5in - keeps the image off the printable-area edge

/**
 * Wraps a single JPG/PNG in a one-page PDF (spec section 13: images are a
 * supported upload type, but the whole rest of the system - the agent's
 * SumatraPDF print path, page-count/preview, "Pages: N" in the print
 * summary - only ever needs to understand PDF). Converting once at upload
 * time means nothing downstream has to special-case images.
 */
async function imageToPdf(buffer, mimetype) {
  const pdf = await PDFDocument.create();
  const image = mimetype === 'image/png' ? await pdf.embedPng(buffer) : await pdf.embedJpg(buffer);
  const isLandscape = image.width > image.height;
  const page = pdf.addPage(isLandscape ? [A4.height, A4.width] : [A4.width, A4.height]);
  const { width: pageWidth, height: pageHeight } = page.getSize();

  const maxWidth = pageWidth - PAGE_MARGIN * 2;
  const maxHeight = pageHeight - PAGE_MARGIN * 2;
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;

  page.drawImage(image, {
    x: (pageWidth - drawWidth) / 2,
    y: (pageHeight - drawHeight) / 2,
    width: drawWidth,
    height: drawHeight,
  });

  return Buffer.from(await pdf.save());
}

router.post('/', jwtAuth, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      if (err.message === 'INVALID_FILE_TYPE') {
        return res.status(400).json({ success: false, error: 'Only PDF, JPG, or PNG files are allowed.' });
      }
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res
          .status(400)
          .json({ success: false, error: `File exceeds maximum size of ${config.maxFileSizeMb} MB.` });
      }
      logger.error('[upload] Upload failed:', err.message);
      return res.status(400).json({ success: false, error: 'Upload failed.' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file provided.' });
    }

    try {
      let pdfBuffer = req.file.buffer;
      if (req.file.mimetype !== 'application/pdf') {
        try {
          pdfBuffer = await imageToPdf(req.file.buffer, req.file.mimetype);
        } catch (convertErr) {
          logger.error('[upload] Image conversion failed:', convertErr.message);
          return res.status(400).json({ success: false, error: 'This image could not be processed.' });
        }
      }

      // Never trust the client-supplied Content-Type alone (spec section
      // 14/37) - actually parse the PDF so a corrupted or mislabeled file
      // is rejected here instead of failing silently later at the printer.
      // Also gives us an authoritative page count for the print summary/
      // preview (spec section 15/17) with no extra client-side parsing.
      let pageCount;
      try {
        const parsed = await PDFDocument.load(pdfBuffer);
        pageCount = parsed.getPageCount();
      } catch (parseErr) {
        logger.warn('[upload] Rejected unparseable PDF:', parseErr.message);
        return res.status(400).json({ success: false, error: 'This document could not be processed.' });
      }

      const { fileId, size } = await storage.storeFile(pdfBuffer, req.file.originalname, 'application/pdf');
      const fileUrl = storage.buildSignedUrl(config.publicBaseUrl, fileId);
      logger.info(`[upload] Stored ${fileId} (${size} bytes, ${pageCount} page(s))`);
      res.json({ success: true, fileUrl, fileName: req.file.originalname, fileSize: size, pageCount });
    } catch (storeErr) {
      logger.error('[upload] Failed to store file:', storeErr.message);
      res.status(500).json({ success: false, error: 'Upload failed.' });
    }
  });
});

module.exports = router;
