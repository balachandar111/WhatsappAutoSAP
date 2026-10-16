const jwt = require('jsonwebtoken');
const c = require('../config');
const SuperAdmin = require('../models/SuperAdmin');
const Admin = require('../models/Admin');
const { HttpError, forbidden } = require('../utils/http');

const sign = (account, role) => jwt.sign({ id: String(account._id), role }, c.JWT_SECRET, { expiresIn: c.JWT_EXPIRES_IN });

/*
 protect: verifies the Bearer token AND re-reads the account on every request, so
 deactivating an Admin (or resetting a password) takes effect immediately - no waiting for the token to expire.
 Sets req.user = { id, role }, and req.admin (Admin document) for ADMIN role.
*/
async function protect(req, _res, next) {
  const h = req.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) throw new HttpError(401, 'No token provided');
  let p;
  try { p = jwt.verify(token, c.JWT_SECRET); } catch { throw new HttpError(401, 'Invalid or expired token'); }

  const Model = p.role === 'SUPER_ADMIN' ? SuperAdmin : p.role === 'ADMIN' ? Admin : null;
  const account = Model && await Model.findById(p.id);
  if (!account) throw new HttpError(401, 'Account no longer exists');
  if (account.status !== 'ACTIVE') throw new HttpError(403, 'Your account has been deactivated. Please contact the Super Admin.');
  if (account.passwordChangedAt && p.iat * 1000 < account.passwordChangedAt.getTime() - 1000) throw new HttpError(401, 'Password changed. Please log in again.');

  req.user = { id: String(account._id), role: p.role };
  if (p.role === 'ADMIN') req.admin = account;
  else req.superAdmin = account;
  next();
}

const authorize = (...roles) => (req, _res, next) => {
  if (!req.user || !roles.includes(req.user.role)) throw forbidden('Access denied');
  next();
};

module.exports = { sign, protect, authorize, superAdminOnly: authorize('SUPER_ADMIN'), adminOnly: authorize('ADMIN') };
