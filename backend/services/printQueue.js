const crypto = require('crypto');
const PrintJob = require('../models/PrintJob');
const storage = require('./storage');
const config = require('../src/config');
const logger = require('../src/utils/logger');

/** Best-effort delete of a job's uploaded document once it reaches a
 * terminal state (spec section 47) - never lets a storage error affect
 * the job status transition itself. No-ops for non-GridFS URLs (the
 * shared sample test-print PDF, or any external fileUrl). */
async function cleanupJobFile(job) {
  const fileId = storage.extractFileId(job.fileUrl, config.publicBaseUrl);
  if (!fileId) return;
  try {
    await storage.deleteFile(fileId);
  } catch (err) {
    logger.warn(`[printQueue] Could not delete stored file for ${job.jobId}: ${err.message}`);
  }
}

function generateJobId() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `JOB-${date}-${suffix}`;
}

/**
 * Creates a job, or - if idempotencyKey is given and was already used -
 * returns the original job instead of creating a duplicate (spec section
 * 13: a retried create request must never produce a second physical
 * print). The unique+sparse index on idempotencyKey makes this safe even
 * under concurrent duplicate requests: only one insert wins, the loser
 * re-reads the winner.
 */
async function createJob({
  printerId,
  fileUrl,
  fileName,
  fileSize,
  copies,
  color,
  paperSize,
  orientation,
  duplex,
  userId,
  shopId,
  customerSessionId,
  idempotencyKey,
}) {
  if (idempotencyKey) {
    const existing = await PrintJob.findOne({ idempotencyKey });
    if (existing) return existing;
  }

  const job = new PrintJob({
    jobId: generateJobId(),
    printerId,
    fileUrl,
    fileName: fileName || null,
    fileSize: fileSize || null,
    copies: copies || 1,
    color: !!color,
    paperSize: paperSize || 'A4',
    orientation: orientation || 'portrait',
    duplex: !!duplex,
    userId: userId || null,
    shopId: shopId || null,
    customerSessionId: customerSessionId || null,
    // Omit entirely rather than passing null - see the schema comment on
    // why that matters for the sparse unique index.
    ...(idempotencyKey ? { idempotencyKey } : {}),
  });

  try {
    await job.save();
    return job;
  } catch (err) {
    if (err.code === 11000 && idempotencyKey) {
      // Lost the race to another request with the same idempotency key.
      return PrintJob.findOne({ idempotencyKey });
    }
    throw err;
  }
}

function getJob(jobId) {
  return PrintJob.findOne({ jobId }).lean();
}

/**
 * Requeues jobs stuck in an in-flight state past the claim timeout (agent
 * crashed mid-job). Jobs that have already exhausted their retry budget
 * are marked permanently failed instead of being requeued forever (spec
 * section 23: "Never retry indefinitely").
 *
 * Jobs already in "printing" are the one exception: at that point the
 * agent has handed the document to the Windows print subsystem, so if it
 * then goes silent we can no longer tell whether the page actually came
 * out. Requeuing would risk printing it a second time - a real physical
 * duplicate, not just a retried API call - so those are marked failed
 * instead, never silently retried (spec section 24: duplicate print
 * protection must hold across an agent crash/restart).
 */
async function releaseExpiredClaims(claimTimeoutMs) {
  const cutoff = new Date(Date.now() - claimTimeoutMs);
  const stuck = await PrintJob.find({
    status: { $in: ['assigned', 'downloading', 'printing'] },
    claimedAt: { $lt: cutoff },
  });

  for (const job of stuck) {
    if (job.status === 'printing') {
      job.status = 'failed';
      job.error = 'Print agent went silent while this job was printing - outcome could not be confirmed, so it was not retried automatically to avoid a duplicate physical print. Check the printer and reprint manually if needed.';
      job.completedAt = new Date();
      logger.warn(`[printQueue] ${job.jobId} failed without retry - was mid-print when its claim expired`);
    } else if (job.attempts >= job.maxRetries) {
      job.status = 'failed';
      job.error = 'Exceeded retry limit after repeated timeouts.';
      job.completedAt = new Date();
      logger.warn(`[printQueue] ${job.jobId} permanently failed (retry limit exceeded)`);
    } else {
      job.status = 'queued';
      job.agentId = null;
      job.claimedAt = null;
      logger.warn(`[printQueue] Releasing expired claim on ${job.jobId} (attempt ${job.attempts})`);
    }
    await job.save();
  }
}

/**
 * Atomically claims the oldest queued job for one of the given printerIds.
 * findOneAndUpdate is atomic in MongoDB, so this is race-safe even across
 * multiple backend instances - a real improvement over the single-process
 * in-memory version this replaced.
 */
async function claimNextPendingJob(agentId, printerIds, claimTimeoutMs) {
  await releaseExpiredClaims(claimTimeoutMs);
  if (!printerIds.length) return null;

  return PrintJob.findOneAndUpdate(
    { status: 'queued', printerId: { $in: printerIds } },
    { $set: { status: 'assigned', agentId, claimedAt: new Date() }, $inc: { attempts: 1 } },
    { sort: { createdAt: 1 }, new: true }
  );
}

async function transition(jobId, agentId, { from, to, extraFields = {} }) {
  const job = await PrintJob.findOne({ jobId });
  if (!job) return { error: 'not_found' };
  if (job.agentId !== agentId) return { error: 'not_owner', job };
  if (!from.includes(job.status)) return { error: 'invalid_state', job };
  job.status = to;
  Object.assign(job, extraFields);
  await job.save();
  return { job };
}

const markDownloading = (jobId, agentId) =>
  transition(jobId, agentId, { from: ['assigned'], to: 'downloading' });

const markPrinting = (jobId, agentId) =>
  transition(jobId, agentId, { from: ['assigned', 'downloading'], to: 'printing', extraFields: { printingAt: new Date() } });

async function markCompleted(jobId, agentId) {
  const result = await transition(jobId, agentId, {
    from: ['assigned', 'downloading', 'printing'],
    to: 'completed',
    extraFields: { completedAt: new Date() },
  });
  if (result.job && result.job.status === 'completed') await cleanupJobFile(result.job);
  return result;
}

/** Fails permanently, or requeues for another attempt if retries remain. */
async function markFailed(jobId, agentId, errorMessage) {
  const job = await PrintJob.findOne({ jobId });
  if (!job) return { error: 'not_found' };
  if (job.agentId !== agentId) return { error: 'not_owner', job };
  if (!['assigned', 'downloading', 'printing'].includes(job.status)) return { error: 'invalid_state', job };

  job.error = errorMessage || 'Unknown error';
  if (job.attempts < job.maxRetries) {
    job.status = 'queued';
    job.agentId = null;
    job.claimedAt = null;
  } else {
    job.status = 'failed';
    job.completedAt = new Date();
  }
  await job.save();
  if (job.status === 'failed') await cleanupJobFile(job);
  return { job };
}

/**
 * Cancels a job the requester owns (or any job, if the requester is an
 * admin) - but only while it's still safe to do so. Once an agent has
 * told us it's actively printing, cancelling is refused rather than
 * pretending to stop a page that may already be coming out of the
 * printer (spec: never fake a result). "Owns" covers either a logged-in
 * user's own jobs or a customer session's own guest-submitted job.
 */
async function cancelJob(jobId, { requesterUserId, requesterSessionId, isAdmin } = {}) {
  const job = await PrintJob.findOne({ jobId });
  if (!job) return { error: 'not_found' };
  const ownsAsUser = requesterUserId && job.userId && job.userId.toString() === requesterUserId;
  const ownsAsCustomer =
    requesterSessionId && job.customerSessionId && job.customerSessionId === requesterSessionId;
  if (!isAdmin && !ownsAsUser && !ownsAsCustomer) {
    return { error: 'forbidden' };
  }
  if (!['queued', 'assigned', 'downloading'].includes(job.status)) {
    return { error: 'invalid_state', job };
  }
  job.status = 'cancelled';
  job.completedAt = new Date();
  await job.save();
  await cleanupJobFile(job);
  return { job };
}

module.exports = {
  createJob,
  getJob,
  claimNextPendingJob,
  markDownloading,
  markPrinting,
  markCompleted,
  markFailed,
  cancelJob,
};
