const Automation = require('../models/Automation');
const Chatflow = require('../models/Chatflow');
const Session = require('../models/Session');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Branch = require('../models/Branch');
const dispatcher = require('../services/dispatcher');
const shopEngine = require('../services/shopEngine');
const { bad, notFound, HttpError } = require('../utils/http');
const { featuresOf } = require('../middleware/features');

const one = async (req) => {
  const a = await Automation.findOne({ _id: req.params.id, admin: req.admin._id });
  if (!a) throw notFound('Automation not found');
  return a;
};

const words = (v, { max = 20, len = 50, label = 'keyword' } = {}) => {
  const arr = Array.isArray(v) ? v : String(v ?? '').split(',');
  const out = [...new Set(arr.map((x) => String(x).toLowerCase().replace(/\s+/g, ' ').trim()).filter(Boolean))];
  if (out.length > max) throw bad(`At most ${max} ${label}s`);
  for (const w of out) if (w.length > len) throw bad(`A ${label} can be at most ${len} characters`);
  return out;
};

const view = (a, flow) => ({
  id: a._id, name: a.name, description: a.description, type: a.type, active: a.active, isDefault: a.isDefault, priority: a.priority,
  chatflow: a.chatflow ? { id: a.chatflow, name: flow?.name, status: flow?.status, version: flow?.version } : null,
  trigger: a.trigger, restartKeywords: a.restartKeywords, endKeywords: a.endKeywords, sessionTimeoutMins: a.sessionTimeoutMins,
  stats: a.stats, createdAt: a.createdAt, updatedAt: a.updatedAt,
});

async function checkFlow(req, id) {
  if (!id) throw bad('Choose the chat flow this automation should run');
  const f = await Chatflow.findOne({ _id: id, admin: req.admin._id });
  if (!f) throw bad('Chat flow not found');
  if (!f.liveFlow) throw bad(`"${f.name}" is not ready yet. Open it in the builder, fix the listed problems and save.`);
  return f;
}

// Things that will not block saving but the admin should know about
async function warningsFor(req, a) {
  const w = [];
  const hasKeywords = a.trigger.keywords.length > 0;
  if (a.active && !hasKeywords && !a.isDefault) w.push('This automation has no keywords and is not the default, so no customer message will ever start it.');
  if (a.active && hasKeywords) {
    const clash = await Automation.find({ admin: req.admin._id, active: true, _id: { $ne: a._id }, 'trigger.keywords': { $in: a.trigger.keywords } }).select('name trigger.keywords');
    for (const c of clash) w.push(`Keyword clash with "${c.name}" (${c.trigger.keywords.filter((k) => a.trigger.keywords.includes(k)).join(', ')}). The one with the higher priority wins.`);
  }
  let usesShop = a.type === 'commerce';
  if (a.type === 'flow' && a.chatflow) {
    const f = a._flow?.liveFlow ? a._flow : await Chatflow.findById(a.chatflow).select('liveFlow');
    usesShop = shopEngine.flowUsesCommerce(f?.liveFlow);
  }
  if (usesShop) {
    const [prods, cats, branches] = await Promise.all([Product.countDocuments({ admin: req.admin._id, available: true }), Category.countDocuments({ admin: req.admin._id, active: true }), Branch.countDocuments({ admin: req.admin._id, active: true })]);
    if (!cats || !prods) w.push('Add categories and products first - the ordering menu is empty.');
    if (!branches) w.push('Add at least one branch - orders need an outlet to be routed to.');
    if (!(req.cfg.rzpKeyId && req.cfg.rzpKeySecret)) w.push('Razorpay keys are not saved in Setup, so customers cannot pay.');
  }
  return w;
}

async function applyBody(req, a, b, { creating }) {
  if (creating || b.name !== undefined) {
    const name = String(b.name || '').trim();
    if (!name) throw bad('Name is required');
    a.name = name.slice(0, 80);
  }
  if (b.description !== undefined) a.description = String(b.description).slice(0, 300);
  if (creating) {
    if (!['flow', 'commerce'].includes(b.type || 'flow')) throw bad('Type must be "flow" or "commerce"');
    a.type = b.type || 'flow';
    if (a.type === 'commerce' && !featuresOf(req.admin).ecommerce) throw new HttpError(403, 'The ordering (commerce) automation needs Ecommerce operations, which the Super Admin has not enabled for your account.');
  } else if (b.type !== undefined && b.type !== a.type) throw bad('The type of an automation cannot be changed. Create a new one instead.');

  if (a.type === 'flow') {
    if (creating || b.chatflow !== undefined) { const f = await checkFlow(req, b.chatflow); a.chatflow = f._id; a._flow = f; }
  } else {
    a.chatflow = null;
    if (creating && (await Automation.exists({ admin: req.admin._id, type: 'commerce' }))) throw Object.assign(bad('You already have an ordering (commerce) automation. Edit that one instead.'), { status: 409 });
  }

  if (b.trigger !== undefined || b.keywords !== undefined) {
    const t = b.trigger || {};
    a.trigger = {
      keywords: words(t.keywords ?? b.keywords ?? []),
      matchType: ['exact', 'contains', 'startsWith'].includes(t.matchType ?? b.matchType) ? (t.matchType ?? b.matchType) : (a.trigger?.matchType || 'exact'),
    };
  }
  if (b.restartKeywords !== undefined) a.restartKeywords = words(b.restartKeywords, { label: 'restart keyword' });
  if (b.endKeywords !== undefined) a.endKeywords = words(b.endKeywords, { label: 'end keyword' });
  if (b.sessionTimeoutMins !== undefined) {
    const n = Number(b.sessionTimeoutMins);
    if (!Number.isInteger(n) || n < 5 || n > 10080) throw bad('Session timeout must be between 5 and 10080 minutes');
    a.sessionTimeoutMins = n;
  }
  if (b.priority !== undefined) {
    const n = Number(b.priority);
    if (!Number.isInteger(n) || n < -100 || n > 100) throw bad('Priority must be a whole number from -100 to 100');
    a.priority = n;
  }
  if (b.active !== undefined) a.active = !!b.active;
  if (b.isDefault !== undefined) a.isDefault = !!b.isDefault;
}

async function persist(req, a) {
  if (a.isDefault) await Automation.updateMany({ admin: req.admin._id, _id: { $ne: a._id }, isDefault: true }, { isDefault: false });   // only one default
  await a.save();
}

// GET /api/automations
exports.list = async (req, res) => {
  const list = await Automation.find({ admin: req.admin._id }).sort({ createdAt: -1 });
  const flows = await Chatflow.find({ _id: { $in: list.map((a) => a.chatflow).filter(Boolean) } }).select('name status version');
  const fm = new Map(flows.map((f) => [String(f._id), f]));
  res.json({ success: true, count: list.length, data: list.map((a) => view(a, fm.get(String(a.chatflow)))) });
};

// POST /api/automations
exports.create = async (req, res) => {
  const a = new Automation({ admin: req.admin._id });
  await applyBody(req, a, req.body || {}, { creating: true });
  await persist(req, a);
  res.status(201).json({ success: true, message: 'Automation created', warnings: await warningsFor(req, a), data: view(a, a._flow) });
};

// GET /api/automations/:id
exports.get = async (req, res) => {
  const a = await one(req);
  const f = a.chatflow ? await Chatflow.findById(a.chatflow).select('name status version') : null;
  res.json({ success: true, warnings: await warningsFor(req, a), data: view(a, f) });
};

// PUT /api/automations/:id
exports.update = async (req, res) => {
  const a = await one(req);
  await applyBody(req, a, req.body || {}, { creating: false });
  await persist(req, a);
  const f = a._flow || (a.chatflow ? await Chatflow.findById(a.chatflow).select('name status version') : null);
  res.json({ success: true, message: 'Automation updated', warnings: await warningsFor(req, a), data: view(a, f) });
};

// PATCH /api/automations/:id/status   { active: true|false }   <- the on/off switch
exports.setStatus = async (req, res) => {
  const a = await one(req);
  if (typeof req.body?.active !== 'boolean') throw bad('Send { "active": true } or { "active": false }');
  if (req.body.active && a.type === 'flow') await checkFlow(req, a.chatflow);
  if (req.body.active && a.type === 'commerce' && !featuresOf(req.admin).ecommerce) throw new HttpError(403, 'Ecommerce operations are not enabled for your account.');
  a.active = req.body.active;
  await a.save();
  if (!a.active) await Session.deleteMany({ admin: req.admin._id, automation: a._id });          // running chats stop with it
  res.json({ success: true, message: a.active ? 'Automation is live' : 'Automation switched off', warnings: await warningsFor(req, a), data: view(a) });
};

// DELETE /api/automations/:id
exports.remove = async (req, res) => {
  const a = await one(req);
  await Session.deleteMany({ admin: req.admin._id, automation: a._id });
  await a.deleteOne();
  res.json({ success: true, message: 'Automation deleted' });
};

// POST /api/automations/:id/simulate   { text | replyId | replyTitle | location:{latitude,longitude}, reset }
// Dry run: returns the WhatsApp messages the bot WOULD send. Nothing is sent, no submissions are saved.
exports.simulate = async (req, res) => {
  const a = await one(req);
  if (a.type !== 'flow') throw bad('Only chat-flow automations can be simulated');
  const b = req.body || {};
  const input = await dispatcher.buildSimInput(req.admin._id, b);
  const out = await dispatcher.simulate({ cfg: req.cfg, automation: a, userId: String(req.admin._id), input, reset: !!b.reset || (!b.text && !b.replyId && !b.media && !b.sampleLocation) });
  res.json({ success: true, data: out });
};
