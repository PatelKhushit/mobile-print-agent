const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    jobId: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    userEmail: { type: String, default: null },
    printerId: { type: String, required: true },
    printerName: { type: String, default: '' },
    agentId: { type: String, default: null },
    copies: { type: Number, default: 1 },
    status: { type: String, required: true }, // 'completed' | 'failed' | 'cancelled'
    error: { type: String, default: null },
  },
  { timestamps: true }
);

auditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
