const mongoose = require('mongoose');

const agentSchema = new mongoose.Schema(
  {
    agentId: { type: String, required: true, unique: true },
    name: { type: String, default: '' },
    // Never store the plaintext token - only its hash, so a DB leak alone
    // can't be used to impersonate an agent.
    tokenHash: { type: String, required: true },
    status: { type: String, enum: ['online', 'offline'], default: 'offline' },
    lastSeenAt: { type: Date, default: null },
    version: { type: String, default: '' },
    // Printer names this agent currently reports as installed, refreshed on
    // every heartbeat - lets the backend route jobs to the right agent.
    printers: { type: [String], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Agent', agentSchema);
