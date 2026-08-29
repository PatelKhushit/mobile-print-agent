const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { jwtAuth } = require('../middleware/auth');

const router = express.Router();

function issueToken(user) {
  return jwt.sign({ sub: user._id.toString(), email: user.email, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });
}

function publicUser(user) {
  return { email: user.email, name: user.name, role: user.role };
}

/**
 * POST /api/auth/register
 * Trial-phase convenience for creating mobile users. The very first
 * account ever created becomes admin (bootstraps the admin panel without
 * a separate seed script); every account after that is a regular user. In
 * a real production rollout this endpoint should be removed or locked
 * down (invite-only, admin-created accounts) rather than left open.
 */
router.post('/register', async (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password || password.length < 8) {
    return res.status(400).json({ success: false, error: 'email and a password (min 8 chars) are required.' });
  }

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    return res.status(409).json({ success: false, error: 'An account with this email already exists.' });
  }

  const isFirstUser = (await User.countDocuments({})) === 0;
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({
    email: email.toLowerCase(),
    passwordHash,
    name: name || '',
    role: isFirstUser ? 'admin' : 'user',
  });
  res.status(201).json({ success: true, token: issueToken(user), user: publicUser(user) });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'email and password are required.' });
  }

  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ success: false, error: 'Invalid email or password.' });
  }

  res.json({ success: true, token: issueToken(user), user: publicUser(user) });
});

// POST /api/auth/change-password
router.post('/change-password', jwtAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword || newPassword.length < 8) {
    return res
      .status(400)
      .json({ success: false, error: 'currentPassword and a newPassword (min 8 chars) are required.' });
  }

  const user = await User.findById(req.user.sub);
  if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
    return res.status(401).json({ success: false, error: 'Current password is incorrect.' });
  }

  user.passwordHash = await bcrypt.hash(newPassword, 10);
  await user.save();
  res.json({ success: true });
});

module.exports = router;
