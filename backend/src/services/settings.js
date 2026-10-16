const crypto = require('crypto');
const Setting = require('../models/Setting');
const { enc, dec, randomKey, mask } = require('../utils/crypto');
const c = require('../config');

const SECRET_FIELDS = ['waToken', 'appSecret', 'rzpKeySecret', 'rzpWebhookSecret'];
const TEXT_FIELDS = ['appId', 'graphVersion', 'phoneNumberId', 'wabaId', 'catalogId', 'rzpKeyId', 'shopName', 'ownerPhone', 'orderPrefix', 'welcomeMessage'];
const NUM_FIELDS = ['deliveryFee', 'freeDeliveryAbove', 'maxDeliveryKm'];
// fields the WhatsApp test depends on: changing any of them invalidates the last successful test
const WA_CRITICAL = ['waToken', 'appSecret', 'phoneNumberId', 'graphVersion'];

// ---- tiny per-process cache (messages arrive in bursts; settings change rarely) ----
const cache = new Map();            // adminId -> { at, cfg }
const byKey = new Map();            // webhookKey -> adminId
const TTL = 15000;
const invalidate = (adminId) => cache.delete(String(adminId));

const fingerprint = (o) => crypto.createHash('sha256')
  .update([o.waToken, o.phoneNumberId, o.appSecret, o.graphVersion].join('|')).digest('hex');
const rzpFingerprint = (o) => crypto.createHash('sha256').update([o.rzpKeyId, o.rzpKeySecret].join('|')).digest('hex');

async function ensureDoc(adminId) {
  let doc = await Setting.findOne({ admin: adminId });
  if (doc) return doc;
  try {
    doc = await Setting.create({ admin: adminId, webhookKey: randomKey(16), verifyToken: randomKey(12), graphVersion: c.GRAPH_VERSION });
  } catch (e) {
    if (e.code !== 11000) throw e;            // lost a race with a parallel request
    doc = await Setting.findOne({ admin: adminId });
  }
  return doc;
}

function toCfg(doc) {
  const o = doc.toObject();
  const cfg = { adminId: String(o.admin), webhookKey: o.webhookKey, verifyToken: o.verifyToken || '' };
  for (const f of TEXT_FIELDS) cfg[f] = o[f] || '';
  for (const f of NUM_FIELDS) cfg[f] = Number(o[f]) || 0;
  for (const f of SECRET_FIELDS) cfg[f] = (o[f] && dec(o[f])) || '';
  cfg.graphVersion = cfg.graphVersion || c.GRAPH_VERSION;
  cfg.shopName = cfg.shopName || 'Our Store';
  cfg.orderPrefix = (cfg.orderPrefix || 'ORD').toUpperCase();
  cfg.whatsappVerified = !!(o.whatsappVerifiedAt && o.verifiedFingerprint && o.verifiedFingerprint === fingerprint(cfg));
  cfg.whatsappVerifiedAt = o.whatsappVerifiedAt || null;
  cfg.whatsappInfo = o.whatsappInfo || null;
  cfg.razorpayVerified = !!(o.razorpayVerifiedAt && o.razorpayFingerprint && o.razorpayFingerprint === rzpFingerprint(cfg));
  cfg.razorpayVerifiedAt = o.razorpayVerifiedAt || null;
  cfg.webhookSubscribedAt = o.webhookSubscribedAt || null;
  return cfg;
}

async function getSettings(adminId, { fresh = false } = {}) {
  const k = String(adminId);
  const hit = cache.get(k);
  if (!fresh && hit && Date.now() - hit.at < TTL) return hit.cfg;
  const cfg = toCfg(await ensureDoc(adminId));
  cache.set(k, { at: Date.now(), cfg });
  byKey.set(cfg.webhookKey, k);
  return cfg;
}

// Webhooks arrive as /webhook/<webhookKey>; resolve the tenant from the key
async function getSettingsByKey(key) {
  if (!/^[a-f0-9]{16,64}$/i.test(String(key || ''))) return null;
  const doc = await Setting.findOne({ webhookKey: String(key) });
  if (!doc) return null;
  const cfg = toCfg(doc);
  cache.set(String(doc.admin), { at: Date.now(), cfg });
  return cfg;
}

const validators = {
  phoneNumberId: (v) => /^\d{5,25}$/.test(v) || 'Phone Number ID must be digits only (copy it from Meta → WhatsApp → API Setup)',
  wabaId: (v) => /^\d{5,25}$/.test(v) || 'WhatsApp Business Account ID must be digits only',
  appId: (v) => /^\d{5,25}$/.test(v) || 'App ID must be digits only',
  graphVersion: (v) => /^v\d{1,2}\.\d$/.test(v) || 'Graph version must look like v25.0',
  ownerPhone: (v) => /^\d{8,15}$/.test(v) || 'Owner phone must include the country code, digits only (e.g. 919876543210)',
  orderPrefix: (v) => /^[A-Za-z0-9]{1,6}$/.test(v) || 'Order prefix: 1-6 letters/numbers',
};

// Plain fields: sending "" clears them. Secrets: empty / masked value keeps the existing secret; list a field in `clear` to erase it.
async function updateSettings(adminId, patch = {}) {
  const doc = await ensureDoc(adminId);
  const errors = [];
  for (const f of TEXT_FIELDS) {
    if (typeof patch[f] !== 'string') continue;
    let v = patch[f].trim();
    if (f === 'ownerPhone') v = v.replace(/\D/g, '');
    if (v && validators[f]) { const r = validators[f](v); if (r !== true) { errors.push(r); continue; } }
    doc[f] = v;
  }
  for (const f of NUM_FIELDS) {
    if (patch[f] === undefined || patch[f] === '') continue;
    const n = Number(patch[f]);
    if (!Number.isFinite(n) || n < 0) { errors.push(`${f} must be a number ≥ 0`); continue; }
    doc[f] = n;
  }
  for (const f of SECRET_FIELDS) {
    const v = patch[f];
    if (typeof v === 'string' && v.trim() && !v.startsWith('•')) doc[f] = enc(v.trim());
  }
  for (const f of Array.isArray(patch.clear) ? patch.clear : []) if (SECRET_FIELDS.includes(f)) doc[f] = '';
  if (typeof patch.verifyToken === 'string' && patch.verifyToken.trim()) {
    const v = patch.verifyToken.trim();
    if (v.length < 8) errors.push('Verify token must be at least 8 characters');
    else doc.verifyToken = v;
  }
  if (errors.length) return { errors };
  await doc.save();
  invalidate(adminId);
  return { cfg: await getSettings(adminId, { fresh: true }) };
}

async function markWhatsappVerified(adminId, info) {
  const cfg = await getSettings(adminId, { fresh: true });
  await Setting.updateOne({ admin: adminId }, { $set: { verifiedFingerprint: fingerprint(cfg), whatsappVerifiedAt: new Date(), whatsappInfo: info || null } });
  invalidate(adminId);
}
async function clearWhatsappVerified(adminId) {
  await Setting.updateOne({ admin: adminId }, { $set: { whatsappVerifiedAt: null, verifiedFingerprint: '' } });
  invalidate(adminId);
}
async function markRazorpayVerified(adminId) {
  const cfg = await getSettings(adminId, { fresh: true });
  await Setting.updateOne({ admin: adminId }, { $set: { razorpayFingerprint: rzpFingerprint(cfg), razorpayVerifiedAt: new Date() } });
  invalidate(adminId);
}
async function markSubscribed(adminId) {
  await Setting.updateOne({ admin: adminId }, { $set: { webhookSubscribedAt: new Date() } });
  invalidate(adminId);
}

// What the Setup page shows. Secrets are masked and never returned in full.
function publicView(cfg, baseUrl) {
  const root = (c.PUBLIC_URL || baseUrl || '').replace(/\/+$/, '');
  const missing = [];
  if (!cfg.waToken) missing.push('waToken');
  if (!cfg.phoneNumberId) missing.push('phoneNumberId');
  if (!cfg.appSecret) missing.push('appSecret');
  return {
    values: Object.fromEntries([...TEXT_FIELDS, ...NUM_FIELDS, 'verifyToken'].map((k) => [k, cfg[k]])),
    secrets: Object.fromEntries(SECRET_FIELDS.map((k) => [k, mask(cfg[k])])),
    webhook: { url: `${root}/webhook/${cfg.webhookKey}`, verifyToken: cfg.verifyToken, razorpayUrl: `${root}/razorpay-webhook/${cfg.webhookKey}` },
    status: {
      whatsappConfigured: missing.length === 0,
      missing,
      whatsappVerified: cfg.whatsappVerified,
      whatsappVerifiedAt: cfg.whatsappVerifiedAt,
      whatsappInfo: cfg.whatsappInfo,
      webhookSubscribedAt: cfg.webhookSubscribedAt,
      razorpayConfigured: !!(cfg.rzpKeyId && cfg.rzpKeySecret),
      razorpayVerified: cfg.razorpayVerified,
      canBuildFlows: cfg.whatsappVerified,
    },
  };
}

module.exports = {
  getSettings, getSettingsByKey, updateSettings, publicView, invalidate,
  markWhatsappVerified, clearWhatsappVerified, markRazorpayVerified, markSubscribed,
  SECRET_FIELDS, WA_CRITICAL,
};
