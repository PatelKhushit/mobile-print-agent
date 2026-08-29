const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const config = require('../config');
const logger = require('../utils/logger');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const unique = crypto.randomBytes(8).toString('hex');
    cb(null, `${Date.now()}-${unique}.pdf`);
  },
});

function fileFilter(req, file, cb) {
  if (file.mimetype !== 'application/pdf') {
    return cb(new Error('INVALID_FILE_TYPE'));
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: config.maxFileSizeMb * 1024 * 1024 },
});

router.post('/', (req, res) => {
  upload.single('file')(req, res, (err) => {
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
    const fileUrl = `${config.publicBaseUrl}/uploads/${req.file.filename}`;
    logger.info(`[upload] Stored ${req.file.filename} (${req.file.size} bytes)`);
    res.json({
      success: true,
      fileUrl,
      fileName: req.file.originalname,
      fileSize: req.file.size,
    });
  });
});

module.exports = router;
