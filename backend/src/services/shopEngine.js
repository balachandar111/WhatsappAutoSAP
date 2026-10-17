/*
 Commerce nodes for the flow builder. They run INSIDE a chat flow (flowEngine delegates to this file) and read the admin's
 live data: Categories, Products (with sizes / prices / stock per outlet), Branches, Orders, Razorpay.
 The conversation is the wa-sweet-mern ordering flow, split into builder nodes:

   shop      menu (categories from the Product section + extra rows) -> category -> product -> size -> quantity -> cart
   checkout  name -> delivery / pickup -> location pin -> nearest outlet (radius + stock check) -> address
             (or choose outlet -> pickup slot) -> order summary -> Razorpay payment link
   bulk      occasion list -> what do you need -> needed by -> enquiry saved + owner alert
   track     latest order status of this customer
   outlets   outlet list + map pins

 State: session.step / cart / details / pending (same fields the old ordering bot used) and session.flow
 { lang, node, shop, checkout, bulk, prev }. Nothing here ever trusts a price stored in the session: the cart is re-priced
 from the database when the payment link is created.
*/
const Product = require('../models/Product');
const Category = require('../models/Category');
const Order = require('../models/Order');
const Branch = require('../models/Branch');
const BulkEnquiry = require('../models/BulkEnquiry');
const { createPaymentLink } = require('./razorpay');
const { variantsOf, resolveSku, refreshCart } = require('./catalog');
const { rank, pickupSlots } = require('./geo');
const { newId } = require('../utils/helpers');

const TYPES = ['shop', 'checkout', 'bulk', 'track', 'outlets'];
const isCommerce = (node) => !!node && TYPES.includes(node.nodeType);
const GREETING = /^(hi+|hello|hey|menu|start|vanakkam|hola|namaste)$/i;
const TYPING = ['name', 'location', 'address', 'bulk_details', 'bulk_date', 'qty'];   // free-text steps: words are not commands
const PAGE = 9;

const DEFAULT_OCCASIONS = [
  { key: 'wedding', label: '💍 Wedding' }, { key: 'festival', label: '🪔 Festival gifting' },
  { key: 'corporate', label: '🏢 Corporate' }, { key: 'other', label: '🎉 Other / catering' },
];
const DEFAULT_WELCOME = '🙏 Welcome to *{shop}*!\nWhat would you like to do?';

const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
const total = (cart) => cart.reduce((t, i) => t + i.price * i.qty, 0);
const cartText = (cart) => cart.map((i) => `• ${i.name}${i.variant ? ` (${i.variant})` : ''} × ${i.qty} = ${inr(i.price * i.qty)}`).join('\n');
const feeFor = (cfg, fulfilment, subtotal) => (fulfilment !== 'delivery' ? 0 : (cfg.freeDeliveryAbove && subtotal >= cfg.freeDeliveryAbove ? 0 : cfg.deliveryFee));

/* ------------------------------ state + lookups ------------------------------ */
const fst = (ctx) => (ctx.session.flow = ctx.session.flow && typeof ctx.session.flow === 'object' ? ctx.session.flow : {});
const questions = (ctx) => ctx.flow[fst(ctx).lang]?.questions || {};
const nodeOf = (ctx, key) => (key ? questions(ctx)[key] : undefined);
const findKey = (ctx, type) => Object.keys(questions(ctx)).find((k) => questions(ctx)[k].nodeType === type) || null;
const shopKey = (ctx) => { const f = fst(ctx); return f.shop && nodeOf(ctx, f.shop)?.nodeType === 'shop' ? f.shop : findKey(ctx, 'shop'); };
const shopNode = (ctx) => nodeOf(ctx, shopKey(ctx));
// checkout settings: the checkout node the customer is in (defaults when none, e.g. a catalog cart arrives early)
const checkoutNode = (ctx) => {
  const n = nodeOf(ctx, fst(ctx).checkout) || nodeOf(ctx, shopNode(ctx)?.checkoutNext) || nodeOf(ctx, findKey(ctx, 'checkout')) || {};
  return { allowDelivery: n.allowDelivery !== false, allowPickup: n.allowPickup !== false, askName: n.askName !== false, namePrompt: n.namePrompt, addressPrompt: n.addressPrompt };
};

const save = (ctx) => {
  const s = ctx.session;
  ['cart', 'details', 'pending', 'flow'].forEach((k) => s.markModified(k));
  s.awaitingInput = TYPING.includes(s.step);
};
const fill = (text, ctx) => String(text || '').replace(/\{shop\}/gi, ctx.cfg.shopName || 'our shop');

// names of cart items switched off at this branch
async function missingAt(ctx, cart, branchCode) {
  const ps = await Product.find({ admin: ctx.adminId, code: { $in: cart.map((i) => i.code) } }).select('name unavailableAt');
  return ps.filter((p) => (p.unavailableAt || []).includes(branchCode)).map((p) => p.name);
}

/* ------------------------------ shop: menu, products, cart ------------------------------ */
const catFilter = (ctx, node) => ({ admin: ctx.adminId, active: true, ...(node?.shopCategories?.length ? { key: { $in: node.shopCategories } } : {}) });

async function sendMenu(ctx) {
  const key = shopKey(ctx), node = nodeOf(ctx, key);
  if (!node) { ctx.ended = true; return ctx.W.text(ctx.to, 'Our shop is not available right now. Please try later 🙏'); }
  const s = ctx.session, f = fst(ctx);
  f.shop = key; f.node = key; s.step = 'menu'; save(ctx);
  const cats = await Category.find(catFilter(ctx, node)).sort({ sortOrder: 1, label: 1 });
  const extras = (node.shopExtras || []).filter((x) => x.text);
  const hasCart = s.cart?.length;
  const maxCats = Math.max(10 - extras.length - (hasCart ? 1 : 0), 0);
  const rows = cats.slice(0, maxCats).map((c) => [`cat_${c.key}`, `${c.emoji ? c.emoji + ' ' : ''}${c.label}`, c.description || '']);
  (node.shopExtras || []).forEach((x, i) => { if (x.text) rows.push([`x_${i}`, x.text, x.description || '']); });
  if (hasCart) rows.unshift(['view_cart', `🛒 My cart (${s.cart.reduce((n, i) => n + i.qty, 0)})`, inr(total(s.cart))]);
  if (!rows.length) return ctx.W.text(ctx.to, 'Our menu is empty right now. Please try later 🙏');
  return ctx.W.list(ctx.to, fill(node.text || DEFAULT_WELCOME, ctx), 'Open menu', rows, 'Menu');
}

async function sendProducts(ctx, catKey, page = 0) {
  const node = shopNode(ctx);
  const cat = (await Category.find(catFilter(ctx, node))).find((c) => c.key === catKey);   // only categories this shop node offers
  if (!cat) return sendMenu(ctx);
  const label = `${cat.label}${cat.emoji ? ' ' + cat.emoji : ''}`;
  const only = node?.shopProducts?.length ? { code: { $in: node.shopProducts } } : {};
  const list = await Product.find({ admin: ctx.adminId, category: catKey, available: true, ...only }).sort({ name: 1 });
  if (!list.length) return ctx.W.text(ctx.to, `Sorry, no ${cat.label} items are available right now. Send "hi" to go back.`);

  if (ctx.cfg.catalogId) {                          // WhatsApp catalog available -> native product list
    const items = list.flatMap((p) => variantsOf(p).map((v) => ({ product_retailer_id: v.sku || p.code }))).slice(0, 30);
    return ctx.W.raw({
      to: ctx.to, type: 'interactive',
      interactive: {
        type: 'product_list', header: { type: 'text', text: label.slice(0, 60) },
        body: { text: 'Select items, add to cart and tap *Send* 🛒' },
        action: { catalog_id: ctx.cfg.catalogId, sections: [{ title: label.slice(0, 24), product_items: items }] },
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
  s.step = 'size'; save(ctx);
  const body = `*${p.name}*${p.description ? `\n${p.description}` : ''}\nChoose a size:`;
  if (vs.length <= 3) return ctx.W.buttons(ctx.to, body, vs.map((v, i) => [`var_${p.code}_${i}`, `${v.label} ${inr(v.price)}`]), { image: p.image || undefined });
  return ctx.W.list(ctx.to, body, 'Choose size', vs.slice(0, 10).map((v, i) => [`var_${p.code}_${i}`, v.label, inr(v.price)]), 'Sizes');
}

async function askQty(ctx, v) {
  const s = ctx.session;
  s.pending = { ...s.pending, variant: v.label, price: v.price, sku: v.sku || '' };
  s.step = 'qty'; save(ctx);
  return ctx.W.buttons(ctx.to, `*${s.pending.name}* (${v.label}) — ${inr(v.price)}\nHow many? Tap a quantity or type a number (1-20).`, [['qty_1', '1'], ['qty_2', '2'], ['qty_5', '5']]);
}

async function addToCart(ctx, q) {
  const s = ctx.session;
  if (!s.pending?.code) return sendMenu(ctx);
  const cart = [...s.cart];
  const at = cart.findIndex((i) => i.code === s.pending.code && i.variant === s.pending.variant);
  if (at >= 0) cart[at] = { ...cart[at], qty: Math.min(cart[at].qty + q, 50) };
  else cart.push({ ...s.pending, qty: q });
  s.cart = cart; s.pending = null; s.step = 'menu'; save(ctx);
  return ctx.W.buttons(ctx.to, `Added ✅\n\n${cartText(s.cart)}\n\n*Subtotal: ${inr(total(s.cart))}*`, [['add_more', '➕ Add more'], ['checkout', '🧾 Checkout'], ['cancel', '❌ Cancel']]);
}

// "Checkout" tapped -> the node the shop points to (checkout, or e.g. a form first)
async function goCheckout(ctx, api) {
  if (!ctx.session.cart.length) return sendMenu(ctx);
  const next = shopNode(ctx)?.checkoutNext;
  if (next && nodeOf(ctx, next)) return api.sendNode(ctx, next);
  return askName(ctx);
}

/* ------------------------------ checkout ------------------------------ */
async function askName(ctx) {
  const s = ctx.session, ck = checkoutNode(ctx);
  if (!s.cart.length) return sendMenu(ctx);
  if (s.details?.name) return askFulfilment(ctx);
  if (!ck.askName) { s.details = { ...s.details, name: String(ctx.profileName || 'Customer').slice(0, 60) }; return askFulfilment(ctx); }
  s.step = 'name'; save(ctx);
  return ctx.W.text(ctx.to, `🛒 *Your cart*\n${cartText(s.cart)}\n\n*Subtotal: ${inr(total(s.cart))}*\n\n${ck.namePrompt || 'Please enter your *full name*:'}`);
}

async function askFulfilment(ctx) {
  const s = ctx.session, cfg = ctx.cfg, ck = checkoutNode(ctx);
  if (ck.allowDelivery && !ck.allowPickup) return chooseFulfilment(ctx, 'delivery');
  if (ck.allowPickup && !ck.allowDelivery) return chooseFulfilment(ctx, 'pickup');
  s.step = 'fulfilment'; save(ctx);
  const sub = total(s.cart);
  const fee = feeFor(cfg, 'delivery', sub);
  const feeTxt = fee ? `Delivery charge ${inr(fee)}${cfg.freeDeliveryAbove ? ` (free above ${inr(cfg.freeDeliveryAbove)})` : ''}` : 'Delivery is free';
  return ctx.W.buttons(ctx.to, `Thanks ${s.details.name}! 🙏\nSubtotal: *${inr(sub)}*\n${feeTxt}\n\nHow would you like to receive your order?`,
    [['ful_delivery', '🚚 Home delivery'], ['ful_pickup', '🏬 Self pickup'], ['cancel', '❌ Cancel']]);
}

async function chooseFulfilment(ctx, kind) {
  const s = ctx.session;
  if (kind === 'delivery') {
    s.details = { ...s.details, fulfilment: 'delivery' }; s.step = 'location'; save(ctx);
    return ctx.W.locationRequest(ctx.to, '📍 Please share your *delivery location* so we can route your order to the nearest outlet.\n\n(No location? Just type your area / full address.)');
  }
  s.details = { ...s.details, fulfilment: 'pickup', address: '', lat: undefined, lng: undefined, distanceKm: undefined };
  return askBranch(ctx, 'pickup_branch');
}

// Nearest ACTIVE branch (inside the delivery radius) that stocks every item in the cart
async function routeDelivery(ctx, lat, lng) {
  const s = ctx.session, cfg = ctx.cfg, ck = checkoutNode(ctx);
  const branches = await Branch.find({ admin: ctx.adminId, active: true });
  if (!branches.length) return ctx.W.text(ctx.to, 'Sorry, no outlet is available right now. Please try again later 🙏');
  const ranked = rank(branches, lat, lng);
  const within = cfg.maxDeliveryKm ? ranked.filter((r) => r.d <= cfg.maxDeliveryKm) : ranked;
  if (!within.length) {
    return ctx.W.buttons(ctx.to, `Sorry, you are ${ranked[0].d.toFixed(1)} km from our nearest outlet (${ranked[0].b.name}) — outside our ${cfg.maxDeliveryKm} km delivery area.${ck.allowPickup ? '\nYou can still collect from an outlet.' : ''}`,
      [...(ck.allowPickup ? [['ful_pickup', '🏬 Self pickup']] : []), ['cancel', '❌ Cancel']]);
  }
  let pick = null;
  for (const r of within) if (!(await missingAt(ctx, s.cart, r.b.code)).length) { pick = r; break; }
  if (!pick) {
    const miss = await missingAt(ctx, s.cart, within[0].b.code);
    return ctx.W.buttons(ctx.to, `Sorry, ${miss.join(', ')} is not available at ${within[0].b.name} right now. Please edit your cart or try later.`, [['view_cart', '🛒 Edit cart'], ['cancel', '❌ Cancel']]);
  }
  s.details = { ...s.details, lat, lng, branchCode: pick.b.code, branchName: pick.b.name, distanceKm: Math.round(pick.d * 10) / 10 };
  s.step = 'address'; save(ctx);
  return ctx.W.text(ctx.to, `📍 Nearest outlet: *${pick.b.name}* (${pick.d.toFixed(1)} km)\n\n${ck.addressPrompt || 'Now send your *full delivery address with landmark & pincode*:'}`);
}

// Customer typed an address instead of sharing a pin -> let them pick the outlet
async function askBranch(ctx, step) {
  const s = ctx.session;
  const branches = await Branch.find({ admin: ctx.adminId, active: true }).sort({ name: 1 });
  const ok = [];
  for (const b of branches) if (!(await missingAt(ctx, s.cart, b.code)).length) ok.push(b);
  if (!ok.length) return ctx.W.text(ctx.to, 'Sorry, some items in your cart are not available at any outlet right now. Send "hi" to start again 🙏');
  s.step = step; save(ctx);
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
  s.pending = { slots }; s.step = 'slot'; save(ctx);
  return ctx.W.list(ctx.to, `🏬 *${s.details.branchName}*\nPick a pickup time:`, 'Choose time', slots.map((x, i) => [`slot_${i}`, x.label]), 'Pickup slots');
}

async function sendSummary(ctx) {
  const s = ctx.session, cfg = ctx.cfg;
  const sub = total(s.cart), fee = feeFor(cfg, s.details.fulfilment, sub);
  s.step = 'confirm'; save(ctx);
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
  if (ctx.simulate) {                                       // flow test: never create a real order / payment link
    s.cart = cart; s.step = 'awaiting_payment'; save(ctx);
    return ctx.W.text(ctx.to, `💳 (Test mode) A secure Razorpay link for *${inr(sub + fee)}* would be sent here. No order was created.`);
  }
  const order = await Order.create({
    admin: ctx.adminId, orderId: newId(cfg.orderPrefix), phone: ctx.to, name: d.name, address: d.address, items: cart,
    subtotal: sub, deliveryFee: fee, amount: sub + fee,
    fulfilment: d.fulfilment, branchCode: d.branchCode, branchName: d.branchName, distanceKm: d.distanceKm,
    location: d.lat != null ? { lat: d.lat, lng: d.lng } : undefined, pickupSlot: d.slot || '',
  });
  try {
    order.paymentLink = await createPaymentLink(cfg, order);
    await order.save();
    s.cart = cart; s.step = 'awaiting_payment'; save(ctx);
    return ctx.W.text(ctx.to, `💳 Please pay *${inr(order.amount)}* using this secure link (UPI / cards / netbanking):\n${order.paymentLink}\n\nOrder ID: *${order.orderId}*\nWe'll confirm here as soon as payment is received ✅`);
  } catch (e) {
    console.error('Payment link error:', e.message);
    await Order.deleteOne({ _id: order._id });
    return ctx.W.text(ctx.to, 'Sorry, could not create the payment link. Please try again in a moment.');
  }
}

/* ------------------------------ track + outlets ------------------------------ */
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

async function sendOutlets(ctx, withMaps = true) {
  const list = await Branch.find({ admin: ctx.adminId, active: true }).sort({ name: 1 });
  if (!list.length) return ctx.W.text(ctx.to, 'Outlet details are not available right now. Please try later 🙏');
  const txt = list.map((b) => `📍 *${b.name}*\n${b.address || ''}\n${b.phone ? '📞 ' + b.phone + '\n' : ''}🕘 ${b.openTime} – ${b.closeTime}`).join('\n\n');
  await ctx.W.text(ctx.to, `*Our outlets*\n\n${txt}`);
  if (withMaps) for (const b of list.slice(0, 3)) await ctx.W.location(ctx.to, { lat: b.lat, lng: b.lng, name: b.name, address: b.address });
}

/* ------------------------------ bulk / gifting ------------------------------ */
const occasionsOf = (node) => (node?.bulkOccasions?.length ? node.bulkOccasions : DEFAULT_OCCASIONS);
const DEF_DETAILS = 'Please tell us *what you need* — items, approximate quantity / weight and budget (if any):';
const DEF_DATE = 'When do you need it? (date & time, e.g. "25 Oct evening")';

async function enterBulk(ctx, key, node) {
  const s = ctx.session, f = fst(ctx);
  f.bulk = key; s.step = 'bulk_type'; save(ctx);
  return ctx.W.list(ctx.to, fill(node.text || '🎁 *Bulk, gifting & catering*\nWhat is the occasion?', ctx), 'Choose occasion',
    occasionsOf(node).map((o, i) => [`bo_${i}`, o.label]), 'Occasion');
}

async function finishBulk(ctx, neededBy, api) {
  const s = ctx.session;
  const node = nodeOf(ctx, fst(ctx).bulk);
  const name = s.details?.name || ctx.profileName || 'Customer';
  let id = 'SIMULATED', q = null;
  if (!ctx.simulate) {
    q = await BulkEnquiry.create({ admin: ctx.adminId, enquiryId: newId('BQ'), phone: ctx.to, name, type: s.pending.type, details: s.pending.details, neededBy });
    id = q.enquiryId;
  }
  const done = node?.bulkSuccessText
    ? node.bulkSuccessText.replace(/\{id\}/gi, id).replace(/\{name\}/gi, name)
    : `🎁 Thank you${name !== 'Customer' ? ', ' + name : ''}! Your bulk enquiry *${id}* is received.\nOur team will call/WhatsApp you shortly with a quote.\n\nSend "hi" anytime for the main menu 🙏`;
  s.pending = null;
  await ctx.W.text(ctx.to, done);
  if (q && ctx.cfg.ownerPhone) await ctx.W.text(ctx.cfg.ownerPhone, `🎁 BULK ENQUIRY ${q.enquiryId} (${q.type})\n${q.details}\nNeeded by: ${q.neededBy}\n${name} (+${ctx.to})`);
  if (node?.bulkNext && nodeOf(ctx, node.bulkNext)) { s.step = 'menu'; save(ctx); return api.sendNode(ctx, node.bulkNext); }
  ctx.ended = true;
}

/* ------------------------------ entry from the flow engine ------------------------------ */
// A node of this family was reached (menu tap, "continue to" link, start node ...)
async function enter(ctx, key, node, api) {
  const s = ctx.session, f = fst(ctx);
  switch (node.nodeType) {
    case 'shop': return sendMenu(ctx);
    case 'checkout':
      f.checkout = key;
      if (!s.cart.length) return sendMenu(ctx);
      return askName(ctx);
    case 'bulk': return enterBulk(ctx, key, node);
    case 'track':
    case 'outlets': {
      if (node.nodeType === 'track') await sendTrack(ctx); else await sendOutlets(ctx, node.outletsMaps !== false);
      const next = node.nodeType === 'track' ? node.trackNext : node.outletsNext;
      if (next && nodeOf(ctx, next)) return api.sendNode(ctx, next);
      f.node = (f.prev && nodeOf(ctx, f.prev) && f.prev !== key) ? f.prev : shopKey(ctx);   // stay where the customer was (cart kept)
      s.awaitingInput = TYPING.includes(s.step); save(ctx);
      return undefined;
    }
    default: return undefined;
  }
}

async function restart(ctx, api) {
  const s = ctx.session;
  s.cart = []; s.details = {}; s.pending = null; s.step = 'menu';
  fst(ctx).form = null; save(ctx);
  return api.startNode(ctx);
}

/* ------------------------------ every message while a commerce node is active ------------------------------ */
async function handle(ctx, api) {
  const { input, to: from } = ctx;
  const s = ctx.session, f = fst(ctx);
  const txt = input.type === 'text' ? input.text : '';
  const reply = input.replyId;
  const typing = TYPING.includes(s.step);

  if (GREETING.test(txt)) return restart(ctx, api);

  if (!typing && /^(track|status|my order)$/i.test(txt)) { const k = findKey(ctx, 'track'); return k ? api.sendNode(ctx, k) : sendTrack(ctx); }
  if (!typing && /^(outlets?|branches|address|location)$/i.test(txt)) { const k = findKey(ctx, 'outlets'); return k ? api.sendNode(ctx, k) : sendOutlets(ctx); }
  if (/^cart$/i.test(txt)) return showCart(ctx);

  if (reply === 'cancel') { ctx.ended = true; return ctx.W.text(from, 'Order cancelled. Send "hi" anytime to start again 🙏'); }
  if (reply === 'menu' || reply === 'add_more') return sendMenu(ctx);
  if (reply === 'view_cart') { f.node = shopKey(ctx); return showCart(ctx); }
  if (reply === 'clear_cart') { s.cart = []; s.details = {}; save(ctx); return sendMenu(ctx); }
  if (reply === 'checkout') return goCheckout(ctx, api);

  if (reply?.startsWith('cat_')) { s.step = 'browsing'; save(ctx); return sendProducts(ctx, reply.slice(4), 0); }
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
  if (reply?.startsWith('x_')) {                             // an extra row of the shop menu (Bulk, Track, Outlets, anything)
    const x = shopNode(ctx)?.shopExtras?.[parseInt(reply.slice(2), 10)];
    if (x?.next && nodeOf(ctx, x.next)) return api.sendNode(ctx, x.next);
    return sendMenu(ctx);
  }

  if (reply === 'ful_delivery') return chooseFulfilment(ctx, 'delivery');
  if (reply === 'ful_pickup') return chooseFulfilment(ctx, 'pickup');
  if (reply?.startsWith('br_')) {
    const b = await Branch.findOne({ admin: ctx.adminId, code: reply.slice(3), active: true });
    if (!b || !['pickup_branch', 'branch_pick'].includes(s.step)) return sendMenu(ctx);
    const miss = await missingAt(ctx, s.cart, b.code);
    if (miss.length) return ctx.W.text(from, `${miss.join(', ')} is not available at ${b.name}. Please choose another outlet.`);
    const wasPickup = s.step === 'pickup_branch';
    s.details = { ...s.details, branchCode: b.code, branchName: b.name };
    if (wasPickup) return sendSlots(ctx);
    return sendSummary(ctx);                                 // manual delivery outlet pick (address already typed)
  }
  if (reply?.startsWith('slot_')) {
    const slot = s.pending?.slots?.[parseInt(reply.slice(5), 10)];
    if (!slot) return sendSlots(ctx);
    s.details = { ...s.details, slot: slot.label, address: `Self pickup — ${s.details.branchName}` };
    s.pending = null;
    return sendSummary(ctx);
  }
  if (reply === 'pay') return pay(ctx);

  if (reply?.startsWith('bo_')) {
    const bn = nodeOf(ctx, f.bulk);
    const o = occasionsOf(bn)[parseInt(reply.slice(3), 10)];
    if (!o) return bn ? enterBulk(ctx, f.bulk, bn) : sendMenu(ctx);
    s.pending = { type: o.key }; s.step = 'bulk_details'; save(ctx);
    return ctx.W.text(from, bn?.bulkDetailsPrompt || DEF_DETAILS);
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
    s.cart = cart; f.shop = shopKey(ctx); save(ctx);
    return goCheckout(ctx, api);
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
    case 'location':                                         // typed address instead of a pin
      if (txt.length < 10) return ctx.W.text(from, 'Please share your location pin, or type your complete address with pincode.');
      s.details = { ...s.details, address: txt.slice(0, 300) };
      return askBranch(ctx, 'branch_pick');
    case 'address':
      if (txt.length < 10) return ctx.W.text(from, 'Please send the complete address with pincode.');
      s.details = { ...s.details, address: txt.slice(0, 300) };
      return sendSummary(ctx);
    case 'bulk_details': {
      if (txt.length < 5) return ctx.W.text(from, 'Please describe what you need (items, quantity, budget).');
      s.pending = { ...s.pending, details: txt.slice(0, 500) }; s.step = 'bulk_date'; save(ctx);
      return ctx.W.text(from, nodeOf(ctx, f.bulk)?.bulkDatePrompt || DEF_DATE);
    }
    case 'bulk_date':
      if (txt.length < 2) return ctx.W.text(from, 'Please tell us the required date.');
      return finishBulk(ctx, txt.slice(0, 100), api);
    case 'awaiting_payment':
      return ctx.W.text(from, 'We are waiting for your payment 💳. Use the link above, or send "hi" to start a new order.');
    // the customer typed instead of tapping: repeat the question they are on
    case 'fulfilment': return askFulfilment(ctx);
    case 'confirm': return sendSummary(ctx);
    case 'pickup_branch': case 'branch_pick': return askBranch(ctx, s.step);
    case 'slot': return sendSlots(ctx);
    case 'size': return s.pending?.code ? chooseSize(ctx, s.pending.code) : sendMenu(ctx);
    case 'bulk_type': { const bn = nodeOf(ctx, f.bulk); return bn ? enterBulk(ctx, f.bulk, bn) : sendMenu(ctx); }
    default:
      return sendMenu(ctx);
  }
}

// does this saved flow contain any node that needs Ecommerce operations?
const flowUsesCommerce = (flow) => Object.values(flow || {}).some((lf) => Object.values(lf?.questions || {}).some(isCommerce));

module.exports = { TYPES, isCommerce, enter, handle, findKey, flowUsesCommerce, DEFAULT_OCCASIONS, DEFAULT_WELCOME };
