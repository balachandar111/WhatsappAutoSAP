const bcrypt = require('bcryptjs');
const Admin = require('../models/Admin');
const SuperAdmin = require('../models/SuperAdmin');
const Setting = require('../models/Setting');
const Chatflow = require('../models/Chatflow');
const Automation = require('../models/Automation');
const Session = require('../models/Session');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Branch = require('../models/Branch');
const Order = require('../models/Order');
const BulkEnquiry = require('../models/BulkEnquiry');
const FlowSubmission = require('../models/FlowSubmission');
const InboundLog = require('../models/InboundLog');
const { getSettings, invalidate } = require('../services/settings');
const { checkPassword } = require('./authController');
const { bad, notFound, escRe, page } = require('../utils/http');

const TYPES = ['NORMAL', 'ECOMMERCE'];
const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TENANT_MODELS = [Setting, Chatflow, Automation, Session, Product, Category, Branch, Order, BulkEnquiry, FlowSubmission, InboundLog];

const adminView = (a, extra = {}) => ({
  id: a._id, adminType: a.adminType, name: a.name, company: a.company, username: a.username, email: a.email, phone: a.phone,
  status: a.status, statusChangedAt: a.statusChangedAt, lastLoginAt: a.lastLoginAt, createdAt: a.createdAt, ...extra,
});

// GET /api/superadmin/dashboard
exports.dashboard = async (_req, res) => {
  const [total, active, flows, automations, activeAutomations, orders, submissions, verified] = await Promise.all([
    Admin.countDocuments(), Admin.countDocuments({ status: 'ACTIVE' }),
    Chatflow.countDocuments(), Automation.countDocuments(), Automation.countDocuments({ active: true }),
    Order.countDocuments(), FlowSubmission.countDocuments(),
    Setting.countDocuments({ whatsappVerifiedAt: { $ne: null } }),
  ]);
  const recent = await Admin.find().sort({ createdAt: -1 }).limit(5);
  res.json({
    success: true,
    data: {
      normalAdmins: await Admin.countDocuments({ adminType: 'NORMAL' }), ecommerceAdmins: await Admin.countDocuments({ adminType: 'ECOMMERCE' }),
      totalAdmins: total, activeAdmins: active, inactiveAdmins: total - active,
      adminsWithVerifiedWhatsapp: verified,
      totalChatflows: flows, totalAutomations: automations, activeAutomations, totalOrders: orders, totalSubmissions: submissions,
      recentAdmins: recent.map((a) => adminView(a)),
    },
  });
};

// POST /api/superadmin/admins
exports.createAdmin = async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  const username = String(b.username || '').trim().toLowerCase();
  if (!name) throw bad('Name is required');
  if (!TYPES.includes(b.adminType)) throw bad('Choose the admin type: NORMAL (chat flows + automation) or ECOMMERCE (ecommerce operations + chat flows + automation)');
  if (!USERNAME_RE.test(username)) throw bad('Username must be 3-30 characters: letters, numbers, dot, dash or underscore');
  if (b.email && !EMAIL_RE.test(String(b.email).trim())) throw bad('Email is not valid');
  checkPassword(b.password);
  if ((await Admin.exists({ username })) || (await SuperAdmin.exists({ username }))) throw bad('Username already exists');

  const admin = await Admin.create({
    name, username, adminType: b.adminType, company: String(b.company || '').trim(), email: String(b.email || '').trim(), phone: String(b.phone || '').trim(),
    password: await bcrypt.hash(b.password, 10), createdBy: req.superAdmin._id,
  });
  await getSettings(admin._id);            // creates the Setup record + webhook URL right away
  res.status(201).json({ success: true, message: 'Admin created', data: adminView(admin) });
};

// GET /api/superadmin/admins?status=ACTIVE|INACTIVE&q=text&page=1&limit=20
exports.listAdmins = async (req, res) => {
  const { skip, limit, page: p } = page(req);
  const f = {};
  if (['ACTIVE', 'INACTIVE'].includes(req.query.status)) f.status = req.query.status;
  if (TYPES.includes(req.query.adminType)) f.adminType = req.query.adminType;
  if (req.query.q) { const r = new RegExp(escRe(String(req.query.q).trim()), 'i'); f.$or = [{ name: r }, { username: r }, { company: r }, { email: r }]; }
  const [admins, total] = await Promise.all([Admin.find(f).sort({ createdAt: -1 }).skip(skip).limit(limit), Admin.countDocuments(f)]);
  const settings = await Setting.find({ admin: { $in: admins.map((a) => a._id) } }).select('admin whatsappVerifiedAt');
  const ver = new Map(settings.map((s) => [String(s.admin), !!s.whatsappVerifiedAt]));
  res.json({
    success: true, total, page: p, pages: Math.max(Math.ceil(total / limit), 1),
    data: admins.map((a) => adminView(a, { whatsappTested: ver.get(String(a._id)) || false })),
  });
};

// GET /api/superadmin/admins/:id   (includes usage counts + setup progress; never any credential)
exports.getAdmin = async (req, res) => {
  const a = await Admin.findById(req.params.id);
  if (!a) throw notFound('Admin not found');
  const cfg = await getSettings(a._id);
  const q = { admin: a._id };
  const [chatflows, automations, products, orders, submissions] = await Promise.all([
    Chatflow.countDocuments(q), Automation.countDocuments(q), Product.countDocuments(q), Order.countDocuments(q), FlowSubmission.countDocuments(q),
  ]);
  res.json({
    success: true,
    data: adminView(a, {
      setup: { whatsappConfigured: !!(cfg.waToken && cfg.phoneNumberId && cfg.appSecret), whatsappVerified: cfg.whatsappVerified, whatsappVerifiedAt: cfg.whatsappVerifiedAt, phoneNumber: cfg.whatsappInfo?.display_phone_number || null },
      usage: { chatflows, automations, products, orders, submissions },
    }),
  });
};

// PUT /api/superadmin/admins/:id   { name, company, email, phone }
exports.updateAdmin = async (req, res) => {
  const b = req.body || {};
  const set = {};
  for (const k of ['name', 'company', 'email', 'phone']) if (typeof b[k] === 'string') set[k] = b[k].trim();
  if (set.name === '') throw bad('Name cannot be empty');
  if (set.email && !EMAIL_RE.test(set.email)) throw bad('Email is not valid');
  const a = await Admin.findByIdAndUpdate(req.params.id, set, { new: true });
  if (!a) throw notFound('Admin not found');
  res.json({ success: true, message: 'Admin updated', data: adminView(a) });
};

// PATCH /api/superadmin/admins/:id/status   { status: "ACTIVE" | "INACTIVE" }
async function setStatus(req, res, status) {
  if (!['ACTIVE', 'INACTIVE'].includes(status)) throw bad('Status must be ACTIVE or INACTIVE');
  const a = await Admin.findByIdAndUpdate(req.params.id, { status, statusChangedAt: new Date() }, { new: true });
  if (!a) throw notFound('Admin not found');
  invalidate(a._id);
  // Deactivated admins are cut off immediately: API calls are refused (middleware/auth.js) and the WhatsApp webhook ignores their number.
  res.json({ success: true, message: status === 'ACTIVE' ? 'Admin activated' : 'Admin deactivated', data: adminView(a) });
}
exports.setStatus = (req, res) => setStatus(req, res, req.body?.status);
exports.activate = (req, res) => setStatus(req, res, 'ACTIVE');
exports.deactivate = (req, res) => setStatus(req, res, 'INACTIVE');

// PATCH /api/superadmin/admins/:id/type   { adminType: "NORMAL" | "ECOMMERCE" }
// Downgrading to NORMAL switches the admin's ordering-bot automation off (their products/orders are kept, just locked).
exports.setType = async (req, res) => {
  const adminType = req.body?.adminType;
  if (!TYPES.includes(adminType)) throw bad('adminType must be NORMAL or ECOMMERCE');
  const a = await Admin.findByIdAndUpdate(req.params.id, { adminType }, { new: true });
  if (!a) throw notFound('Admin not found');
  if (adminType === 'NORMAL') {
    const cm = await Automation.find({ admin: a._id, type: 'commerce', active: true }).select('_id');
    await Automation.updateMany({ admin: a._id, type: 'commerce' }, { active: false });
    await Session.deleteMany({ admin: a._id, automation: { $in: cm.map((x) => x._id) } });
  }
  res.json({ success: true, message: adminType === 'ECOMMERCE' ? 'Ecommerce operations enabled' : 'Switched to normal (chat flow only)', data: adminView(a) });
};

// PUT /api/superadmin/admins/:id/password   { password }
exports.resetPassword = async (req, res) => {
  checkPassword(req.body?.password);
  const a = await Admin.findByIdAndUpdate(req.params.id, { password: await bcrypt.hash(req.body.password, 10), passwordChangedAt: new Date() }, { new: true });
  if (!a) throw notFound('Admin not found');
  res.json({ success: true, message: 'Password reset. The admin has been signed out everywhere.' });
};

// DELETE /api/superadmin/admins/:id   -> removes the admin AND all of their data (settings, flows, automations, orders ...)
exports.deleteAdmin = async (req, res) => {
  const a = await Admin.findById(req.params.id);
  if (!a) throw notFound('Admin not found');
  await Promise.all(TENANT_MODELS.map((M) => M.deleteMany({ admin: a._id })));
  await a.deleteOne();
  invalidate(a._id);
  res.json({ success: true, message: 'Admin and all of their data deleted' });
};
