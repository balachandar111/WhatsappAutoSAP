/*
 Walks the shop / checkout / bulk / track / outlets nodes through the REAL flowEngine + shopEngine, with tiny in-memory stand-ins
 for the Mongoose models (no MongoDB needed):   node --test test/shop.flow.test.js
 Products, categories and branches come from the "database"; nothing is typed into the flow.
*/
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_test_jwt_secret';
process.env.ENCRYPTION_KEY = 'test_encryption_key_test_encryption';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

/* ---------------- in-memory models ---------------- */
const match = (doc, f) => Object.entries(f).every(([k, v]) => {
  let val;
  if (k.includes('.')) { const [a, b] = k.split('.'); val = (doc[a] || []).map((x) => x[b]); } else val = doc[k];
  if (v && typeof v === 'object' && v.$in) return Array.isArray(val) ? val.some((x) => v.$in.includes(x)) : v.$in.includes(val);
  if (k === 'admin') return String(doc.admin) === String(v);
  return Array.isArray(val) ? val.includes(v) : val === v;
});
function model(name) {
  const rows = [];
  let seq = 0;
  const query = (list) => {
    let out = list;
    const q = {
      sort(spec) { const [[k, d]] = Object.entries(spec); out = [...out].sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * d); return q; },
      select() { return q; }, lean() { return q; },
      then(res, rej) { return Promise.resolve(out).then(res, rej); },
    };
    return q;
  };
  const one = (list) => { const q = query(list); q.then = (res, rej) => Promise.resolve(q._first ?? list[0] ?? null).then(res, rej); const s = q.sort; q.sort = (spec) => { s(spec); return Object.assign(q, { then: (res, rej) => query(list).sort(spec).then((x) => res(x[0] ?? null), rej) }); }; return q; };
  const M = {
    rows, modelName: name,
    seed(o) { const d = { _id: `${name}${++seq}`, createdAt: new Date(seq), ...o }; d.save = async () => d; rows.push(d); return d; },
    find: (f = {}) => query(rows.filter((r) => match(r, f))),
    findOne: (f = {}) => one(rows.filter((r) => match(r, f))),
    create: async (o) => M.seed(o),
    deleteOne: async (f) => { const i = rows.findIndex((r) => match(r, f)); if (i >= 0) rows.splice(i, 1); return { deletedCount: i >= 0 ? 1 : 0 }; },
    reset() { rows.length = 0; },
  };
  return M;
}
const M = { Product: model('Product'), Category: model('Category'), Branch: model('Branch'), Order: model('Order'), BulkEnquiry: model('BulkEnquiry'), FlowSubmission: model('FlowSubmission') };
for (const [n, m] of Object.entries(M)) {
  const file = require.resolve(path.join('..', 'src', 'models', n));
  require.cache[file] = { id: file, filename: file, loaded: true, exports: m };
}
// Razorpay is called with global fetch
const calls = [];
global.fetch = async (url, opts = {}) => {
  calls.push({ url: String(url), body: opts.body ? JSON.parse(opts.body) : null });
  return { ok: true, status: 200, json: async () => ({ short_url: 'https://rzp.io/i/test123' }) };
};

const flowEngine = require('../src/services/flowEngine');
const { makeClient, safe } = require('../src/services/whatsapp');
const { sanitizeFlow } = require('../src/services/flowValidator');
const templates = require('../src/services/flowTemplates');

/* ---------------- fixtures ---------------- */
const ADMIN = 'A1';
const cfg = { adminId: ADMIN, shopName: 'Krishna Sweets', deliveryFee: 40, freeDeliveryAbove: 500, maxDeliveryKm: 15, orderPrefix: 'KJ', ownerPhone: '919000000001', catalogId: '', rzpKeyId: 'k', rzpKeySecret: 's' };
function seed() {
  Object.values(M).forEach((m) => m.reset());
  M.Category.seed({ admin: ADMIN, key: 'sweet', label: 'Sweets', emoji: '🍬', description: 'Traditional mithai', sortOrder: 1, active: true });
  M.Category.seed({ admin: ADMIN, key: 'kaaram', label: 'Savories', emoji: '🌶️', description: 'Snacks', sortOrder: 2, active: true });
  M.Category.seed({ admin: ADMIN, key: 'ghee', label: 'Ghee Mithai', emoji: '🧈', description: '', sortOrder: 3, active: true });
  M.Category.seed({ admin: 'OTHER', key: 'secret', label: 'Other admin', emoji: '', sortOrder: 0, active: true });
  M.Product.seed({ admin: ADMIN, code: 'JL', name: 'Jangiri', category: 'sweet', price: 100, unit: '250g', available: true, unavailableAt: [], description: 'Crisp & sweet', image: '',
    variants: [{ label: '250g', price: 100, sku: 'JL250' }, { label: '500g', price: 190, sku: 'JL500' }, { label: '1kg', price: 360, sku: 'JL1K' }] });
  M.Product.seed({ admin: ADMIN, code: 'MY', name: 'Mysore Pak', category: 'sweet', price: 80, unit: '250g', variants: [], available: true, unavailableAt: [] });
  M.Product.seed({ admin: ADMIN, code: 'MIX', name: 'Mixture', category: 'kaaram', price: 60, unit: '250g', variants: [], available: true, unavailableAt: [] });
  M.Product.seed({ admin: ADMIN, code: 'GH', name: 'Ghee Laddu', category: 'ghee', price: 300, unit: '500g', variants: [], available: true, unavailableAt: ['NUN'] });
  M.Product.seed({ admin: ADMIN, code: 'OFF', name: 'Switched off', category: 'sweet', price: 10, unit: '1', variants: [], available: false, unavailableAt: [] });
  M.Branch.seed({ admin: ADMIN, code: 'KOD', name: 'Kodambakkam', address: '1 Main Rd', phone: '044111', lat: 13.05, lng: 80.22, openTime: '00:00', closeTime: '23:59', active: true });
  M.Branch.seed({ admin: ADMIN, code: 'NUN', name: 'Nungambakkam', address: '2 High Rd', phone: '', lat: 13.06, lng: 80.24, openTime: '00:00', closeTime: '23:59', active: true });
}
const flowFor = (lang = 'english') => { const r = sanitizeFlow(templates.shop(lang), { ecommerce: true }); assert.deepEqual(r.errors, []); return r.flow; };

// a chat: sends customer messages through flowEngine like dispatcher.run does
function chat({ flow = flowFor(), simulate = false, phone = '919111111111' } = {}) {
  const out = [];
  const W = safe(makeClient(cfg, async (p) => { out.push(p); return {}; }));
  const session = { phone, flow: {}, step: 'menu', cart: [], details: {}, pending: null, awaitingInput: false, markModified() {} };
  const ctx = { adminId: ADMIN, cfg, W, client: W, to: phone, profileName: 'Ravi', simulate, ended: false, session, flow, automation: { _id: 'auto' }, flowDoc: { _id: 'fd' } };
  const api = {
    out, ctx,
    last: () => out[out.length - 1],
    since: (n) => out.slice(n),
    async start() { await flowEngine.start(ctx); },
    async say(input) { ctx.input = { type: 'text', text: '', replyId: '', replyTitle: '', location: null, order: null, media: null, ...input }; ctx.ended = false; await flowEngine.handle(ctx); },
    text: (t) => api.say({ type: 'text', text: t }),
    tap: (id, title = 'x') => api.say({ type: 'interactive', replyId: id, replyTitle: title, text: title }),
    pin: (latitude, longitude) => api.say({ type: 'location', location: { latitude, longitude } }),
  };
  return api;
}
const body = (p) => p.text?.body || p.interactive?.body?.text || '';
const rows = (p) => p.interactive.action.sections.flatMap((s) => s.rows);
const buttons = (p) => p.interactive.action.buttons.map((b) => b.reply);
const ids = (p) => (p.interactive.type === 'list' ? rows(p).map((r) => r.id) : buttons(p).map((b) => b.id));

/* ---------------- tests ---------------- */
test('the shop template is a valid flow; shop nodes are refused without Ecommerce', () => {
  const ok = sanitizeFlow(templates.shop('english'), { ecommerce: true });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(Object.keys(ok.flow.english.questions), ['Q1', 'Q2', 'Q3', 'Q4', 'Q5']);
  const no = sanitizeFlow(templates.shop('english'), { ecommerce: false });
  assert.ok(no.errors.some((e) => /Ecommerce/.test(e)));
  // a shop without a Checkout target, and an extra row without a target, are errors
  const bad = JSON.parse(JSON.stringify(templates.shop('english')));
  bad.english.questions.Q1.checkoutNext = null; bad.english.questions.Q1.shopExtras[0].next = null;
  const r = sanitizeFlow(bad, { ecommerce: true });
  assert.ok(r.errors.some((e) => /Checkout/.test(e)) && r.errors.some((e) => /must lead to a node/.test(e)));
});

test('menu lists the admin\'s categories from the Product section (not another admin\'s) + the extra rows', async () => {
  seed();
  const c = chat(); await c.start();
  const m = c.last();
  assert.equal(m.interactive.type, 'list');
  assert.match(body(m), /Welcome to \*Krishna Sweets\*/);
  assert.deepEqual(ids(m), ['cat_sweet', 'cat_kaaram', 'cat_ghee', 'x_0', 'x_1', 'x_2']);
  assert.equal(rows(m)[0].title, '🍬 Sweets');
  assert.ok(!ids(m).includes('cat_secret'));
});

test('full delivery order: category -> product -> size -> qty -> cart -> name -> delivery -> pin -> address -> summary -> pay', async () => {
  seed();
  const c = chat(); await c.start();
  await c.tap('cat_sweet');
  let m = c.last();
  assert.deepEqual(ids(m), ['prod_JL', 'prod_MY']);                      // "OFF" (switched off) is not offered
  assert.match(rows(m)[0].description, /From ₹100/);
  assert.match(rows(m)[1].description, /₹80 \/ 250g/);

  await c.tap('prod_JL');
  m = c.last();                                                          // 3 sizes -> reply buttons
  assert.deepEqual(ids(m), ['var_JL_0', 'var_JL_1', 'var_JL_2']);
  assert.match(buttons(m)[1].title, /500g ₹190/);

  await c.tap('var_JL_1');
  assert.deepEqual(ids(c.last()), ['qty_1', 'qty_2', 'qty_5']);
  await c.tap('qty_2');
  assert.match(body(c.last()), /Jangiri \(500g\) × 2 = ₹380/);
  assert.deepEqual(ids(c.last()), ['add_more', 'checkout', 'cancel']);

  await c.tap('add_more');                                               // menu shows the cart row now
  assert.equal(ids(c.last())[0], 'view_cart');
  assert.match(rows(c.last())[0].title, /My cart \(2\)/);
  await c.tap('cat_sweet'); await c.tap('prod_MY');                     // single-size item skips the size question
  assert.deepEqual(ids(c.last()), ['qty_1', 'qty_2', 'qty_5']);
  await c.text('1');                                                     // typed quantity
  assert.match(body(c.last()), /Mysore Pak \(250g\) × 1 = ₹80/);

  await c.tap('checkout');
  assert.match(body(c.last()), /full name/);
  assert.equal(c.ctx.session.awaitingInput, true);
  await c.text('Ravi Kumar');
  assert.match(body(c.last()), /Thanks Ravi Kumar/);
  assert.match(body(c.last()), /Delivery is free|Delivery charge ₹40 \(free above ₹500\)/);
  assert.deepEqual(ids(c.last()), ['ful_delivery', 'ful_pickup', 'cancel']);

  await c.tap('ful_delivery');
  assert.equal(c.last().interactive.type, 'location_request_message');
  await c.pin(13.0601, 80.2401);                                         // next to Nungambakkam
  assert.match(body(c.last()), /Nearest outlet: \*Nungambakkam\*/);
  await c.text('12 Gandhi Street, Nungambakkam, Chennai 600034');
  assert.match(body(c.last()), /Order Summary/);
  assert.match(body(c.last()), /Subtotal: ₹460/);
  assert.match(body(c.last()), /Delivery: ₹40/);
  assert.match(body(c.last()), /Total: ₹500/);

  const n = c.out.length;
  await c.tap('pay');
  assert.equal(M.Order.rows.length, 1);
  const o = M.Order.rows[0];
  assert.equal(o.amount, 500); assert.equal(o.branchCode, 'NUN'); assert.equal(o.fulfilment, 'delivery'); assert.equal(o.admin, ADMIN);
  assert.ok(o.orderId.startsWith('KJ'));
  assert.match(body(c.out[n]), /rzp\.io\/i\/test123/);
  const rz = calls.find((x) => x.url.includes('payment_links'));
  assert.equal(rz.body.amount, 50000);
  assert.equal(c.ctx.session.step, 'awaiting_payment');
  await c.text('hello?');                                                // "hello" style greeting restarts; plain text waits
  c.out.length = 0; await c.text('are you there');
  assert.match(body(c.last()), /waiting for your payment/);
});

test('prices are re-read from the database when paying (a price change after adding to cart is honoured)', async () => {
  seed();
  const c = chat(); await c.start();
  await c.tap('cat_kaaram'); await c.tap('prod_MIX'); await c.tap('qty_2');
  M.Product.rows.find((p) => p.code === 'MIX').price = 70;               // admin edits the price meanwhile
  await c.tap('checkout'); await c.text('Ravi'); await c.tap('ful_pickup');
  await c.tap('br_KOD'); await c.tap('slot_0'); await c.tap('pay');
  assert.equal(M.Order.rows[0].subtotal, 140);
});

test('pickup: only outlets that stock every item are offered, then a time slot', async () => {
  seed();
  const c = chat(); await c.start();
  await c.tap('cat_ghee'); await c.tap('prod_GH'); await c.tap('qty_1');   // Ghee Laddu is out of stock at NUN
  await c.tap('checkout'); await c.text('Ravi');
  await c.tap('ful_pickup');
  assert.deepEqual(ids(c.last()), ['br_KOD']);
  await c.tap('br_NUN');                                                 // an old / forged tap on the other outlet is refused
  assert.match(body(c.last()), /not available at Nungambakkam/);
  await c.tap('br_KOD');
  const slots = ids(c.last());
  assert.ok(slots.length > 0 && slots.every((x) => x.startsWith('slot_')));
  await c.tap('slot_0');
  assert.match(body(c.last()), /Pickup: Kodambakkam/);
  assert.match(body(c.last()), /Delivery: Free/);
});

test('delivery: pin near an outlet that lacks stock falls back to the next outlet; far away -> pickup only', async () => {
  seed();
  const c = chat(); await c.start();
  await c.tap('cat_ghee'); await c.tap('prod_GH'); await c.tap('qty_1'); await c.tap('checkout'); await c.text('Ravi'); await c.tap('ful_delivery');
  await c.pin(13.0601, 80.2401);                                         // nearest is NUN (no stock) -> KOD
  assert.match(body(c.last()), /Nearest outlet: \*Kodambakkam\*/);

  const d = chat(); await d.start();
  await d.tap('cat_sweet'); await d.tap('prod_MY'); await d.tap('qty_1'); await d.tap('checkout'); await d.text('Ravi'); await d.tap('ful_delivery');
  await d.pin(19.07, 72.87);                                             // Mumbai: outside the 15 km radius
  assert.match(body(d.last()), /outside our 15 km delivery area/);
  assert.deepEqual(ids(d.last()), ['ful_pickup', 'cancel']);
});

test('typed address instead of a pin -> customer picks the outlet', async () => {
  seed();
  const c = chat(); await c.start();
  await c.tap('cat_sweet'); await c.tap('prod_MY'); await c.tap('qty_1'); await c.tap('checkout'); await c.text('Ravi'); await c.tap('ful_delivery');
  await c.text('Somewhere near the temple, Chennai 600001');
  assert.deepEqual(ids(c.last()), ['br_KOD', 'br_NUN']);
  await c.tap('br_NUN');
  assert.match(body(c.last()), /Order Summary/);
  assert.match(body(c.last()), /Somewhere near the temple/);
});

test('bulk enquiry through the menu row: occasion -> details -> date -> saved + owner alerted', async () => {
  seed();
  const c = chat(); await c.start();
  await c.tap('x_0');
  assert.deepEqual(ids(c.last()), ['bo_0', 'bo_1', 'bo_2', 'bo_3']);
  await c.tap('bo_0');
  assert.match(body(c.last()), /what you need/);
  await c.text('ok');                                                    // too short
  assert.match(body(c.last()), /describe what you need/);
  await c.text('50 boxes of mixed sweets, budget 20k');
  assert.match(body(c.last()), /When do you need it/);
  const n = c.out.length;
  await c.text('25 Oct evening');
  assert.equal(M.BulkEnquiry.rows.length, 1);
  assert.equal(M.BulkEnquiry.rows[0].type, 'wedding');
  assert.equal(M.BulkEnquiry.rows[0].admin, ADMIN);
  assert.match(body(c.out[n]), /bulk enquiry \*BQ/);
  assert.equal(c.out[n + 1].to, '919000000001');                          // owner alert
  assert.equal(c.ctx.ended, true);
});

test('track + outlets rows; the cart survives them; "hi" starts a fresh cart', async () => {
  seed();
  const c = chat(); await c.start();
  await c.tap('cat_kaaram'); await c.tap('prod_MIX'); await c.tap('qty_1');
  await c.tap('add_more');
  assert.match(rows(c.last())[0].title, /My cart \(1\)/);

  await c.tap('x_1');                                                    // track: none yet
  assert.match(body(c.last()), /No orders found/);
  M.Order.seed({ admin: ADMIN, phone: '919111111111', orderId: 'KJ1', items: [{ name: 'Mixture', variant: '250g', qty: 1, price: 60 }], amount: 60, fulfilment: 'pickup', branchName: 'Kodambakkam', pickupSlot: 'Today 5-6 PM', paymentStatus: 'paid', status: 'packed' });
  await c.tap('x_1');
  assert.match(body(c.last()), /Order KJ1/);
  assert.match(body(c.last()), /Packed/);

  const n = c.out.length;
  await c.tap('x_2');                                                    // outlets text + 2 map pins
  const sent = c.since(n);
  assert.match(body(sent[0]), /Our outlets/);
  assert.equal(sent.filter((p) => p.type === 'location').length, 2);

  await c.text('cart');                                                  // cart is still there
  assert.match(body(c.last()), /Mixture \(250g\) × 1 = ₹60/);

  await c.text('track');                                                 // typed keyword also works
  assert.match(body(c.last()), /Order KJ1/);

  await c.text('hi');
  assert.deepEqual(c.ctx.session.cart, []);
  assert.deepEqual(ids(c.last()), ['cat_sweet', 'cat_kaaram', 'cat_ghee', 'x_0', 'x_1', 'x_2']);
});

test('test mode (flow simulator) never creates orders or enquiries', async () => {
  seed();
  const c = chat({ simulate: true }); await c.start();
  await c.tap('cat_sweet'); await c.tap('prod_MY'); await c.tap('qty_1'); await c.tap('checkout'); await c.text('Ravi'); await c.tap('ful_pickup');
  await c.tap('br_KOD'); await c.tap('slot_0'); await c.tap('pay');
  assert.match(body(c.last()), /Test mode/);
  assert.equal(M.Order.rows.length, 0);
  await c.tap('x_0'); await c.tap('bo_1'); await c.text('lots of sweets please'); await c.text('tomorrow');
  assert.equal(M.BulkEnquiry.rows.length, 0);
});

test('the shop node can be limited to chosen categories / products and rows are capped at 10', async () => {
  seed();
  const f = JSON.parse(JSON.stringify(templates.shop('english')));
  f.english.questions.Q1.shopCategories = ['sweet'];
  f.english.questions.Q1.shopProducts = ['MY'];
  const flow = sanitizeFlow(f, { ecommerce: true }).flow;
  const c = chat({ flow }); await c.start();
  assert.deepEqual(ids(c.last()), ['cat_sweet', 'x_0', 'x_1', 'x_2']);
  await c.tap('cat_sweet');
  assert.deepEqual(ids(c.last()), ['prod_MY']);
  await c.tap('cat_kaaram');                                             // a category the node does not offer is ignored
  assert.deepEqual(ids(c.last()), ['cat_sweet', 'x_0', 'x_1', 'x_2']);
  for (let i = 0; i < 12; i++) M.Category.seed({ admin: ADMIN, key: `c${i}`, label: `Cat ${i}`, sortOrder: 10 + i, active: true });
  const g = chat(); await g.start();
  assert.ok(rows(g.last()).length <= 10);
  assert.deepEqual(ids(g.last()).slice(-3), ['x_0', 'x_1', 'x_2']);      // the extra rows are never cut off
});

test('checkout options: pickup-only skips the delivery question; own name prompt; profile name instead of asking', async () => {
  seed();
  const f = JSON.parse(JSON.stringify(templates.shop('english')));
  Object.assign(f.english.questions.Q2, { allowDelivery: false, askName: false });
  const c = chat({ flow: sanitizeFlow(f, { ecommerce: true }).flow }); await c.start();
  await c.tap('cat_sweet'); await c.tap('prod_MY'); await c.tap('qty_1'); await c.tap('checkout');
  assert.equal(c.ctx.session.details.name, 'Ravi');                      // from the WhatsApp profile name
  assert.equal(c.last().interactive.type, 'list');                       // straight to "Which outlet will you collect from?"
  assert.match(body(c.last()), /collect from/);

  const g = JSON.parse(JSON.stringify(templates.shop('english')));
  g.english.questions.Q2.namePrompt = 'Your name please?';
  const d = chat({ flow: sanitizeFlow(g, { ecommerce: true }).flow }); await d.start();
  await d.tap('cat_sweet'); await d.tap('prod_MY'); await d.tap('qty_1'); await d.tap('checkout');
  assert.match(body(d.last()), /Your name please\?/);
});

test('a catalog cart (WhatsApp order message) is priced from the database and goes to checkout', async () => {
  seed();
  const c = chat(); await c.start();
  await c.say({ type: 'order', order: { product_items: [{ product_retailer_id: 'jl500', quantity: 2, item_price: 1 }, { product_retailer_id: 'NOPE', quantity: 1 }] } });
  assert.deepEqual(c.ctx.session.cart.map((i) => [i.code, i.variant, i.price, i.qty]), [['JL', '500g', 190, 2]]);   // price from DB, not from the message
  assert.match(body(c.last()), /full name/);
});

test('other flow nodes still work next to shop nodes (menu option -> shop; option on a normal message node)', async () => {
  seed();
  const flow = sanitizeFlow({ english: { start: 'A', questions: {
    A: { nodeType: 'message', text: 'Hello!', isEnd: false, options: [{ label: 'A', text: 'Shop now', next: 'S', url: '', handoff: '' }, { label: 'B', text: 'Bye', next: 'Z', url: '', handoff: '' }] },
    S: templates.shop('english').english.questions.Q1,
    Z: { nodeType: 'message', text: 'Bye 👋', isEnd: true, options: [] },
    ...Object.fromEntries(['Q2', 'Q3', 'Q4', 'Q5'].map((k) => [k, templates.shop('english').english.questions[k]])),
  } } }, { ecommerce: true });
  flow.flow.english.questions.S.checkoutNext = 'Q2';
  flow.flow.english.questions.S.shopExtras.forEach((x, i) => { x.next = ['Q3', 'Q4', 'Q5'][i]; });
  const r = sanitizeFlow(flow.flow, { ecommerce: true });
  assert.deepEqual(r.errors, []);
  const c = chat({ flow: r.flow }); await c.start();
  assert.deepEqual(ids(c.last()), ['o:A:0', 'o:A:1']);
  await c.tap('o:A:0');                                                  // -> shop menu
  assert.equal(ids(c.last())[0], 'cat_sweet');
  await c.tap('o:A:1');                                                  // an old button of the first message still works
  assert.match(body(c.last()), /Bye/);
  assert.equal(c.ctx.ended, true);
});
