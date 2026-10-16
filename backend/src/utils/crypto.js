const crypto = require('crypto');
const c = require('../config');

const KEY = crypto.createHash('sha256').update(c.ENCRYPTION_KEY).digest();

// AES-256-GCM:  iv.tag.data  (all base64)
function enc(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const data = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

function dec(payload) {
  try {
    const [iv, tag, data] = String(payload).split('.').map((x) => Buffer.from(x, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(data), d.final()]).toString('utf8');
  } catch {
    return '';
  }
}

const randomKey = (bytes = 18) => crypto.randomBytes(bytes).toString('hex');
const mask = (v) => (v ? '••••••••' + String(v).slice(-4) : '');

// HMAC check used for Meta (sha256=<hex>) and Razorpay (<hex>) webhook signatures
function validSig(raw, secret, header, prefix = '') {
  if (!secret || !header || !raw) return false;
  const expected = prefix + crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const a = Buffer.from(String(header));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { enc, dec, randomKey, mask, validSig };
