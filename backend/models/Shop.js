const mongoose = require('mongoose');
const crypto = require('crypto');

function generateQrToken() {
  return crypto.randomBytes(16).toString('hex');
}

/** Short, easy-to-type-on-a-Windows-console pairing code (spec section 45)
 * - e.g. "K7M-492-XQ2". Excludes visually ambiguous characters (0/O, 1/I). */
const PAIRING_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generatePairingCode() {
  const part = () =>
    Array.from({ length: 3 }, () => PAIRING_CHARS[crypto.randomInt(PAIRING_CHARS.length)]).join('');
  return `${part()}-${part()}-${part()}`;
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
    // Single active, single-use, short-lived code a shop owner hands to a
    // new Print Agent instead of copying the raw shopId by hand (spec
    // section 45). Cleared as soon as an agent redeems it or it expires.
    pairingCode: { type: String, default: null },
    pairingCodeExpiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Shop', shopSchema);
module.exports.generateQrToken = generateQrToken;
module.exports.generatePairingCode = generatePairingCode;
