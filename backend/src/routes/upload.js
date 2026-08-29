const express = require('express');
const multer = require('multer');
const config = require('../config');
const logger = require('../utils/logger');
const { jwtAuth } = require('../../middleware/auth');
const storage = require('../../services/storage');

const router = express.Router();

function fileFilter(req, file, cb) {
  if (file.mimetype !== 'application/pdf') {
    return cb(new Error('INVALID_FILE_TYPE'));
  }
  cb(null, true);
}

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: config.maxFileSizeMb * 1024 * 1024 },
});

router.post('/', jwtAuth, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      if (err.message === 'INVALID_FILE_TYPE') {
        return res.status(400).json({ success: false, error: 'Only PDF files are allowed.' });
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
      const { fileId, size } = await storage.storeFile(req.file.buffer, req.file.originalname, 'application/pdf');
      const fileUrl = storage.buildSignedUrl(config.publicBaseUrl, fileId);
      logger.info(`[upload] Stored ${fileId} (${size} bytes)`);
      res.json({ success: true, fileUrl, fileName: req.file.originalname, fileSize: size });
    } catch (storeErr) {
      logger.error('[upload] Failed to store file:', storeErr.message);
      res.status(500).json({ success: false, error: 'Upload failed.' });
    }
  });
});

module.exports = router;
