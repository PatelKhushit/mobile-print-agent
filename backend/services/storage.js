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

/** Deletes a stored upload. Safe to call on an already-deleted/unknown
 * fileId - GridFSBucket.delete rejects in that case, which callers treat
 * as a non-fatal no-op (spec section 47: cleanup must never block a job's
 * own status transition). */
async function deleteFile(fileId) {
  const bucket = getBucket();
  await bucket.delete(new mongoose.Types.ObjectId(fileId));
}

/** Extracts the GridFS fileId from a URL previously built by
 * buildSignedUrl, or null if this isn't one of our own signed file links
 * (e.g. the static /public/sample-test-page.pdf used for test prints) -
 * only our own uploads are ever eligible for cleanup. */
function extractFileId(fileUrl, baseUrl) {
  if (!fileUrl || !fileUrl.startsWith(`${baseUrl}/api/files/`)) return null;
  const rest = fileUrl.slice(`${baseUrl}/api/files/`.length);
  const id = rest.split('?')[0];
  return /^[0-9a-fA-F]{24}$/.test(id) ? id : null;
}

/**
 * Safety-net sweep for uploads that never reached a clean terminal-state
 * deletion (e.g. a job that was created but never claimed). Deletes any
 * GridFS upload older than the configured retention window, independent
 * of print job state (spec section 22/47: "configurable retention
 * period", not "keep forever by default").
 */
async function pruneOrphanedFiles(retentionMs) {
  const bucket = getBucket();
  const cutoff = new Date(Date.now() - retentionMs);
  const old = await mongoose.connection.db
    .collection('uploads.files')
    .find({ uploadDate: { $lt: cutoff } }, { projection: { _id: 1 } })
    .toArray();
  let deleted = 0;
  for (const doc of old) {
    try {
      await bucket.delete(doc._id);
      deleted += 1;
    } catch {
      // Already gone (e.g. deleted on job completion moments earlier) - fine.
    }
  }
  return deleted;
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

module.exports = {
  storeFile,
  openDownloadStream,
  deleteFile,
  extractFileId,
  buildSignedUrl,
  verifySignature,
  pruneOrphanedFiles,
};
