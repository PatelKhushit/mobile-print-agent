const mongoose = require('mongoose');

const STATUSES = ['queued', 'assigned', 'downloading', 'printing', 'completed', 'failed', 'cancelled'];

const printJobSchema = new mongoose.Schema(
  {
    jobId: { type: String, required: true, unique: true },
    printerId: { type: String, required: true },
    // Set once a job is assigned - null while queued and eligible for any
    // agent that serves printerId.
    agentId: { type: String, default: null },
    // Who submitted this job - used to authorize cancellation and for the
    // audit log. Null for jobs created outside a user context (e.g. the
    // admin panel's own test-print button).
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    fileUrl: { type: String, required: true },
    fileName: { type: String, default: null },
    fileSize: { type: Number, default: null },
    copies: { type: Number, default: 1, min: 1, max: 50 },
    color: { type: Boolean, default: false },
    paperSize: { type: String, default: 'A4' },
    orientation: { type: String, enum: ['portrait', 'landscape'], default: 'portrait' },
    duplex: { type: Boolean, default: false },
    status: { type: String, enum: STATUSES, default: 'queued' },
    attempts: { type: Number, default: 0 },
    maxRetries: { type: Number, default: 3 },
    // Lets a client safely retry job creation (e.g. after a dropped
    // response) without creating a second physical print - a repeated
    // request with the same key returns the original job.
    //
    // No `default` here on purpose: Mongoose's `default: null` would set
    // this field to null on every document, and a sparse index still
    // treats "present with value null" as present - so two jobs with no
    // idempotencyKey would collide on the unique index. Leaving the field
    // genuinely absent (undefined) when not provided is what makes
    // `sparse` actually exclude them.
    idempotencyKey: { type: String, unique: true, sparse: true },
    error: { type: String, default: null },
    claimedAt: { type: Date, default: null },
    printingAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

printJobSchema.index({ status: 1, printerId: 1, createdAt: 1 });

module.exports = mongoose.model('PrintJob', printJobSchema);
module.exports.STATUSES = STATUSES;
