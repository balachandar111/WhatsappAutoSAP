const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let app, server, base, cleanup;
let sa, a1, a2;           // tokens
const api = async (method, path, { token, body } = {}) => {
  const r = await h.realFetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text() };
};
const lastText = () => { const m = h.sent[h.sent.length - 1]; return m?.text?.body || m?.interactive?.body?.text || ''; };

before(async () => {
  cleanup = await h.connect();
  process.env.SUPERADMIN_PASSWORD = 'SuperPass#1';
  app = require('../src/app');
  await require('../src/seed').ensureSuperAdmin();
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server?.close(); await cleanup?.(); setTimeout(() => process.exit(0), 100).unref(); });

test('login: unified, wrong password rejected', async () => {
  assert.equal((await api('POST', '/api/auth/login', { body: { username: 'superadmin', password: 'nope' } })).status, 401);
  const r = await api('POST', '/api/auth/login', { body: { username: 'superadmin', password: 'SuperPass#1' } });
  assert.equal(r.status, 200); assert.equal(r.body.user.role, 'SUPER_ADMIN');
  sa = r.body.token;
});

test('super admin creates admins; duplicate + weak password rejected; admin cannot use super admin API', async () => {
  let r = await api('POST', '/api/superadmin/admins', { token: sa, body: { name: 'Shop One', username: 'shop1', password: 'Passw0rd!', company: 'One', adminType: 'NORMAL' } });
  assert.equal(r.status, 201); const id1 = r.body.data.id;
  assert.equal((await api('POST', '/api/superadmin/admins', { token: sa, body: { name: 'x', username: 'shop1', password: 'Passw0rd!', adminType: 'NORMAL' } })).status, 400);
  assert.equal((await api('POST', '/api/superadmin/admins', { token: sa, body: { name: 'x', username: 'superadmin', password: 'Passw0rd!', adminType: 'NORMAL' } })).status, 400);
  assert.equal((await api('POST', '/api/superadmin/admins', { token: sa, body: { name: 'x', username: 'weak', password: '123', adminType: 'NORMAL' } })).status, 400);
  assert.equal((await api('POST', '/api/superadmin/admins', { token: sa, body: { name: 'x', username: 'notype', password: 'Passw0rd!' } })).status, 400);   // type is mandatory
  r = await api('POST', '/api/superadmin/admins', { token: sa, body: { name: 'Shop Two', username: 'shop2', password: 'Passw0rd!', adminType: 'ECOMMERCE' } });
  assert.equal(r.status, 201);
  a1 = (await api('POST', '/api/auth/login', { body: { username: 'shop1', password: 'Passw0rd!' } })).body.token;
  a2 = (await api('POST', '/api/auth/login', { body: { username: 'shop2', password: 'Passw0rd!' } })).body.token;
  assert.ok(a1 && a2);
  assert.equal((await api('GET', '/api/superadmin/admins', { token: a1 })).status, 403);
  assert.equal((await api('GET', '/api/superadmin/admins')).status, 401);
  const list = await api('GET', '/api/superadmin/admins', { token: sa });
  assert.equal(list.body.total, 2);
  a1.id = id1;
});

test('deactivate / activate takes effect immediately', async () => {
  const id = (await api('GET', '/api/superadmin/admins?q=shop1', { token: sa })).body.data[0].id;
  let r = await api('POST', `/api/superadmin/admins/${id}/deactivate`, { token: sa });
  assert.equal(r.body.data.status, 'INACTIVE');
  assert.equal((await api('GET', '/api/admin/profile', { token: a1 })).status, 403);             // existing token dies at once
  assert.equal((await api('POST', '/api/auth/login', { body: { username: 'shop1', password: 'Passw0rd!' } })).status, 403);
  r = await api('PATCH', `/api/superadmin/admins/${id}/status`, { token: sa, body: { status: 'ACTIVE' } });
  assert.equal(r.body.data.status, 'ACTIVE');
  assert.equal((await api('GET', '/api/admin/profile', { token: a1 })).status, 200);
});

test('chat flows + automations are locked until setup is saved AND tested', async () => {
  let r = await api('GET', '/api/chatflows', { token: a1 });
  assert.equal(r.status, 412); assert.equal(r.body.code, 'SETUP_REQUIRED');
  assert.equal((await api('POST', '/api/automations', { token: a1, body: {} })).status, 412);

  r = await api('GET', '/api/setup', { token: a1 });
  assert.match(r.body.data.webhook.url, /\/webhook\/[a-f0-9]{32}$/);
  assert.equal(r.body.data.status.canBuildFlows, false);

  // test before saving -> clear message
  assert.equal((await api('POST', '/api/setup/test-whatsapp', { token: a1 })).status, 400);

  r = await api('PUT', '/api/setup', { token: a1, body: { waToken: 'EAAG_TOKEN_1234', phoneNumberId: '1111111111', appSecret: 'secret_one', wabaId: '2222222', ownerPhone: '919000000001', shopName: 'Shop One', orderPrefix: 'S1' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.secrets.waToken, '••••••••1234');           // never returned in full
  assert.equal(r.body.data.status.whatsappVerified, false);
  assert.equal((await api('GET', '/api/chatflows', { token: a1 })).status, 412);   // saved but NOT tested

  h.setGraphMode('fail');
  assert.equal((await api('POST', '/api/setup/test-whatsapp', { token: a1 })).status, 400);
  h.setGraphMode('ok');
  r = await api('POST', '/api/setup/test-whatsapp', { token: a1 });
  assert.equal(r.status, 200); assert.equal(r.body.data.status.whatsappVerified, true);
  assert.equal((await api('GET', '/api/chatflows', { token: a1 })).status, 200);

  // masked value sent back must NOT overwrite the secret, and must not reset the test
  r = await api('PUT', '/api/setup', { token: a1, body: { waToken: '••••••••1234', shopName: 'Shop One!' } });
  assert.equal(r.body.data.status.whatsappVerified, true);
  // changing a credential requires a new test
  await api('PUT', '/api/setup', { token: a1, body: { waToken: 'EAAG_NEW_TOKEN_9999' } });
  assert.equal((await api('GET', '/api/chatflows', { token: a1 })).status, 412);
  await api('POST', '/api/setup/test-whatsapp', { token: a1 });
  assert.equal((await api('GET', '/api/chatflows', { token: a1 })).status, 200);

  // second admin: setup done the same way
  await api('PUT', '/api/setup', { token: a2, body: { waToken: 'EAAG_TOKEN_2222', phoneNumberId: '3333333333', appSecret: 'secret_two' } });
  assert.equal((await api('POST', '/api/setup/test-whatsapp', { token: a2 })).status, 200);
});

let flowId, autoId;
test('chat flow: invalid saves as draft, valid goes live; automation needs a ready flow', async () => {
  let r = await api('POST', '/api/chatflows', { token: a1, body: { name: 'Support', template: 'sample' } });
  assert.equal(r.status, 201); flowId = r.body.data.id;
  assert.equal(r.body.data.status, 'ready');
  const flow = r.body.data.flow;

  // break it: option points to a missing node
  const broken = JSON.parse(JSON.stringify(flow));
  broken.english.questions.Q1.options[0].next = 'NOPE';
  r = await api('PUT', `/api/chatflows/${flowId}/flow`, { token: a1, body: { flow: broken } });
  assert.equal(r.status, 200); assert.equal(r.body.valid, false); assert.match(r.body.errors[0], /missing node "NOPE"/);
  assert.equal(r.body.data.status, 'ready');             // last good copy keeps running
  assert.equal(r.body.data.validation.valid, false);

  r = await api('PUT', `/api/chatflows/${flowId}/flow`, { token: a1, body: { flow } });
  assert.equal(r.body.valid, true); assert.equal(r.body.data.version, 2);

  // another admin cannot see it
  assert.equal((await api('GET', `/api/chatflows/${flowId}`, { token: a2 })).status, 404);

  // draft flow cannot be attached
  const d = await api('POST', '/api/chatflows', { token: a1, body: { name: 'Empty', template: 'empty' } });
  assert.equal((await api('POST', '/api/automations', { token: a1, body: { name: 'x', chatflow: d.body.data.id, isDefault: true } })).status, 400);

  r = await api('POST', '/api/automations', { token: a1, body: { name: 'Support bot', type: 'flow', chatflow: flowId, isDefault: true, keywords: ['Help', 'support'], active: true } });
  assert.equal(r.status, 201); autoId = r.body.data.id;
  assert.deepEqual(r.body.data.trigger.keywords, ['help', 'support']);
  // flow in use cannot be deleted
  assert.equal((await api('DELETE', `/api/chatflows/${flowId}`, { token: a1 })).status, 409);
});

test('simulator walks every node type: menu -> products -> steps -> form (no data saved)', async () => {
  const step = async (b) => (await api('POST', `/api/automations/${autoId}/simulate`, { token: a1, body: b })).body.data;
  let d = await step({ reset: true });
  assert.equal(d.messages[0].interactive.type, 'button');              // 3 options -> reply buttons
  assert.equal(d.messages[0].interactive.action.buttons[0].reply.id, 'o:Q1:0');
  d = await step({ replyId: 'o:Q1:0' });                                // products
  assert.equal(d.messages[0].text.body, 'Here are our best sellers:');
  assert.equal(d.messages[1].interactive.type, 'cta_url');
  assert.equal(d.messages[2].interactive.action.buttons[0].reply.id, 'c:Q2');
  d = await step({ replyId: 'c:Q2' });                                  // back to menu
  d = await step({ replyId: 'o:Q1:1' });                                // steps
  assert.match(d.messages.at(-1).interactive.body.text, /Step 1\/2/);
  d = await step({ replyId: 's:Q3:1' });
  assert.match(d.messages.at(-1).interactive.body.text, /Step 2\/2/);
  d = await step({ replyId: 'sf:Q3' });
  assert.match(d.messages[0].text.body, /All done/);
  d = await step({ replyId: 'c:Q3' }).catch(() => null);
  d = await step({ reset: true });
  d = await step({ replyId: 'o:Q1:2' });                                // form
  assert.match(d.messages.at(-1).text.body, /Your name/);
  d = await step({ text: 'Ravi' });
  d = await step({ text: 'abc' });                                      // bad phone
  assert.match(d.messages[0].text.body, /valid phone/);
  d = await step({ text: '+91 98765-43210' });
  assert.equal(d.messages[0].interactive.type, 'button');               // select -> buttons
  d = await step({ replyId: 'f:topic:0' });                             // "Order" -> conditional field appears
  assert.match(d.messages[0].text.body, /Order ID/);
  d = await step({ text: 'A100' });
  assert.match(d.messages[0].text.body, /Thanks! We will contact you/);
  assert.equal(d.finished, true);
  const subs = await api('GET', '/api/submissions', { token: a1 });
  assert.equal(subs.body.total, 0);                                     // simulator saved nothing
});

test('webhook: signature enforced, other tenants/numbers ignored, real flow run saves a submission', async () => {
  const setup = (await api('GET', '/api/setup', { token: a1 })).body.data;
  const key = setup.webhook.url.split('/').pop();
  // verification handshake
  let r = await h.realFetch(`${base}/webhook/${key}?hub.mode=subscribe&hub.verify_token=${setup.webhook.verifyToken}&hub.challenge=777`);
  assert.equal(await r.text(), '777');
  assert.equal((await h.realFetch(`${base}/webhook/${key}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=777`)).status, 403);

  const post = (payload, secret = 'secret_one', key2 = key) => { const s = h.signed(secret, payload); return h.realFetch(`${base}/webhook/${key2}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': s.sig }, body: s.raw }); };
  const wait = async (fn, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await new Promise((x) => setTimeout(x, 25)); } return false; };

  // bad signature
  const bad = h.signed('wrong_secret', h.inbound('1111111111', '919111111111', h.text('hi')));
  assert.equal((await h.realFetch(`${base}/webhook/${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': bad.sig }, body: bad.raw })).status, 401);

  h.sent.length = 0;
  assert.equal((await post(h.inbound('1111111111', '919111111111', h.text('hello there')))).status, 200);   // default automation answers any first message
  assert.ok(await wait(() => h.sent.length >= 1));
  assert.equal(h.sent[0].to, '919111111111');
  assert.equal(h.sent[0].interactive.action.buttons[2].reply.id, 'o:Q1:2');

  // the SAME message id delivered twice is processed once (compare with a single delivery of an equivalent message)
  const settle = () => new Promise((x) => setTimeout(x, 400));
  let n0 = h.sent.length;
  await post(h.inbound('1111111111', '919111111111', h.text('first try'))); await settle();
  const single = h.sent.length - n0;
  assert.ok(single >= 1);
  const dup = h.inbound('1111111111', '919111111111', h.text('second try')); n0 = h.sent.length;
  await post(dup); await post(dup); await settle();
  assert.equal(h.sent.length - n0, single);

  // message for a phone number id that is not this admin's -> ignored
  const n1 = h.sent.length;
  await post(h.inbound('9999999999', '919222222222', h.text('hi')));
  await new Promise((x) => setTimeout(x, 200));
  assert.equal(h.sent.length, n1);

  // full form through the real webhook
  const say = async (m) => { const n = h.sent.length; await post(h.inbound('1111111111', '919111111111', m)); await wait(() => h.sent.length > n); await new Promise((x) => setTimeout(x, 80)); };
  await say(h.reply('o:Q1:2'));                  // -> form
  await say(h.text('Ravi Kumar'));
  await say(h.text('9876543210'));
  await say(h.reply('f:topic:1', 'Other'));      // "Other": no order id question
  await new Promise((x) => setTimeout(x, 400));
  assert.ok(h.sent.some((m) => /Thanks! We will contact you/.test(m.text?.body || '')));
  const subs = await api('GET', '/api/submissions', { token: a1 });
  assert.equal(subs.body.total, 1);
  assert.deepEqual(subs.body.data[0].answers, { customer_name: 'Ravi Kumar', phone: '9876543210', topic: 'Other' });
  assert.ok(h.sent.some((m) => m.to === '919000000001' && /NEW FORM/.test(m.text?.body || '')));   // owner alerted

  // keyword automation switches + admin 2 sees none of it
  assert.equal((await api('GET', '/api/submissions', { token: a2 })).body.total, 0);
  const csv = await api('GET', '/api/submissions/export.csv', { token: a1 });
  assert.match(csv.body, /Ravi Kumar/);
});

test('deactivated admin: webhook goes silent', async () => {
  const id = (await api('GET', '/api/superadmin/admins?q=shop1', { token: sa })).body.data[0].id;
  const key = (await api('GET', '/api/setup', { token: a1 })).body.data.webhook.url.split('/').pop();
  await api('POST', `/api/superadmin/admins/${id}/deactivate`, { token: sa });
  const n = h.sent.length;
  const s = h.signed('secret_one', h.inbound('1111111111', '919333333333', h.text('hi')));
  const r = await h.realFetch(`${base}/webhook/${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': s.sig }, body: s.raw });
  assert.equal(r.status, 200);
  await new Promise((x) => setTimeout(x, 250));
  assert.equal(h.sent.length, n);
  await api('POST', `/api/superadmin/admins/${id}/activate`, { token: sa });
});

test('commerce: catalogue -> order via WhatsApp -> Razorpay webhook marks paid', async () => {
  const T = a2;
  await api('PUT', '/api/setup', { token: T, body: { rzpKeyId: 'rzp_test_1', rzpKeySecret: 'rzpsecret', rzpWebhookSecret: 'whsecret', ownerPhone: '919000000002', orderPrefix: 'TWO', deliveryFee: 30, freeDeliveryAbove: 500 } });
  assert.equal((await api('POST', '/api/products', { token: T, body: { code: 'p1', name: 'X', category: 'nope', price: 10 } })).status, 400);   // unknown category
  assert.equal((await api('POST', '/api/categories', { token: T, body: { label: 'Sweets', emoji: '🍬' } })).status, 201);
  assert.equal((await api('POST', '/api/products', { token: T, body: { code: 'sw1', name: 'Mysore Pak', category: 'sweets', price: 100, variants: [{ label: '250g', price: 120 }, { label: '500g', price: 230 }] } })).status, 201);
  assert.equal((await api('POST', '/api/branches', { token: T, body: { code: 'b1', name: 'Main', lat: 13.05, lng: 80.22, address: 'Chennai' } })).status, 201);
  // tenant isolation: admin 1 has no products
  assert.equal((await api('GET', '/api/products', { token: a1 })).status, 403);   // shop1 is NORMAL: no ecommerce at all

  const ar = await api('POST', '/api/automations', { token: T, body: { name: 'Store', type: 'commerce', isDefault: true, active: true } });
  assert.equal(ar.status, 201); assert.deepEqual(ar.body.warnings, []);
  assert.equal((await api('POST', '/api/automations', { token: T, body: { name: 'Store 2', type: 'commerce' } })).status, 409);

  const { getSettingsByKey } = require('../src/services/settings');
  const key = (await api('GET', '/api/setup', { token: T })).body.data.webhook.url.split('/').pop();
  const cfg = await getSettingsByKey(key);
  const { processPayload } = require('../src/controllers/webhookController');
  const say = async (m) => { h.sent.length = 0; await processPayload(cfg, h.inbound('3333333333', '919444444444', m, 'Meena')); return h.sent; };

  let out = await say(h.text('hi'));
  const rows = out[0].interactive.action.sections[0].rows.map((x) => x.id);
  assert.ok(rows.includes('cat_sweets') && rows.includes('bulk_start'));
  out = await say(h.reply('cat_sweets'));
  assert.equal(out[0].interactive.action.sections[0].rows[0].id, 'prod_SW1');
  out = await say(h.reply('prod_SW1'));
  assert.equal(out[0].interactive.action.buttons[1].reply.id, 'var_SW1_1');
  out = await say(h.reply('var_SW1_1'));
  out = await say(h.reply('qty_2'));
  assert.match(out[0].interactive.body.text, /₹460/);
  out = await say(h.reply('checkout'));
  out = await say(h.text('Meena S'));
  assert.equal(out[0].interactive.action.buttons[0].reply.id, 'ful_delivery');
  out = await say(h.reply('ful_delivery'));
  assert.equal(out[0].interactive.type, 'location_request_message');
  out = await say({ type: 'location', location: { latitude: 13.06, longitude: 80.23 } });
  assert.match(out[0].text.body, /Nearest outlet: \*Main\*/);
  out = await say(h.text('12 Gandhi Street, T Nagar, Chennai 600017'));
  assert.match(out[0].interactive.body.text, /Total: ₹490/);           // 460 + 30 delivery
  out = await say(h.reply('pay'));
  assert.match(out[0].text.body, /rzp\.io\/i\/test123/);

  const Order = require('../src/models/Order');
  const order = await Order.findOne({ phone: '919444444444' });
  assert.equal(order.amount, 490); assert.match(order.orderId, /^TWO/); assert.equal(order.paymentStatus, 'pending');

  // Razorpay webhook: bad signature rejected, good one marks paid + notifies customer and owner
  const body = { event: 'payment_link.paid', payload: { payment_link: { entity: { reference_id: order.orderId } }, payment: { entity: { id: 'pay_1' } } } };
  const raw = JSON.stringify(body);
  const crypto = require('crypto');
  const url = `${base}/razorpay-webhook/${key}`;
  assert.equal((await h.realFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': 'bad' }, body: raw })).status, 401);
  h.sent.length = 0;
  const ok = await h.realFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': crypto.createHmac('sha256', 'whsecret').update(raw).digest('hex') }, body: raw });
  assert.equal(ok.status, 200);
  await new Promise((x) => setTimeout(x, 400));
  assert.equal((await Order.findById(order._id)).paymentStatus, 'paid');
  assert.ok(h.sent.some((m) => m.to === '919444444444' && /Order Confirmed/.test(m.text.body)));
  assert.ok(h.sent.some((m) => m.to === '919000000002' && /PAID ORDER/.test(m.text.body)));

  // admin updates status -> customer notified; admin 1 cannot touch this order
  const o = (await api('GET', '/api/orders', { token: T })).body.data[0];
  assert.equal((await api('PATCH', `/api/orders/${o._id}/status`, { token: a1, body: { status: 'packed' } })).status, 403);
  h.sent.length = 0;
  const st = await api('PATCH', `/api/orders/${o._id}/status`, { token: T, body: { status: 'packed' } });
  assert.equal(st.body.data.notified, true);
});

test('flow option hand-off to the ordering bot', async () => {
  // admin 2 builds a greeting flow that hands off to commerce
  const flow = { english: { start: 'Q1', questions: { Q1: { nodeType: 'message', text: 'Hi!', options: [{ text: 'Order now', handoff: 'commerce' }, { text: 'Bye', next: 'Q2' }] }, Q2: { nodeType: 'message', text: 'Bye', isEnd: true } } } };
  const f = await api('POST', '/api/chatflows', { token: a2, body: { name: 'Greeter', flow } });
  assert.equal(f.body.data.status, 'ready');
  const a = await api('POST', '/api/automations', { token: a2, body: { name: 'Greeter', chatflow: f.body.data.id, keywords: ['start'], active: true } });
  assert.equal(a.status, 201);
  const { getSettingsByKey } = require('../src/services/settings');
  const key = (await api('GET', '/api/setup', { token: a2 })).body.data.webhook.url.split('/').pop();
  const cfg = await getSettingsByKey(key);
  const { processPayload } = require('../src/controllers/webhookController');
  const say = async (m) => { h.sent.length = 0; await processPayload(cfg, h.inbound('3333333333', '919555555555', m)); return h.sent; };
  let out = await say(h.text('start'));
  assert.equal(out[0].interactive.action.buttons[0].reply.id, 'o:Q1:0');
  out = await say(h.reply('o:Q1:0'));
  assert.equal(out[0].interactive.type, 'list');                         // commerce menu
  assert.ok(out[0].interactive.action.sections[0].rows.some((r) => r.id === 'cat_sweets'));
});

test('super admin delete removes the admin and all their data', async () => {
  const Chatflow = require('../src/models/Chatflow');
  const id = (await api('GET', '/api/superadmin/admins?q=shop2', { token: sa })).body.data[0].id;
  assert.ok(await Chatflow.countDocuments({ admin: id }) > 0);
  assert.equal((await api('DELETE', `/api/superadmin/admins/${id}`, { token: sa })).status, 200);
  assert.equal(await Chatflow.countDocuments({ admin: id }), 0);
  assert.equal((await api('GET', '/api/admin/profile', { token: a2 })).status, 401);
});

test('admin types: NORMAL is locked out of ecommerce; ECOMMERCE gets everything; switching type applies at once', async () => {
  // fresh pair (shop2 was deleted by the previous test)
  const mk = async (username, adminType) => {
    const id = (await api('POST', '/api/superadmin/admins', { token: sa, body: { name: username, username, password: 'Passw0rd!', adminType } })).body.data.id;
    const token = (await api('POST', '/api/auth/login', { body: { username, password: 'Passw0rd!' } })).body.token;
    await api('PUT', '/api/setup', { token, body: { waToken: 'EAAG_TOKEN_' + username, phoneNumberId: String(5000000 + username.length), appSecret: 'sec_' + username } });
    await api('POST', '/api/setup/test-whatsapp', { token });
    return { id, token };
  };
  const n = await mk('normal1', 'NORMAL');
  const e = await mk('ecom01', 'ECOMMERCE');
  assert.equal((await api('GET', '/api/auth/me', { token: n.token })).body.user.features.ecommerce, false);
  assert.equal((await api('GET', '/api/auth/me', { token: e.token })).body.user.features.ecommerce, true);

  for (const path of ['/api/products', '/api/categories', '/api/branches', '/api/orders', '/api/bulk']) {
    const r = await api('GET', path, { token: n.token });
    assert.equal(r.status, 403, path); assert.equal(r.body.code, 'ECOMMERCE_DISABLED');
    assert.equal((await api('GET', path, { token: e.token })).status, 200, path);
  }
  // NORMAL still builds flows + automations
  const f = await api('POST', '/api/chatflows', { token: n.token, body: { name: 'Hello' } });
  assert.equal(f.status, 201);
  assert.equal((await api('POST', '/api/automations', { token: n.token, body: { name: 'Hi bot', chatflow: f.body.data.id, isDefault: true, active: true } })).status, 201);
  // ...but not the ordering bot, nor a flow handing off to it
  assert.equal((await api('POST', '/api/automations', { token: n.token, body: { name: 'Store', type: 'commerce' } })).status, 403);
  const flow = { english: { start: 'Q1', questions: { Q1: { nodeType: 'message', text: 'Hi', options: [{ text: 'Shop', handoff: 'commerce' }] } } } };
  const r = await api('PUT', `/api/chatflows/${f.body.data.id}/flow`, { token: n.token, body: { flow } });
  assert.equal(r.body.valid, false); assert.match(r.body.errors[0], /Ecommerce/);

  // ECOMMERCE admin: ordering bot automation is live; downgrade switches it off and locks the modules
  await api('POST', '/api/categories', { token: e.token, body: { label: 'Sweets' } });
  const a = await api('POST', '/api/automations', { token: e.token, body: { name: 'Store', type: 'commerce', active: true, isDefault: true } });
  assert.equal(a.status, 201);
  assert.equal((await api('PATCH', `/api/superadmin/admins/${e.id}/type`, { token: sa, body: { adminType: 'BOGUS' } })).status, 400);
  assert.equal((await api('PATCH', `/api/superadmin/admins/${e.id}/type`, { token: sa, body: { adminType: 'NORMAL' } })).body.data.adminType, 'NORMAL');
  assert.equal((await api('GET', '/api/products', { token: e.token })).status, 403);
  assert.equal((await api('GET', `/api/automations/${a.body.data.id}`, { token: e.token })).body.data.active, false);
  // upgrade -> works again, data kept
  await api('PATCH', `/api/superadmin/admins/${e.id}/type`, { token: sa, body: { adminType: 'ECOMMERCE' } });
  assert.equal((await api('GET', '/api/categories', { token: e.token })).body.data.length, 1);
  const dash = await api('GET', '/api/superadmin/dashboard', { token: sa });
  assert.ok(dash.body.data.normalAdmins >= 1 && dash.body.data.ecommerceAdmins >= 1);
  assert.equal((await api('GET', '/api/superadmin/admins?adminType=NORMAL', { token: sa })).body.data.every((x) => x.adminType === 'NORMAL'), true);
});
