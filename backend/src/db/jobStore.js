const fs = require('fs');
const path = require('path');
const { generateJobId } = require('../utils/jobId');
const logger = require('../utils/logger');

const ALLOWED_STATUSES = ['queued', 'claimed', 'printing', 'completed', 'failed', 'cancelled'];

/**
 * JSON-file backed job repository.
 *
 * All mutating methods below are synchronous end-to-end (no `await` between
 * the read-check and the write). Node's single-threaded event loop means an
 * incoming HTTP request can never interleave in the middle of one of these
 * functions, so claimNextPendingJob() is safe against two agents racing for
 * the same job without needing DB transactions.
 *
 * This class is the only thing that knows jobs currently live in a JSON
 * file. Swapping to MongoDB/PostgreSQL later means reimplementing this
 * class's methods against a real DB driver - routes never touch the file.
 */
class JobStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.jobs = new Map();
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const arr = JSON.parse(raw || '[]');
        arr.forEach((job) => this.jobs.set(job.jobId, job));
        logger.info(`[jobStore] Loaded ${this.jobs.size} job(s) from ${this.filePath}`);
      }
    } catch (err) {
      logger.error('[jobStore] Failed to load jobs file, starting empty:', err.message);
    }
  }

  _persist() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const arr = Array.from(this.jobs.values());
      fs.writeFileSync(this.filePath, JSON.stringify(arr, null, 2));
    } catch (err) {
      logger.error('[jobStore] Failed to persist jobs file:', err.message);
    }
  }

  createJob({ fileUrl, fileName, fileSize, copies, color, printerId }) {
    const jobId = generateJobId();
    const now = new Date().toISOString();
    const job = {
      jobId,
      fileUrl,
      fileName: fileName || null,
      fileSize: fileSize || null,
      copies: copies || 1,
      color: !!color,
      printerId: printerId || 'DEFAULT',
      status: 'queued',
      createdAt: now,
      claimedAt: null,
      printingAt: null,
      completedAt: null,
      agentId: null,
      error: null,
    };
    this.jobs.set(jobId, job);
    this._persist();
    return job;
  }

  getJob(jobId) {
    return this.jobs.get(jobId) || null;
  }

  listJobs() {
    return Array.from(this.jobs.values()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  /**
   * Requeues jobs stuck in claimed/printing past the claim timeout, in case
   * an agent crashed mid-job. Called before every claim attempt.
   */
  _releaseExpiredClaims(timeoutMs) {
    const now = Date.now();
    let releasedAny = false;
    for (const job of this.jobs.values()) {
      if (job.status !== 'claimed' && job.status !== 'printing') continue;
      const claimedAt = job.claimedAt ? new Date(job.claimedAt).getTime() : 0;
      if (now - claimedAt > timeoutMs) {
        logger.warn(`[jobStore] Releasing expired claim on ${job.jobId} (was held by ${job.agentId})`);
        job.status = 'queued';
        job.agentId = null;
        job.claimedAt = null;
        job.printingAt = null;
        releasedAny = true;
      }
    }
    if (releasedAny) this._persist();
  }

  /**
   * Atomically finds the oldest queued job this agent is eligible to print
   * (job.printerId is "DEFAULT", or is one of the printer names this agent
   * currently reports) and marks it claimed by agentId. Returns null if
   * there is nothing eligible to claim.
   */
  claimNextPendingJob(agentId, claimTimeoutMs, agentPrinters = []) {
    this._releaseExpiredClaims(claimTimeoutMs);

    let oldest = null;
    for (const job of this.jobs.values()) {
      if (job.status !== 'queued') continue;
      const eligible = job.printerId === 'DEFAULT' || agentPrinters.includes(job.printerId);
      if (!eligible) continue;
      if (!oldest || job.createdAt < oldest.createdAt) oldest = job;
    }
    if (!oldest) return null;

    oldest.status = 'claimed';
    oldest.agentId = agentId;
    oldest.claimedAt = new Date().toISOString();
    this._persist();
    return oldest;
  }

  /** Marks a claimed job as printing. Only the owning agent may do this. */
  markPrinting(jobId, agentId) {
    const job = this.jobs.get(jobId);
    if (!job) return { error: 'not_found' };
    if (job.agentId !== agentId) return { error: 'not_owner', job };
    if (job.status !== 'claimed') return { error: 'invalid_state', job };
    job.status = 'printing';
    job.printingAt = new Date().toISOString();
    this._persist();
    return { job };
  }

  markCompleted(jobId, agentId) {
    const job = this.jobs.get(jobId);
    if (!job) return { error: 'not_found' };
    if (job.agentId !== agentId) return { error: 'not_owner', job };
    if (!['claimed', 'printing'].includes(job.status)) return { error: 'invalid_state', job };
    job.status = 'completed';
    job.completedAt = new Date().toISOString();
    this._persist();
    return { job };
  }

  markFailed(jobId, agentId, errorMessage) {
    const job = this.jobs.get(jobId);
    if (!job) return { error: 'not_found' };
    if (job.agentId !== agentId) return { error: 'not_owner', job };
    if (!['claimed', 'printing'].includes(job.status)) return { error: 'invalid_state', job };
    job.status = 'failed';
    job.error = errorMessage || 'Unknown error';
    job.completedAt = new Date().toISOString();
    this._persist();
    return { job };
  }
}

module.exports = { JobStore, ALLOWED_STATUSES };
