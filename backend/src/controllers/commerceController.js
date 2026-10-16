// Commerce modules (from wa-sweet-mern): categories, products, branches, orders, bulk enquiries. Every query is scoped to the logged-in admin.
const Product = require('../models/Product');
const Category = require('../models/Category');
const Branch = require('../models/Branch');
const Order = require('../models/Order');
const BulkEnquiry = require('../models/BulkEnquiry');
const { getSettings } = require('../services/settings');
const { makeClient } = require('../services/whatsapp');
const { bad, notFound, escRe, digits, page } = require('../utils/http');

const A = (req) => ({ admin: req.admin._id });
const dupMsg = (what) => (e) => { if (e.code === 11000) throw bad(`${what} already exists`); throw e; };

/* ------------------------------ categories ------------------------------ */
const catPick = (b) => {
  const o = { key: b.key === undefined ? undefined : String(b.key).trim().toLowerCase(), label: b.label, emoji: b.emoji, description: b.description, sortOrder: b.sortOrder === undefined ? undefined : Number(b.sortOrder), active: b.active };
  Object.keys(o).forEach((k) => (o[k] === undefined || Number.isNaN(o[k])) && delete o[k]);
  return o;
};
exports.listCategories = async (req, res) => {
  const cats = await Category.find(A(req)).sort({ sortOrder: 1, label: 1 });
  const counts = await Product.aggregate([{ $match: A(req) }, { $group: { _id: '$category', n: { $sum: 1 } } }]);
  const m = new Map(counts.map((c) => [c._id, c.n]));
  res.json({ success: true, data: cats.map((c) => ({ ...c.toObject(), products: m.get(c.key) || 0 })) });
};
exports.createCategory = async (req, res) => {
  const b = catPick(req.body || {});
  if (!b.key && b.label) b.key = String(b.label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
  try { res.status(201).json({ success: true, data: await Category.create({ ...b, admin: req.admin._id }) }); } catch (e) { dupMsg('Category key')(e); }
};
exports.updateCategory = async (req, res) => {
  const b = catPick(req.body || {});
  delete b.key;                                    // key is referenced by products; changing it would orphan them
  const c = await Category.findOneAndUpdate({ _id: req.params.id, ...A(req) }, b, { new: true, runValidators: true });
  if (!c) throw notFound();
  res.json({ success: true, data: c });
};
exports.deleteCategory = async (req, res) => {
  const c = await Category.findOne({ _id: req.params.id, ...A(req) });
  if (!c) throw notFound();
  if (await Product.exists({ ...A(req), category: c.key })) throw Object.assign(bad('Move or delete the products in this category first'), { status: 409 });
  await c.deleteOne();
  res.json({ success: true });
};

/* ------------------------------ products ------------------------------ */
const cleanVariants = (v) => (Array.isArray(v) ? v : [])
  .map((x) => ({ label: String(x.label || '').trim(), price: Number(x.price), sku: String(x.sku || '').trim().toUpperCase() || undefined }))
  .filter((x) => x.label && Number.isFinite(x.price) && x.price >= 0);

const prodPick = (b) => {
  const variants = b.variants === undefined ? undefined : cleanVariants(b.variants);
  const out = {
    code: b.code, name: b.name, category: b.category === undefined ? undefined : String(b.category).trim().toLowerCase(), description: b.description, image: b.image,
    price: b.price === undefined ? undefined : Number(b.price), unit: b.unit, available: b.available, variants,
  };
  if (Array.isArray(b.unavailableAt)) out.unavailableAt = b.unavailableAt.map(String);
  if (variants?.length) { out.price = variants[0].price; out.unit = variants[0].label; }   // base price/unit mirror the first size
  Object.keys(out).forEach((k) => (out[k] === undefined || Number.isNaN(out[k])) && delete out[k]);
  return out;
};
const needCategory = async (req, key) => { if (key && !(await Category.exists({ ...A(req), key }))) throw bad(`Category "${key}" does not exist. Create it first.`); };

exports.listProducts = async (req, res) => {
  const f = { ...A(req) };
  if (req.query.category) f.category = String(req.query.category).toLowerCase();
  if (req.query.q) { const r = new RegExp(escRe(String(req.query.q).trim()), 'i'); f.$or = [{ name: r }, { code: r }]; }
  res.json({ success: true, data: await Product.find(f).sort({ category: 1, name: 1 }) });
};
exports.createProduct = async (req, res) => {
  const b = prodPick(req.body || {});
  await needCategory(req, b.category);
  try { res.status(201).json({ success: true, data: await Product.create({ ...b, admin: req.admin._id }) }); } catch (e) { dupMsg('Product code')(e); }
};
exports.updateProduct = async (req, res) => {
  const b = prodPick(req.body || {});
  await needCategory(req, b.category);
  try {
    const p = await Product.findOneAndUpdate({ _id: req.params.id, ...A(req) }, b, { new: true, runValidators: true });
    if (!p) throw notFound();
    res.json({ success: true, data: p });
  } catch (e) { dupMsg('Product code')(e); }
};
exports.deleteProduct = async (req, res) => {
  const r = await Product.deleteOne({ _id: req.params.id, ...A(req) });
  if (!r.deletedCount) throw notFound();
  res.json({ success: true });
};

/* ------------------------------ branches ------------------------------ */
const branchPick = (b) => {
  const o = {
    code: b.code, name: b.name, address: b.address, phone: b.phone, alertPhone: b.alertPhone === undefined ? undefined : digits(b.alertPhone),
    lat: b.lat === '' || b.lat == null ? undefined : Number(b.lat), lng: b.lng === '' || b.lng == null ? undefined : Number(b.lng),
    openTime: b.openTime, closeTime: b.closeTime, active: b.active,
  };
  Object.keys(o).forEach((k) => (o[k] === undefined || Number.isNaN(o[k])) && delete o[k]);
  return o;
};
exports.listBranches = async (req, res) => res.json({ success: true, data: await Branch.find(A(req)).sort({ name: 1 }) });
exports.createBranch = async (req, res) => {
  try { res.status(201).json({ success: true, data: await Branch.create({ ...branchPick(req.body || {}), admin: req.admin._id }) }); } catch (e) { dupMsg('Branch code')(e); }
};
exports.updateBranch = async (req, res) => {
  try {
    const b = await Branch.findOneAndUpdate({ _id: req.params.id, ...A(req) }, branchPick(req.body || {}), { new: true, runValidators: true });
    if (!b) throw notFound();
    res.json({ success: true, data: b });
  } catch (e) { dupMsg('Branch code')(e); }
};
exports.deleteBranch = async (req, res) => {
  const r = await Branch.deleteOne({ _id: req.params.id, ...A(req) });
  if (!r.deletedCount) throw notFound();
  res.json({ success: true });
};

/* ------------------------------ orders ------------------------------ */
exports.orderStats = async (req, res) => {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const b = { ...A(req), ...(req.query.branch ? { branchCode: String(req.query.branch) } : {}) };
  const sum = (match) => Order.aggregate([{ $match: { ...b, ...match } }, { $group: { _id: null, v: { $sum: '$amount' } } }]);
  const [todayOrders, todayRev, pendingPayments, toPack, totalRev, totalOrders, newBulk, byBranch] = await Promise.all([
    Order.countDocuments({ ...b, createdAt: { $gte: start } }), sum({ paymentStatus: 'paid', paidAt: { $gte: start } }),
    Order.countDocuments({ ...b, paymentStatus: 'pending' }), Order.countDocuments({ ...b, paymentStatus: 'paid', status: 'new' }),
    sum({ paymentStatus: 'paid' }), Order.countDocuments(b), BulkEnquiry.countDocuments({ ...A(req), status: 'new' }),
    Order.aggregate([{ $match: { ...A(req), paymentStatus: 'paid', paidAt: { $gte: start } } }, { $group: { _id: '$branchName', orders: { $sum: 1 }, revenue: { $sum: '$amount' } } }, { $sort: { revenue: -1 } }]),
  ]);
  res.json({ success: true, data: { todayOrders, pendingPayments, toPack, totalOrders, newBulk, todayRevenue: todayRev[0]?.v || 0, totalRevenue: totalRev[0]?.v || 0, byBranch: byBranch.map((x) => ({ branch: x._id || '—', orders: x.orders, revenue: x.revenue })) } });
};

exports.listOrders = async (req, res) => {
  const { status, paymentStatus, q, from, to, branch, fulfilment } = req.query;
  const { skip, limit, page: p } = page(req);
  const f = { ...A(req) };
  if (status) f.status = String(status);
  if (paymentStatus) f.paymentStatus = String(paymentStatus);
  if (branch) f.branchCode = String(branch);
  if (fulfilment) f.fulfilment = String(fulfilment);
  if (from || to) {
    f.createdAt = {};
    if (from) f.createdAt.$gte = new Date(from);
    if (to) { const d = new Date(to); d.setHours(23, 59, 59, 999); f.createdAt.$lte = d; }
  }
  if (q) { const r = new RegExp(escRe(String(q).trim()), 'i'); f.$or = [{ orderId: r }, { name: r }, { phone: r }]; }
  const [orders, total] = await Promise.all([Order.find(f).sort({ createdAt: -1 }).skip(skip).limit(limit), Order.countDocuments(f)]);
  res.json({ success: true, data: orders, total, page: p, pages: Math.max(Math.ceil(total / limit), 1) });
};
exports.getOrder = async (req, res) => {
  const o = await Order.findOne({ _id: req.params.id, ...A(req) });
  if (!o) throw notFound();
  res.json({ success: true, data: o });
};

const riderLine = (o) => (o.rider?.name ? `\n🛵 Rider: ${o.rider.name}${o.rider.phone ? ' (' + o.rider.phone + ')' : ''}${o.rider.trackingUrl ? '\n🔗 Track: ' + o.rider.trackingUrl : ''}` : '');
const MESSAGES = {
  packed: (o) => `📦 Good news ${o.name}! Your order *${o.orderId}* is packed${o.fulfilment === 'pickup' ? ' and will be ready for pickup shortly.' : ' and will be dispatched soon.'}`,
  ready: (o) => `🏬 ${o.name}, your order *${o.orderId}* is *ready for pickup* at ${o.branchName}${o.pickupSlot ? ' (' + o.pickupSlot + ')' : ''}. Please show this message at the counter.`,
  dispatched: (o) => `🚚 Your order *${o.orderId}* is *out for delivery*! It will reach you shortly.${riderLine(o)}`,
  delivered: (o) => `✅ Your order *${o.orderId}* has been ${o.fulfilment === 'pickup' ? 'collected' : 'delivered'}. Thank you for shopping with us! 🙏`,
  cancelled: (o) => `❌ Your order *${o.orderId}* has been cancelled. Our team will contact you if any refund is needed.`,
};
const STATUSES = ['new', 'packed', 'ready', 'dispatched', 'delivered', 'cancelled'];

// PATCH /api/orders/:id/status  { status, notify }
exports.setOrderStatus = async (req, res) => {
  const { status, notify = true } = req.body || {};
  if (!STATUSES.includes(status)) throw bad('Invalid status');
  const o = await Order.findOne({ _id: req.params.id, ...A(req) });
  if (!o) throw notFound();
  if (['packed', 'ready', 'dispatched', 'delivered'].includes(status) && o.paymentStatus !== 'paid') throw bad('Order is not paid yet');
  if (status === 'ready' && o.fulfilment !== 'pickup') throw bad('"Ready" is only for self-pickup orders');
  if (status === 'dispatched' && o.fulfilment === 'pickup') throw bad('Pickup orders are not dispatched — use "Ready"');
  o.status = status; await o.save();

  let notified = false, notifyError = null, via = null;
  if (notify && MESSAGES[status]) {
    const W = makeClient(await getSettings(req.admin._id));
    try { await W.text(o.phone, MESSAGES[status](o)); notified = true; via = 'text'; }
    catch {
      // 24-hour window closed -> approved utility template
      try { await W.template(o.phone, `order_${status}`, [o.name, o.orderId]); notified = true; via = 'template'; }
      catch (e2) { notifyError = `Customer not notified: ${e2.message}. Create/approve the order_${status} template in Setup → Templates.`; }
    }
  }
  res.json({ success: true, data: { order: o, notified, notifyError, via } });
};

exports.setRider = async (req, res) => {
  const { name = '', phone = '', trackingUrl = '' } = req.body || {};
  if (trackingUrl && !/^https?:\/\//i.test(trackingUrl)) throw bad('Tracking link must start with http(s)://');
  const o = await Order.findOneAndUpdate({ _id: req.params.id, ...A(req) }, { rider: { name: String(name).slice(0, 60), phone: String(phone).slice(0, 20), trackingUrl: String(trackingUrl).slice(0, 300) } }, { new: true });
  if (!o) throw notFound();
  res.json({ success: true, data: o });
};

/* ------------------------------ bulk enquiries ------------------------------ */
exports.listBulk = async (req, res) => {
  const f = { ...A(req), ...(req.query.status ? { status: String(req.query.status) } : {}) };
  res.json({ success: true, data: await BulkEnquiry.find(f).sort({ createdAt: -1 }).limit(200) });
};
exports.updateBulk = async (req, res) => {
  const { status, note } = req.body || {};
  const set = {};
  if (status) { if (!['new', 'contacted', 'quoted', 'confirmed', 'closed'].includes(status)) throw bad('Invalid status'); set.status = status; }
  if (typeof note === 'string') set.note = note.slice(0, 1000);
  const q = await BulkEnquiry.findOneAndUpdate({ _id: req.params.id, ...A(req) }, set, { new: true });
  if (!q) throw notFound();
  res.json({ success: true, data: q });
};
