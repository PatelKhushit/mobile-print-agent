const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String, default: '' },
    // 'admin' = platform super admin (unchanged). 'shop_owner' = manages
    // exactly one shop, identified by shopId below. 'user' = legacy
    // personal-use account from before multi-shop existed - unaffected.
    role: { type: String, enum: ['admin', 'user', 'shop_owner'], default: 'user' },
    // Only set (and meaningful) when role === 'shop_owner'.
    shopId: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
