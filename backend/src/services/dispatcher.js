/*
 Inbound router. For every customer message of one admin it decides WHICH automation answers, then runs it:
   1. keyword automations   (customer typed a trigger keyword)            -> switch to that automation
   2. the automation that already owns this chat (session)
   3. the default automation (any other first message)
   4. nobody -> ignored
 Messages from one customer are processed strictly one after another (no racing replies / lost cart items).
*/
const Automation = require('../models/Automation');
const Chatflow = require('../models/Chatflow');
const Session = require('../models/Session');
const Admin = require('../models/Admin');
const { featuresOf } = require('../middleware/features');
const flowEngine = require('./flowEngine');
const shopEngine = require('./shopEngine');
const Branch = require('../models/Branch');
const commerceBot = require('./commerceBot');
const { makeClient, safe, recorder } = require('./whatsapp');
const { parseInbound } = require('./inbound');
const { t } = require('./i18n');

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

const queues = new Map();
function enqueue(key, fn) {
  const prev = queues.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  queues.set(key, next);
  next.finally(() => { if (queues.get(key) === next) queues.delete(key); }).catch(() => {});
  return next;
}

function keywordMatch(automations, text) {
  const q = norm(text);
  if (!q) return null;
  let best = null;
  for (const a of automations) {
    const mode = a.trigger?.matchType || 'exact';
    for (const kw of a.trigger?.keywords || []) {
      const k = norm(kw);
      if (!k) continue;
      const hit = mode === 'exact' ? q === k : mode === 'startsWith' ? q.startsWith(k) : q.includes(k);
      if (hit && (!best || a.priority > best.a.priority || (a.priority === best.a.priority && k.length > best.len))) best = { a, len: k.length };
    }
  }
  return best?.a || null;
}
const isOneOf = (list, text) => { const q = norm(text); return !!q && (list || []).some((k) => norm(k) === q); };

async function resetSession(adminId, phone, automation, profileName) {
  return Session.findOneAndUpdate(
    { admin: adminId, phone },
    { $set: { admin: adminId, phone, automation: automation._id, kind: automation.type, profileName: profileName || '', flow: {}, step: 'menu', cart: [], details: {}, pending: null, awaitingInput: false, updatedAt: new Date() } },
    { upsert: true, new: true });
}

// Core: process one customer message for one tenant.
//   opts.client      = unsafe WhatsApp client (real or recording)      opts.simulate = dry run (flow preview)
//   opts.automationId = force an automation (simulator)
async function run({ cfg, phone, input, profileName, client, simulate = false, automationId = null, previewAutomation = null }) {
  const adminId = cfg.adminId;
  const W = safe(client);
  const owner = await Admin.findById(adminId).select('adminType');
  const canSell = featuresOf(owner).ecommerce;
  let automations = await Automation.find({ admin: adminId, active: true }).sort({ priority: -1, createdAt: 1 });
  if (!canSell) automations = automations.filter((a) => a.type !== 'commerce');      // downgraded admins: ordering bot is off
  // the simulator can preview an automation that is not switched on yet
  if (simulate && automationId && !automations.some((a) => String(a._id) === String(automationId))) {
    const preview = previewAutomation || await Automation.findOne({ _id: automationId, admin: adminId });
    if (preview) automations.push(preview);
  }
  const byId = new Map(automations.map((a) => [String(a._id), a]));

  let session = await Session.findOne({ admin: adminId, phone });
  let current = session?.automation ? byId.get(String(session.automation)) : null;
  // idle too long (or the automation was switched off / deleted) -> start over
  if (session && (!current || Date.now() - new Date(session.updatedAt).getTime() > (current.sessionTimeoutMins || 1440) * 60000)) { await session.deleteOne(); session = null; current = null; }

  let target = null;
  let fresh = false;
  const typed = input.type === 'text' ? input.text : '';
  if (automationId) {
    target = byId.get(String(automationId)) || null;
    if (!session || String(session.automation) !== String(target?._id)) fresh = true;
  } else {
    const kw = !session?.awaitingInput ? keywordMatch(automations, typed) : null;
    if (kw) { target = kw; fresh = true; }                         // an explicit keyword always (re)starts that automation
    else if (current) target = current;
    else { target = automations.find((a) => a.isDefault) || null; fresh = true; }
  }
  if (!target) return { handled: false };

  // chat-level commands of the running automation
  if (!fresh && session) {
    if (isOneOf(target.endKeywords, typed)) {
      await session.deleteOne();
      await W.text(phone, t('english', 'cancelled') + ' ' + t('english', 'ended'));
      return { handled: true, automation: target };
    }
    if (!session.awaitingInput && isOneOf(target.restartKeywords, typed)) fresh = true;
  }

  const load = async (automation) => {
    const base = { adminId, cfg, W, client, to: phone, input, profileName, simulate, ended: false };
    if (automation.type === 'flow') {
      const flowDoc = await Chatflow.findOne({ _id: automation.chatflow, admin: adminId });
      if (!flowDoc || !flowDoc.liveFlow || !Object.keys(flowDoc.liveFlow).length) return null;
      if (!canSell && shopEngine.flowUsesCommerce(flowDoc.liveFlow)) return null;      // downgraded admin: shop nodes are off
      return { ...base, automation, flowDoc, flow: flowDoc.liveFlow };
    }
    return { ...base, automation };
  };

  let ctx = await load(target);
  if (!ctx) { await W.text(phone, 'Sorry, this service is not available right now. Please try later 🙏'); return { handled: true, automation: target }; }

  if (fresh || !session) {
    session = await resetSession(adminId, phone, target, profileName);
    if (!simulate) await Automation.updateOne({ _id: target._id }, { $inc: { 'stats.conversations': 1 }, $set: { 'stats.lastTriggeredAt': new Date() } });
  } else if (profileName && session.profileName !== profileName) session.profileName = profileName;
  ctx.session = session;

  // flow option "Handoff: commerce" -> pass this chat to the ordering bot
  ctx.switchTo = async (type) => {
    const next = automations.find((a) => a.type === type);
    if (!next) { await W.text(phone, t('english', 'noOrdering')); ctx.ended = true; return; }
    const s2 = await resetSession(adminId, phone, next, profileName);
    const ctx2 = await load(next);
    ctx2.session = s2; ctx2.switchTo = async () => {};
    await commerceBot.start(ctx2);
    if (ctx2.ended) await s2.deleteOne(); else { s2.updatedAt = new Date(); await s2.save(); }
    ctx.session = null; ctx.switched = true;
  };

  const engine = target.type === 'flow' ? flowEngine : commerceBot;
  if (fresh) await engine.start(ctx);
  else await engine.handle(ctx);

  if (ctx.switched) return { handled: true, automation: target };
  if (ctx.ended) await Session.deleteOne({ admin: adminId, phone });
  else { ctx.session.updatedAt = new Date(); await ctx.session.save(); }
  return { handled: true, automation: target, session: ctx.ended ? null : ctx.session };
}

// Real inbound message from the webhook
function handleMessage({ cfg, msg, profileName }) {
  const input = parseInbound(msg);
  const client = makeClient(cfg);
  return enqueue(`${cfg.adminId}:${msg.from}`, () => run({ cfg, phone: msg.from, input, profileName, client }));
}

// Dry run for the dashboard's "Test this flow" panel. Returns what WhatsApp WOULD have sent.
async function simulate({ cfg, automation, userId, input, reset = false }) {
  const phone = `sim-${userId}`;
  if (reset) await Session.deleteOne({ admin: cfg.adminId, phone });
  const rec = recorder();
  const client = makeClient(cfg, rec.transport);
  const result = await enqueue(`${cfg.adminId}:${phone}`, () => run({ cfg, phone, input, profileName: 'Simulator', client, simulate: true, automationId: automation._id, previewAutomation: automation.preview ? automation : null }));
  const s = await Session.findOne({ admin: cfg.adminId, phone });
  return { messages: rec.out, finished: !s, state: s ? { step: s.step, ...(s.flow || {}) } : null, handled: result.handled };
}

// Turns a simulator request body into the flat inbound shape the engines read.
//   { text } | { replyId, replyTitle } | { media } | { sampleLocation: true }  (a pin next to the admin's first active outlet)
async function buildSimInput(adminId, b = {}) {
  const input = { type: 'text', text: String(b.text || '').trim(), replyId: '', replyTitle: '', location: null, order: null, media: null };
  if (b.replyId) { input.type = 'interactive'; input.replyId = String(b.replyId); input.replyTitle = String(b.replyTitle || ''); input.text = input.replyTitle; }
  if (b.media) { input.type = 'image'; input.media = { id: 'sim-media', mime: 'image/jpeg', filename: 'photo.jpg', caption: '', kind: 'image' }; }
  if (b.sampleLocation) {
    const br = await Branch.findOne({ admin: adminId, active: true }).sort({ name: 1 });
    input.type = 'location'; input.text = '';
    input.location = br ? { latitude: br.lat + 0.004, longitude: br.lng + 0.004 } : { latitude: 13.0827, longitude: 80.2707 };
  }
  return input;
}

module.exports = { handleMessage, simulate, run, keywordMatch, buildSimInput };
