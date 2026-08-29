const mongoose = require('mongoose');

const printerSchema = new mongoose.Schema(
  {
    printerId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    location: { type: String, default: '' },
    agentId: { type: String, required: true },
    // Exact OS-level printer name the agent should pass to its print
    // command - never assumed, always explicit (spec section 16: "Do NOT
    // assume the printer name").
    localPrinterName: { type: String, required: true },
    status: { type: String, enum: ['online', 'offline', 'disabled'], default: 'offline' },
    capabilities: {
      color: { type: Boolean, default: false },
      duplex: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Printer', printerSchema);
