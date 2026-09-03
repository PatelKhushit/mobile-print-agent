const mongoose = require('mongoose');
const crypto = require('crypto');

function generateQrToken() {
  return crypto.randomBytes(16).toString('hex');
}

const shopSchema = new mongoose.Schema(
  {
    shopId: { type: String, required: true, unique: true },
    shopName: { type: String, required: true },
    ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    ownerName: { type: String, default: '' },
    phone: { type: String, default: '' },
    email: { type: String, default: '' },
    address: { type: String, default: '' },
    // Separate from shopId on purpose: regenerating the QR (spec section 44)
    // must invalidate old printed QR codes without changing the shopId that
    // agents/printers/dashboards/URLs are keyed on.
    qrToken: { type: String, required: true, default: generateQrToken },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Shop', shopSchema);
module.exports.generateQrToken = generateQrToken;
