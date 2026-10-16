// Tiny in-memory rate limiter (single Node process). Use Redis if you scale horizontally.
module.exports = (max, windowMs, keyFn = (req) => req.ip) => {
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, windowMs).unref();
  return (req, res, next) => {
    const k = keyFn(req), now = Date.now();
    const h = hits.get(k) && hits.get(k).reset > now ? hits.get(k) : { n: 0, reset: now + windowMs };
    h.n += 1; hits.set(k, h);
    if (h.n > max) return res.status(429).json({ success: false, message: 'Too many attempts, please try again later.' });
    next();
  };
};
module.exports.counter = (max, windowMs) => {      // non-middleware variant: returns true while under the limit
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, windowMs).unref();
  return (key) => {
    const now = Date.now();
    const h = hits.get(key) && hits.get(key).reset > now ? hits.get(key) : { n: 0, reset: now + windowMs };
    h.n += 1; hits.set(key, h);
    return h.n <= max;
  };
};
