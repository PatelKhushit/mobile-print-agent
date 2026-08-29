const mongoose = require('mongoose');
const crypto = require('crypto');
const { Readable } = require('stream');

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h - long enough to cover retry/backoff windows

function getBucket() {
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'uploads' });
}

/** Stores a buffer in MongoDB GridFS (no separate object-storage account
 * needed - PDFs are capped at MAX_FILE_SIZE_MB, well within GridFS/Atlas
 * free-tier limits). */
function storeFile(buffer, filename, contentType) {
  const bucket = getBucket();
  return new Promise((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(filename, { contentType });
    Readable.from(buffer)
      .pipe(uploadStream)
      .on('error', reject)
      .on('finish', () => resolve({ fileId: uploadStream.id.toString(), size: buffer.length }));
  });
}

function openDownloadStream(fileId) {
  const bucket = getBucket();
  return bucket.openDownloadStream(new mongoose.Types.ObjectId(fileId));
}

function sign(fileId, exp) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET).update(`${fileId}.${exp}`).digest('hex');
}

/** Builds a time-limited download link - the file itself is never public. */
function buildSignedUrl(baseUrl, fileId, ttlMs = DEFAULT_TTL_MS) {
  const exp = Date.now() + ttlMs;
  const sig = sign(fileId, exp);
  return `${baseUrl}/api/files/${fileId}?exp=${exp}&sig=${sig}`;
}

function verifySignature(fileId, exp, sig) {
  if (!exp || !sig) return false;
  if (Date.now() > Number(exp)) return false;
  const expected = sign(fileId, String(exp));
  const a = Buffer.from(expected);
  const b = Buffer.from(String(sig));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { storeFile, openDownloadStream, buildSignedUrl, verifySignature };
