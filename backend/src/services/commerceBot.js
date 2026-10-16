/*
 The built-in ordering bot (ported from wa-sweet-mern, now multi-tenant):
 menu -> category -> product -> size -> quantity -> cart -> name -> delivery/pickup -> nearest branch -> address/slot -> Razorpay link,
 plus order tracking, outlet list and bulk/gifting enquiries. Everything is scoped to one admin (ctx.adminId).
*/
const Product = require('../models/Product');
const Category = require('../models/Category');
const Order = require('../models/Order');
const Branch = require('../models/Branch');
const BulkEnquiry = require('../models/BulkEnquiry');
const { createPaymentLink } = require('./razorpay');
const { variantsOf, resolveSku, refreshCart } = require('./catalog');
const { rank, pickupSlots } = require('./geo');
const { newId, clip } = require('../utils/helpers');

const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
const total = (cart) => cart.reduce((t, i) => t + i.price * i.qty, 0);
const cartText = (cart) => cart.map((i) => `• ${i.name}${i.variant ? ` (${i.variant})` : ''} × ${i.qty} = ${inr(i.price * i.qty)}`).join('\n');
const feeFor = (cfg, fulfilment, subtotal) => (fulfilment !== 'delivery' ? 0 : (cfg.freeDeliveryAbove && subtotal >= cfg.freeDeliveryAbove ? 0 : cfg.deliveryFee));
const GREETING = /^(hi+|hello|hey|menu|start|vanakkam|hola|namaste)$/i;
const PAGE = 9;

const save = async (ctx) => {
  const s = ctx.session;
  ['cart', 'details', 'pending'].forEach((k) => s.markModified(k));
  s.awaitingInput = ['name', 'location', 'address', 'bulk_details', 'bulk_date', 'qty'].includes(s.step);
};

// names of cart items switched off at this branch
async function missingAt(ctx, cart, branchCode) {
  const ps = await Product.find({ admin: ctx.adminId, code: { $in: cart.map((i) => i.code) } }).select('name unavailableAt');
  return ps.filter((p) => (p.unavailableAt || []).includes(branchCode)).map((p) => p.name);
}

/* ------------------------------ menus ------------------------------ */
async function sendMenu(ctx) {
  const { cfg, session: s } = ctx;
  const cats = await Category.find({ admin: ctx.adminId, active: true }).sort({ sortOrder: 1, label: 1 });
  const hasCart = s?.cart?.length;
  const maxCats = 10 - 3 - (hasCart ? 1 : 0);
  const rows = cats.slice(0, maxCats).map((c) => [`cat_${c.key}`, `${c.emoji ? c.emoji + ' ' : ''}${c.label}`, c.description || '']);
  rows.push(['bulk_start', '🎁 Bulk & Gifting', 'Weddings, festivals, corporate'], ['track', '📦 Track my order', 'Latest order status'], ['outlets', '📍 Our outlets', 'Address, phone & map']);
  if (hasCart) rows.unshift(['view_cart', `🛒 My cart (${s.cart.reduce((n, i) => n + i.qty, 0)})`, inr(total(s.cart))]);
  const body = cfg.welcomeMessage || `🙏 Welcome to *${cfg.shopName}*!\nWhat would you like to do?`;
  return ctx.W.list(ctx.to, body, 'Open menu', rows, 'Menu');
}

async function sendProducts(ctx, catKey, page = 0) {
  const cat = await Category.findOne({ admin: ctx.adminId, key: catKey, active: true });
  if (!cat) return sendMenu(ctx);
  const label = `${cat.label}${cat.emoji ? ' ' + cat.emoji : ''}`;
  const list = await Product.find({ admin: ctx.adminId, category: catKey, available: true }).sort({ name: 1 });
  if (!list.length) return ctx.W.text(ctx.to, `Sorry, no ${cat.label} items are available right now. Send "hi" to go back.`);

  if (ctx.cfg.catalogId) {
    const items = list.flatMap((p) => variantsOf(p).map((v) => ({ product_retailer_id: v.sku || p.code }))).slice(0, 30);
    return ctx.W.raw({
      to: ctx.to, type: 'interactive',
      interactive: {
        type: 'product_list', header: { type: 'text', text: clip(label, 60) },
        body: { text: 'Select items, add to cart and tap *Send* 🛒' },
        action: { catalog_id: ctx.cfg.catalogId, sections: [{ title: clip(label, 24), product_items: items }] },
      },
    });
  }
  const rows = list.slice(page * PAGE, page * PAGE + PAGE).map((p) => {
    const vs = variantsOf(p);
    const price = vs.length > 1 ? `From ₹${Math.min(...vs.map((v) => v.price))} · ${vs.map((v) => v.label).join(' / ')}` : `₹${vs[0].price} / ${vs[0].label}`;
    return [`prod_${p.code}`, p.name, price];
  });
  if (list.length > (page + 1) * PAGE) rows.push([`more_${catKey}_${page + 1}`, 'More items ➡️', `Page ${page + 2}`]);
  return ctx.W.list(ctx.to, `Our ${label} — choose one:`, 'View items', rows, cat.label);
}

async function sendOutlets(ctx) {
  const list = await Branch.find({ admin: ctx.adminId, active: true }).sort({ name: 1 });
  if (!list.length) return ctx.W.text(ctx.to, 'Outlet details are not available right now. Please try later 🙏');
  const txt = list.map((b) => `📍 *${b.name}*\n${b.address || ''}\n${b.phone ? '📞 ' + b.phone + '\n' : ''}🕘 ${b.openTime} – ${b.closeTime}`).join('\n\n');
  await ctx.W.text(ctx.to, `*Our outlets*\n\n${txt}`);
  for (const b of list.slice(0, 3)) await ctx.W.location(ctx.to, { lat: b.lat, lng: b.lng, name: b.name, address: b.address });
}

const STATUS_LINE = {
  new: '✅ Order confirmed — we are preparing it', packed: '📦 Packed', ready: '🏬 Ready for pickup',
  dispatched: '🚚 Out for delivery', delivered: '🎉 Delivered', cancelled: '❌ Cancelled',
};
async function sendTrack(ctx) {
  const o = await Order.findOne({ admin: ctx.adminId, phone: ctx.to }).sort({ createdAt: -1 });
  if (!o) return ctx.W.text(ctx.to, 'No orders found for this number yet. Send "hi" to place one 🙏');
  let line;
  if (o.paymentStatus === 'expired') line = '⌛ Payment link expired — send "hi" to place the order again';
  else if (o.paymentStatus === 'pending') line = `💳 Payment pending\n${o.paymentLink || ''}`;
  else line = STATUS_LINE[o.status] || o.status;
  const where = o.fulfilment === 'pickup' ? `🏬 Pickup: ${o.branchName}${o.pickupSlot ? ' — ' + o.pickupSlot : ''}` : `🚚 Delivery from ${o.branchName || 'our outlet'}`;
  const rider = o.status === 'dispatched' && o.rider?.name ? `\n🛵 Rider: ${o.rider.name}${o.rider.phone ? ' (' + o.rider.phone + ')' : ''}${o.rider.trackingUrl ? '\n🔗 ' + o.rider.trackingUrl : ''}` : '';
  return ctx.W.text(ctx.to, `*Order ${o.orderId}*\n${cartText(o.items)}\n*Total: ${inr(o.amount)}*\n${where}\n\n*Status:* ${line}${rider}`);
}

/* ------------------------------ ordering ------------------------------ */
async function showCart(ctx) {
  const s = ctx.session;
  if (!s.cart.length) return sendMenu(ctx);
  return ctx.W.buttons(ctx.to, `🛒 *Your cart*\n${cartText(s.cart)}\n\n*Subtotal: ${inr(total(s.cart))}*`,
    [['checkout', '🧾 Checkout'], ['add_more', '➕ Add more'], ['clear_cart', '🗑 Clear cart']]);
}

async function chooseSize(ctx, code) {
  const s = ctx.session;
  const p = await Product.findOne({ admin: ctx.adminId, code, available: true });
  if (!p) return sendMenu(ctx);
  const vs = variantsOf(p);
  s.pending = { code: p.code, name: p.name };
  if (vs.length === 1) return askQty(ctx, vs[0]);
  s.step = 'size'; await save(ctx);
  const body = `*${p.name}*${p.description ? `\n${p.description}` : ''}\nChoose a size:`;
  if (vs.length <= 3) return ctx.W.buttons(ctx.to, body, vs.map((v, i) => [`var_${p.code}_${i}`, `${v.label} ${inr(v.price)}`]), { image: p.image || undefined });
  return ctx.W.list(ctx.to, body, 'Choose size', vs.slice(0, 10).map((v, i) => [`var_${p.code}_${i}`, v.label, inr(v.price)]), 'Sizes');
}

async function askQty(ctx, v) {
  const s = ctx.session;
  s.pending = { ...s.pending, variant: v.label, price: v.price, sku: v.sku || '' };
  s.step = 'qty'; await save(ctx);
  return ctx.W.buttons(ctx.to, `*${s.pending.name}* (${v.label}) — ${inr(v.price)}\nHow many? Tap a quantity or type a number (1-20).`, [['qty_1', '1'], ['qty_2', '2'], ['qty_5', '5']]);
}

async function addToCart(ctx, q) {
  const s = ctx.session;
  if (!s.pending?.code) return sendMenu(ctx);
  const cart = [...s.cart];
  const at = cart.findIndex((i) => i.code === s.pending.code && i.variant === s.pending.variant);
  if (at >= 0) cart[at] = { ...cart[at], qty: Math.min(cart[at].qty + q, 50) };
  else cart.push({ ...s.pending, qty: q });
  s.cart = cart; s.pending = null; s.step = 'menu'; await save(ctx);
  return ctx.W.buttons(ctx.to, `Added ✅\n\n${cartText(s.cart)}\n\n*Subtotal: ${inr(total(s.cart))}*`, [['add_more', '➕ Add more'], ['checkout', '🧾 Checkout'], ['cancel', '❌ Cancel']]);
}

async function askName(ctx) {
  const s = ctx.session;
  if (!s.cart.length) return sendMenu(ctx);
  if (s.details?.name) return askFulfilment(ctx);
  s.step = 'name'; await save(ctx);
  return ctx.W.text(ctx.to, `🛒 *Your cart*\n${cartText(s.cart)}\n\n*Subtotal: ${inr(total(s.cart))}*\n\nPlease enter your *full name*:`);
}

async function askFulfilment(ctx) {
  const s = ctx.session, cfg = ctx.cfg;
  s.step = 'fulfilment'; await save(ctx);
  const sub = total(s.cart);
  const fee = feeFor(cfg, 'delivery', sub);
  const feeTxt = fee ? `Delivery charge ${inr(fee)}${cfg.freeDeliveryAbove ? ` (free above ${inr(cfg.freeDeliveryAbove)})` : ''}` : 'Delivery is free';
  return ctx.W.buttons(ctx.to, `Thanks ${s.details.name}! 🙏\nSubtotal: *${inr(sub)}*\n${feeTxt}\n\nHow would you like to receive your order?`,
    [['ful_delivery', '🚚 Home delivery'], ['ful_pickup', '🏬 Self pickup'], ['cancel', '❌ Cancel']]);
}

// Nearest ACTIVE branch (inside the delivery radius) that stocks every item in the cart
async function routeDelivery(ctx, lat, lng) {
  const s = ctx.session, cfg = ctx.cfg;
  const branches = await Branch.find({ admin: ctx.adminId, active: true });
  if (!branches.length) return ctx.W.text(ctx.to, 'Sorry, no outlet is available right now. Please try again later 🙏');
  const ranked = rank(branches, lat, lng);
  const within = cfg.maxDeliveryKm ? ranked.filter((r) => r.d <= cfg.maxDeliveryKm) : ranked;
  if (!within.length) {
    return ctx.W.buttons(ctx.to, `Sorry, you are ${ranked[0].d.toFixed(1)} km from our nearest outlet (${ranked[0].b.name}) — outside our ${cfg.maxDeliveryKm} km delivery area.\nYou can still collect from an outlet.`,
      [['ful_pickup', '🏬 Self pickup'], ['cancel', '❌ Cancel']]);
  }
  let pick = null;
  for (const r of within) if (!(await missingAt(ctx, s.cart, r.b.code)).length) { pick = r; break; }
  if (!pick) {
    const miss = await missingAt(ctx, s.cart, within[0].b.code);
    return ctx.W.buttons(ctx.to, `Sorry, ${miss.join(', ')} is not available at ${within[0].b.name} right now. Please edit your cart or try later.`, [['view_cart', '🛒 Edit cart'], ['cancel', '❌ Cancel']]);
  }
  s.details = { ...s.details, lat, lng, branchCode: pick.b.code, branchName: pick.b.name, distanceKm: Math.round(pick.d * 10) / 10 };
  s.step = 'address'; await save(ctx);
  return ctx.W.text(ctx.to, `📍 Nearest outlet: *${pick.b.name}* (${pick.d.toFixed(1)} km)\n\nNow send your *full delivery address with landmark & pincode*:`);
}

// Customer typed an address instead of sharing a pin -> let them pick the outlet
async function askBranch(ctx, step) {
  const s = ctx.session;
  const branches = await Branch.find({ admin: ctx.adminId, active: true }).sort({ name: 1 });
  const ok = [];
  for (const b of branches) if (!(await missingAt(ctx, s.cart, b.code)).length) ok.push(b);
  if (!ok.length) return ctx.W.text(ctx.to, 'Sorry, some items in your cart are not available at any outlet right now. Send "hi" to start again 🙏');
  s.step = step; await save(ctx);
  return ctx.W.list(ctx.to, step === 'pickup_branch' ? 'Which outlet will you collect from?' : 'Which outlet is nearest to you?', 'Choose outlet', ok.map((b) => [`br_${b.code}`, b.name, b.address]), 'Outlets');
}

async function sendSlots(ctx) {
  const s = ctx.session;
  const branch = await Branch.findOne({ admin: ctx.adminId, code: s.details.branchCode });
  const slots = pickupSlots(branch);
  if (!slots.length) {
    s.details = { ...s.details, slot: '', address: `Self pickup — ${s.details.branchName}` };
    return sendSummary(ctx);
  }
  s.pending = { slots }; s.step = 'slot'; await save(ctx);
  return ctx.W.list(ctx.to, `🏬 *${s.details.branchName}*\nPick a pickup time:`, 'Choose time', slots.map((x, i) => [`slot_${i}`, x.label]), 'Pickup slots');
}

async function sendSummary(ctx) {
  const s = ctx.session, cfg = ctx.cfg;
  const sub = total(s.cart), fee = feeFor(cfg, s.details.fulfilment, sub);
  s.step = 'confirm'; await save(ctx);
  const where = s.details.fulfilment === 'pickup'
    ? `🏬 Pickup: ${s.details.branchName}${s.details.slot ? '\n🕒 ' + s.details.slot : ''}`
    : `📍 ${s.details.address}\n🏬 From: ${s.details.branchName}${s.details.distanceKm != null ? ` (${s.details.distanceKm} km)` : ''}`;
  return ctx.W.buttons(ctx.to, `📋 *Order Summary*\n${cartText(s.cart)}\n\nSubtotal: ${inr(sub)}\nDelivery: ${fee ? inr(fee) : 'Free'}\n*Total: ${inr(sub + fee)}*\n\n👤 ${s.details.name}\n${where}\n\nConfirm and pay?`,
    [['pay', '✅ Pay Now'], ['cancel', '❌ Cancel']]);
}

async function pay(ctx) {
  const s = ctx.session, cfg = ctx.cfg;
  const cart = await refreshCart(ctx.adminId, s.cart || []);
  if (!cart.length || !s.details.name || !s.details.branchCode) return sendMenu(ctx);
  const d = s.details, sub = total(cart), fee = feeFor(cfg, d.fulfilment, sub);
  const order = await Order.create({
    admin: ctx.adminId, orderId: newId(cfg.orderPrefix), phone: ctx.to, name: d.name, address: d.address, items: cart,
    subtotal: sub, deliveryFee: fee, amount: sub + fee,
    fulfilment: d.fulfilment, branchCode: d.branchCode, branchName: d.branchName, distanceKm: d.distanceKm,
    location: d.lat != null ? { lat: d.lat, lng: d.lng } : undefined, pickupSlot: d.slot || '',
  });
  try {
    order.paymentLink = await createPaymentLink(cfg, order);
    await order.save();
    s.cart = cart; s.step = 'awaiting_payment'; await save(ctx);
    return ctx.W.text(ctx.to, `💳 Please pay *${inr(order.amount)}* using this secure link (UPI / cards / netbanking):\n${order.paymentLink}\n\nOrder ID: *${order.orderId}*\nWe'll confirm here as soon as payment is received ✅`);
  } catch (e) {
    console.error('Payment link error:', e.message);
    await Order.deleteOne({ _id: order._id });
    return ctx.W.text(ctx.to, 'Sorry, could not create the payment link. Please try again in a moment.');
  }
}

/* ------------------------------ bulk / gifting ------------------------------ */
const BULK = { bulk_wedding: 'wedding', bulk_festival: 'festival', bulk_corporate: 'corporate', bulk_other: 'other' };

async function finishBulk(ctx, neededBy) {
  const s = ctx.session;
  const name = s.details?.name || ctx.profileName || 'Customer';
  const q = await BulkEnquiry.create({ admin: ctx.adminId, enquiryId: newId('BQ'), phone: ctx.to, name, type: s.pending.type, details: s.pending.details, neededBy });
  ctx.ended = true;
  await ctx.W.text(ctx.to, `🎁 Thank you${name !== 'Customer' ? ', ' + name : ''}! Your bulk enquiry *${q.enquiryId}* is received.\nOur team will call/WhatsApp you shortly with a quote.\n\nSend "hi" anytime for the main menu 🙏`);
  if (ctx.cfg.ownerPhone) await ctx.W.text(ctx.cfg.ownerPhone, `🎁 BULK ENQUIRY ${q.enquiryId} (${q.type})\n${q.details}\nNeeded by: ${q.neededBy}\n${name} (+${ctx.to})`);
}

/* ------------------------------ entry points ------------------------------ */
async function start(ctx) {
  const s = ctx.session;
  s.step = 'menu'; s.cart = []; s.details = {}; s.pending = null;
  await save(ctx);
  return sendMenu(ctx);
}

async function handle(ctx) {
  const { input, to: from } = ctx;
  const s = ctx.session;
  const txt = input.type === 'text' ? input.text : '';
  const reply = input.replyId;

  if (GREETING.test(txt)) return start(ctx);

  const typing = ['name', 'location', 'address', 'bulk_details', 'bulk_date', 'qty'].includes(s.step); // free-text steps: words are not commands
  if (!typing && /^(track|status|my order)$/i.test(txt)) return sendTrack(ctx);
  if (!typing && /^(outlets?|branches|address|location)$/i.test(txt)) return sendOutlets(ctx);
  if (/^cart$/i.test(txt)) return showCart(ctx);

  if (reply === 'cancel') { ctx.ended = true; return ctx.W.text(from, 'Order cancelled. Send "hi" anytime to start again 🙏'); }
  if (reply === 'menu' || reply === 'add_more') return sendMenu(ctx);
  if (reply === 'track') return sendTrack(ctx);
  if (reply === 'outlets') return sendOutlets(ctx);
  if (reply === 'view_cart') return showCart(ctx);
  if (reply === 'clear_cart') { s.cart = []; s.details = {}; await save(ctx); return sendMenu(ctx); }
  if (reply === 'checkout') return askName(ctx);

  if (reply?.startsWith('cat_')) {
    s.step = 'browsing'; await save(ctx);
    return sendProducts(ctx, reply.slice(4), 0);
  }
  if (reply?.startsWith('more_')) { const [, cat, pg] = reply.split('_'); return sendProducts(ctx, cat, parseInt(pg, 10) || 0); }
  if (reply?.startsWith('prod_')) return chooseSize(ctx, reply.slice(5));
  if (reply?.startsWith('var_')) {
    const cut = reply.lastIndexOf('_');
    const p = await Product.findOne({ admin: ctx.adminId, code: reply.slice(4, cut), available: true });
    const v = p && variantsOf(p)[parseInt(reply.slice(cut + 1), 10)];
    if (!v) return sendMenu(ctx);
    s.pending = { code: p.code, name: p.name };
    return askQty(ctx, v);
  }
  if (reply?.startsWith('qty_')) return addToCart(ctx, parseInt(reply.slice(4), 10) || 1);

  if (reply === 'ful_delivery') {
    s.details = { ...s.details, fulfilment: 'delivery' }; s.step = 'location'; await save(ctx);
    return ctx.W.locationRequest(from, '📍 Please share your *delivery location* so we can route your order to the nearest outlet.\n\n(No location? Just type your area / full address.)');
  }
  if (reply === 'ful_pickup') {
    s.details = { ...s.details, fulfilment: 'pickup', address: '', lat: undefined, lng: undefined, distanceKm: undefined };
    return askBranch(ctx, 'pickup_branch');
  }
  if (reply?.startsWith('br_')) {
    const b = await Branch.findOne({ admin: ctx.adminId, code: reply.slice(3), active: true });
    if (!b || !['pickup_branch', 'branch_pick'].includes(s.step)) return sendMenu(ctx);
    const miss = await missingAt(ctx, s.cart, b.code);
    if (miss.length) return ctx.W.text(from, `${miss.join(', ')} is not available at ${b.name}. Please choose another outlet.`);
    const wasPickup = s.step === 'pickup_branch';
    s.details = { ...s.details, branchCode: b.code, branchName: b.name };
    if (wasPickup) return sendSlots(ctx);
    return sendSummary(ctx);            // manual delivery outlet pick (address already typed)
  }
  if (reply?.startsWith('slot_')) {
    const slot = s.pending?.slots?.[parseInt(reply.slice(5), 10)];
    if (!slot) return sendSlots(ctx);
    s.details = { ...s.details, slot: slot.label, address: `Self pickup — ${s.details.branchName}` };
    s.pending = null;
    return sendSummary(ctx);
  }
  if (reply === 'pay') return pay(ctx);

  if (reply === 'bulk_start') {
    s.step = 'bulk_type'; await save(ctx);
    return ctx.W.list(from, '🎁 *Bulk, gifting & catering*\nWhat is the occasion?', 'Choose occasion', [
      ['bulk_wedding', '💍 Wedding'], ['bulk_festival', '🪔 Festival gifting'], ['bulk_corporate', '🏢 Corporate'], ['bulk_other', '🎉 Other / catering'],
    ], 'Occasion');
  }
  if (BULK[reply]) {
    s.pending = { type: BULK[reply] }; s.step = 'bulk_details'; await save(ctx);
    return ctx.W.text(from, 'Please tell us *what you need* — items, approximate quantity / weight and budget (if any):');
  }

  // Cart sent from the WhatsApp catalog
  if (input.type === 'order') {
    const cart = [];
    for (const it of input.order?.product_items || []) {
      const hit = await resolveSku(ctx.adminId, it.product_retailer_id);
      const qty = Math.min(Math.max(parseInt(it.quantity, 10) || 0, 0), 50);
      if (hit && qty) cart.push({ code: hit.product.code, name: hit.product.name, variant: hit.variant.label, sku: hit.variant.sku || '', price: hit.variant.price, qty }); // price ALWAYS from DB
    }
    if (!cart.length) return ctx.W.text(from, 'Could not read your cart (items may be unavailable). Please try again.');
    s.cart = cart; await save(ctx);
    return askName(ctx);
  }

  // Customer shared a location pin
  if (input.type === 'location' && s.step === 'location') {
    const { latitude, longitude } = input.location || {};
    if (typeof latitude !== 'number' || typeof longitude !== 'number') return ctx.W.text(from, 'Could not read that location. Please try again or type your address.');
    return routeDelivery(ctx, latitude, longitude);
  }

  switch (s.step) {
    case 'qty': {
      const q = parseInt(txt, 10);
      if (!(q >= 1 && q <= 20)) return ctx.W.text(from, 'Please enter a number between 1 and 20.');
      return addToCart(ctx, q);
    }
    case 'name':
      if (txt.length < 2) return ctx.W.text(from, 'Please enter a valid name.');
      s.details = { ...s.details, name: txt.slice(0, 60) };
      return askFulfilment(ctx);
    case 'location':                       // typed address instead of a pin
      if (txt.length < 10) return ctx.W.text(from, 'Please share your location pin, or type your complete address with pincode.');
      s.details = { ...s.details, address: txt.slice(0, 300) };
      return askBranch(ctx, 'branch_pick');
    case 'address':
      if (txt.length < 10) return ctx.W.text(from, 'Please send the complete address with pincode.');
      s.details = { ...s.details, address: txt.slice(0, 300) };
      return sendSummary(ctx);
    case 'bulk_details':
      if (txt.length < 5) return ctx.W.text(from, 'Please describe what you need (items, quantity, budget).');
      s.pending = { ...s.pending, details: txt.slice(0, 500) }; s.step = 'bulk_date'; await save(ctx);
      return ctx.W.text(from, 'When do you need it? (date & time, e.g. "25 Oct evening")');
    case 'bulk_date':
      if (txt.length < 2) return ctx.W.text(from, 'Please tell us the required date.');
      return finishBulk(ctx, txt.slice(0, 100));
    case 'awaiting_payment':
      return ctx.W.text(from, 'We are waiting for your payment 💳. Use the link above, or send "hi" to start a new order.');
    default:
      return sendMenu(ctx);
  }
}

module.exports = { start, handle, sendMenu, sendTrack, sendOutlets };
