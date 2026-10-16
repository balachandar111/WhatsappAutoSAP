const mongoose = require('mongoose');
const crypto = require('crypto');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_test_jwt_secret';
process.env.ENCRYPTION_KEY = 'test_encryption_key_test_encryption';

const realFetch = global.fetch;
const sent = [];                 // every WhatsApp message the app tried to send
const graphLog = [];             // every other Graph / Razorpay call
let graphMode = 'ok';            // 'ok' | 'fail'
const setGraphMode = (m) => { graphMode = m; };

// Mocks Meta + Razorpay; local HTTP calls pass through
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith('http://127.0.0.1') || u.startsWith('http://localhost')) return realFetch(url, opts);
  const body = opts.body ? JSON.parse(opts.body) : null;
  const json = (status, data) => ({ ok: status < 400, status, json: async () => data, arrayBuffer: async () => Buffer.from('x'), headers: { get: () => 'image/jpeg' } });
  if (u.includes('api.razorpay.com')) {
    graphLog.push({ url: u, body });
    if (u.includes('payment_links') && opts.method === 'POST') return json(200, { short_url: 'https://rzp.io/i/test123' });
    return json(200, { items: [] });
  }
  if (u.includes('/messages')) {
    if (graphMode === 'fail') return json(400, { error: { message: 'bad token', code: 190 } });
    sent.push(body);
    return json(200, { messages: [{ id: 'wamid.out' }] });
  }
  graphLog.push({ url: u, method: opts.method || 'GET', body });
  if (graphMode === 'fail') return json(400, { error: { message: 'Invalid OAuth access token', code: 190 } });
  if (/\/\d+\?fields=/.test(u)) return json(200, { display_phone_number: '+91 98765 43210', verified_name: 'Test Shop', quality_rating: 'GREEN' });
  return json(200, { data: [] });
};

async function connect() {
  let uri = process.env.TEST_MONGO_URI;
  let mem;
  if (!uri) {
    const { MongoMemoryServer } = require('mongodb-memory-server');
    mem = await MongoMemoryServer.create();
    uri = mem.getUri();
  }
  await mongoose.connect(uri, { dbName: 'wa_test_' + crypto.randomBytes(4).toString('hex') });
  return async () => { await mongoose.connection.dropDatabase().catch(() => {}); await mongoose.disconnect(); if (mem) await mem.stop(); };
}

const signed = (secret, payload) => {
  const raw = JSON.stringify(payload);
  return { raw, sig: 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex') };
};

// builds a Cloud-API webhook payload for one customer message
const inbound = (phoneNumberId, from, message, name = 'Ravi') => ({
  object: 'whatsapp_business_account',
  entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: phoneNumberId }, contacts: [{ wa_id: from, profile: { name } }], messages: [{ id: 'wamid.' + crypto.randomBytes(6).toString('hex'), from, timestamp: '1', ...message }] } }] }],
});
const text = (body) => ({ type: 'text', text: { body } });
const reply = (id, title = 'x') => ({ type: 'interactive', interactive: { type: id.startsWith('o:') || true ? 'button_reply' : 'list_reply', button_reply: { id, title } } });

module.exports = { realFetch, sent, graphLog, setGraphMode, connect, signed, inbound, text, reply };
