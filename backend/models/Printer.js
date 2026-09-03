const mongoose = require('mongoose');

const printerSchema = new mongoose.Schema(
  {
    printerId: { type: String, required: true, unique: true },
    // Denormalized from the owning agent's shopId at register/sync time
    // (routes/printers.js) so shop-scoped queries never need a join, and so
    // multi-shop isolation (spec section 45) is a single filter, not a
    // lookup. null = legacy standalone printer, not part of any shop.
    shopId: { type: String, default: null },
    name: { type: String, required: true },
    brand: { type: String, default: 'Unknown' },
    model: { type: String, default: 'Unknown' },
    location: { type: String, default: '' },
    agentId: { type: String, required: true },
    // Exact OS-level printer name the agent should pass to its print
    // command - never assumed, always explicit (spec section 16: "Do NOT
    // assume the printer name").
    localPrinterName: { type: String, required: true },
    // How the agent talks to this device. "windows" = OS print subsystem
    // (driver-based, works for USB/LPT/virtual printers). "ipp"/"ipps" =
    // direct network protocol, no driver install needed. Selecting the
    // wrong adapter for a printer is a real failure, not a fallback - see
    // printer-service.js on the agent.
    protocol: { type: String, enum: ['windows', 'ipp', 'ipps'], default: 'windows' },
    // Only set for network printers (protocol ipp/ipps) - the agent needs
    // this to reach the device directly, independent of localPrinterName.
    address: { type: String, default: null },
    status: { type: String, enum: ['online', 'offline', 'disabled'], default: 'offline' },
    // Updated on every agent sync - independent of Agent.lastSeenAt, which
    // only tells us the agent process is alive, not that this specific
    // printer was still present in its most recent discovery scan.
    lastSeenAt: { type: Date, default: null },
    capabilities: {
      color: { type: Boolean, default: false },
      duplex: { type: Boolean, default: false },
      paperSizes: { type: [String], default: [] },
      resolution: { type: String, default: '' },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Printer', printerSchema);
