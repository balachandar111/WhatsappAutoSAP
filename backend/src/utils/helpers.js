const { digits } = require('./http');

// 10-digit Indian numbers get the 91 prefix; everything else is kept as typed (country code expected)
const normalizePhone = (v) => { const d = digits(v); return d.length === 10 ? '91' + d : d; };
const newId = (p) => `${p}${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
// collapse whitespace + truncate with an ellipsis (WhatsApp has hard length limits on titles/bodies)
const clip = (v, n) => { const t = String(v ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

module.exports = { normalizePhone, newId, clip };
