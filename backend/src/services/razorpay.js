// Razorpay Payment Links (UPI / cards / netbanking) via plain REST - each admin uses their own keys.
async function rzp(cfg, path, { method = 'GET', body } = {}) {
  if (!cfg.rzpKeyId || !cfg.rzpKeySecret) throw new Error('Razorpay keys are not configured (Setup page)');
  const r = await fetch(`https://api.razorpay.com/v1/${path}`, {
    method,
    headers: { Authorization: 'Basic ' + Buffer.from(`${cfg.rzpKeyId}:${cfg.rzpKeySecret}`).toString('base64'), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error?.description || 'Razorpay error');
  return data;
}

// reference_id = our orderId (the webhook uses it to find the order)
async function createPaymentLink(cfg, order) {
  const data = await rzp(cfg, 'payment_links', {
    method: 'POST',
    body: {
      amount: Math.round(order.amount * 100), currency: 'INR',
      reference_id: order.orderId, description: `Order ${order.orderId}`,
      customer: { name: order.name, contact: `+${order.phone}` },
      notify: { sms: false, email: false }, reminder_enable: false,
      expire_by: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
    },
  });
  return data.short_url;
}

const testRazorpay = async (cfg) => { await rzp(cfg, 'payment_links?count=1'); return true; };
module.exports = { createPaymentLink, testRazorpay };
