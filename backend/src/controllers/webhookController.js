const Admin = require('../models/Admin');
const Order = require('../models/Order');
const Session = require('../models/Session');
const Branch = require('../models/Branch');
const InboundLog = require('../models/InboundLog');
const { getSettingsByKey } = require('../services/settings');
const { makeClient, safe } = require('../services/whatsapp');
const dispatcher = require('../services/dispatcher');
const { parseInbound } = require('../services/inbound');
const { validSig } = require('../utils/crypto');
const c = require('../config');

// Resolves /webhook/:key to { cfg } only if the admin still exists and is ACTIVE
async function tenant(key) {
  const cfg = await getSettingsByKey(key);
  if (!cfg) return null;
  const admin = await Admin.findById(cfg.adminId).select('status');
  return admin && admin.status === 'ACTIVE' ? cfg : null;
}

/* ---- Meta (WhatsApp) ---- */
// GET: Meta's one-time "verify" handshake
exports.verify = async (req, res) => {
  const cfg = await tenant(req.params.key);
  const token = String(req.query['hub.verify_token'] || '').trim();
  if (!cfg || req.query['hub.mode'] !== 'subscribe' || !req.query['hub.challenge'] || !cfg.verifyToken || token !== cfg.verifyToken) return res.sendStatus(403);
  res.status(200).type('text/plain').send(String(req.query['hub.challenge']));
};

// Processes a (verified) webhook payload; exported so tests and tools can await it.
async function processPayload(cfg, body) {
  for (const entry of body?.entry || []) for (const ch of entry.changes || []) {
    const v = ch.value || {};
    if (v.metadata?.phone_number_id && cfg.phoneNumberId && String(v.metadata.phone_number_id) !== String(cfg.phoneNumberId)) continue;   // not this admin's number
    for (const st of v.statuses || []) if (st.status === 'failed') console.error('WhatsApp delivery FAILED:', st.recipient_id, JSON.stringify(st.errors || []));
    const names = Object.fromEntries((v.contacts || []).map((x) => [x.wa_id, x.profile?.name]));
    for (const m of v.messages || []) {
      try {
        // idempotency: Meta may deliver the same message twice
        const input = parseInbound(m);
        await InboundLog.create({ admin: cfg.adminId, wamid: m.id, from: m.from, profileName: names[m.from], type: m.type, text: (input.text || input.replyId || '').slice(0, 300) });
      } catch (e) { if (e.code === 11000) continue; console.error('inbound log error:', e.message); }
      try { await dispatcher.handleMessage({ cfg, msg: m, profileName: names[m.from] }); } catch (e) { console.error('bot error:', e); }
    }
  }
}
exports.processPayload = processPayload;

exports.receive = async (req, res) => {
  const cfg = await tenant(req.params.key);
  if (!cfg) return res.sendStatus(200);                       // unknown / deactivated: acknowledge, do nothing
  if (cfg.appSecret) {
    if (!validSig(req.rawBody, cfg.appSecret, req.get('x-hub-signature-256'), 'sha256=')) return res.sendStatus(401);
  } else if (!c.ALLOW_UNSIGNED_WEBHOOKS) {
    console.warn(`Webhook for admin ${cfg.adminId} rejected: App Secret not saved in Setup`);
    return res.sendStatus(401);
  }
  res.sendStatus(200);                                        // acknowledge fast, work afterwards
  processPayload(cfg, req.body).catch((e) => console.error('webhook processing error:', e));
};

/* ---- Razorpay (one URL per admin: /razorpay-webhook/:key) ---- */
exports.razorpay = async (req, res) => {
  const cfg = await tenant(req.params.key);
  if (!cfg || !validSig(req.rawBody, cfg.rzpWebhookSecret, req.get('x-razorpay-signature'))) return res.sendStatus(401);
  res.sendStatus(200);
  try { await handleRazorpay(cfg, req.body); } catch (e) { console.error('razorpay webhook error:', e); }
};

async function handleRazorpay(cfg, { event, payload }) {
  const link = payload?.payment_link?.entity;
  if (!link) return;
  const order = await Order.findOne({ admin: cfg.adminId, orderId: link.reference_id });
  if (!order) return;
  const W = safe(makeClient(cfg));

  if (event === 'payment_link.paid' && order.paymentStatus !== 'paid') {
    order.paymentStatus = 'paid'; order.paidAt = new Date(); order.paymentId = payload.payment?.entity?.id;
    await order.save();
    await Session.deleteOne({ admin: cfg.adminId, phone: order.phone });

    const items = order.items.map((i) => `• ${i.name}${i.variant ? ` (${i.variant})` : ''} × ${i.qty} = ₹${i.price * i.qty}`).join('\n');
    const where = order.fulfilment === 'pickup' ? `🏬 Pickup: ${order.branchName}${order.pickupSlot ? '\n🕒 ' + order.pickupSlot : ''}` : `🚚 Delivery to:\n${order.address}`;
    await W.text(order.phone, `🎉 *Order Confirmed!* Thank you, ${order.name}.\n\n*Order ${order.orderId}*\n${items}\n${order.deliveryFee ? `Delivery: ₹${order.deliveryFee}\n` : ''}*Paid: ₹${order.amount}*\n\n${where}\n\nWe'll update you here: Packed → ${order.fulfilment === 'pickup' ? 'Ready for pickup' : 'Out for delivery'} → Delivered. Send *track* anytime.`);

    const alert = `🆕 PAID ORDER ${order.orderId} — ${order.fulfilment.toUpperCase()} @ ${order.branchName}\n${items}\nTotal ₹${order.amount}\n${order.name} (+${order.phone})\n${order.address}${order.pickupSlot ? '\nSlot: ' + order.pickupSlot : ''}`;
    const branch = await Branch.findOne({ admin: cfg.adminId, code: order.branchCode });
    for (const t of new Set([cfg.ownerPhone, branch?.alertPhone].filter(Boolean))) await W.text(t, alert);
  }
  if ((event === 'payment_link.expired' || event === 'payment_link.cancelled') && order.paymentStatus === 'pending') {
    order.paymentStatus = 'expired'; await order.save();
  }
}
exports.handleRazorpay = handleRazorpay;
