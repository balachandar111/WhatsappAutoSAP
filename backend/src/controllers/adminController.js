const Chatflow = require('../models/Chatflow');
const Automation = require('../models/Automation');
const Order = require('../models/Order');
const Product = require('../models/Product');
const BulkEnquiry = require('../models/BulkEnquiry');
const FlowSubmission = require('../models/FlowSubmission');
const InboundLog = require('../models/InboundLog');
const Session = require('../models/Session');
const { getSettings, publicView } = require('../services/settings');
const { bad } = require('../utils/http');
const { featuresOf } = require('../middleware/features');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GET /api/admin/dashboard
exports.dashboard = async (req, res) => {
  const q = { admin: req.admin._id };
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const cfg = await getSettings(req.admin._id);
  const [chatflows, readyFlows, automations, activeAutomations, submissions, newSubmissions, activeChats, messagesToday, products, ordersToday, newBulk, rev] = await Promise.all([
    Chatflow.countDocuments(q), Chatflow.countDocuments({ ...q, status: 'ready' }),
    Automation.countDocuments(q), Automation.countDocuments({ ...q, active: true }),
    FlowSubmission.countDocuments(q), FlowSubmission.countDocuments({ ...q, status: 'new' }),
    Session.countDocuments({ ...q, updatedAt: { $gte: new Date(Date.now() - 24 * 3600 * 1000) } }),
    InboundLog.countDocuments({ ...q, createdAt: { $gte: start } }),
    Product.countDocuments(q), Order.countDocuments({ ...q, createdAt: { $gte: start } }), BulkEnquiry.countDocuments({ ...q, status: 'new' }),
    Order.aggregate([{ $match: { ...q, paymentStatus: 'paid' } }, { $group: { _id: null, v: { $sum: '$amount' } } }]),
  ]);
  res.json({
    success: true,
    data: {
      setup: publicView(cfg).status,
      chatflows: { total: chatflows, ready: readyFlows },
      automations: { total: automations, active: activeAutomations },
      conversations: { activeLast24h: activeChats, messagesToday },
      formSubmissions: { total: submissions, new: newSubmissions },
      adminType: req.admin.adminType, features: featuresOf(req.admin),
      commerce: featuresOf(req.admin).ecommerce ? { products, ordersToday, newBulkEnquiries: newBulk, totalRevenue: rev[0]?.v || 0 } : null,
    },
  });
};

const view = (a) => ({ adminType: a.adminType, features: featuresOf(a), id: a._id, name: a.name, company: a.company, username: a.username, email: a.email, phone: a.phone, status: a.status });

// GET /api/admin/profile
exports.getProfile = async (req, res) => res.json({ success: true, data: view(req.admin) });

// PUT /api/admin/profile   { name, company, email, phone }
exports.updateProfile = async (req, res) => {
  const b = req.body || {};
  for (const k of ['name', 'company', 'email', 'phone']) if (typeof b[k] === 'string') req.admin[k] = b[k].trim();
  if (!req.admin.name) throw bad('Name cannot be empty');
  if (req.admin.email && !EMAIL_RE.test(req.admin.email)) throw bad('Email is not valid');
  await req.admin.save();
  res.json({ success: true, message: 'Profile updated', data: view(req.admin) });
};
