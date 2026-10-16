const bcrypt = require('bcryptjs');
const SuperAdmin = require('../models/SuperAdmin');
const Admin = require('../models/Admin');
const { sign } = require('../middleware/auth');
const { HttpError, bad } = require('../utils/http');
const { featuresOf } = require('../middleware/features');

// compared against when the username is unknown, so response time does not reveal which usernames exist
const DUMMY = bcrypt.hashSync('not-a-real-password', 10);
const MIN_PASSWORD = 8;
const checkPassword = (p) => {
  if (typeof p !== 'string' || p.length < MIN_PASSWORD) throw bad(`Password must be at least ${MIN_PASSWORD} characters`);
  if (p.length > 72) throw bad('Password must be at most 72 characters');
};

const userView = (a, role) => ({
  id: a._id, name: a.name, username: a.username, role, status: a.status,
  ...(role === 'ADMIN' ? { company: a.company, email: a.email, phone: a.phone, adminType: a.adminType, features: featuresOf(a) } : {}),
});

// POST /api/auth/login   { username, password }  -> works for Super Admin and Admin (role is returned)
exports.login = async (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!username || !password) throw bad('Username and password are required');

  let role = 'SUPER_ADMIN';
  let account = await SuperAdmin.findOne({ username });
  if (!account) { role = 'ADMIN'; account = await Admin.findOne({ username }); }

  const ok = await bcrypt.compare(password, account ? account.password : DUMMY);
  if (!account || !ok) throw new HttpError(401, 'Invalid username or password');
  if (account.status !== 'ACTIVE') throw new HttpError(403, 'Your account has been deactivated. Please contact the Super Admin.');

  account.lastLoginAt = new Date();
  await account.save();
  res.json({ success: true, token: sign(account, role), user: userView(account, role) });
};

// GET /api/auth/me
exports.me = async (req, res) => {
  const role = req.user.role;
  res.json({ success: true, user: userView(req.admin || req.superAdmin, role) });
};

// PUT /api/auth/password   { currentPassword, newPassword }
exports.changePassword = async (req, res) => {
  const account = req.admin || req.superAdmin;
  const { currentPassword, newPassword } = req.body || {};
  if (!(await bcrypt.compare(String(currentPassword || ''), account.password))) throw bad('Current password is incorrect');
  checkPassword(newPassword);
  account.password = await bcrypt.hash(newPassword, 10);
  account.passwordChangedAt = new Date();
  await account.save();
  // the old token is now invalid (see middleware/auth.js) - hand back a fresh one
  res.json({ success: true, message: 'Password updated', token: sign(account, req.user.role) });
};

exports.checkPassword = checkPassword;
