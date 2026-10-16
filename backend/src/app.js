require('express-async-errors');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mongoose = require('mongoose');
const c = require('./config');
const { errorHandler, notFoundHandler } = require('./middleware/error');
const rateLimit = require('./middleware/rateLimit');
const r = require('./routes');
const wh = require('./controllers/webhookController');
const { ROOT: UPLOAD_ROOT } = require('./controllers/uploadController');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// CLIENT_ORIGIN: comma separated, forgiving (quotes / trailing "/"), wildcards like https://*.vercel.app
const clean = (x) => x.trim().replace(/^['"]|['"]$/g, '').replace(/\/+$/, '');
const allowed = c.CLIENT_ORIGIN.split(',').map(clean).filter(Boolean);
const matchers = allowed.map((a) => (a.includes('*') ? new RegExp('^' + a.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^.]+') + '$') : a));
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || matchers.some((m) => (m instanceof RegExp ? m.test(origin) : m === origin))),   // no Origin = server-to-server (Meta, Razorpay) / curl
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
}));

// raw body is kept: needed to verify the Meta + Razorpay signatures
app.use(express.json({ limit: '2mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));

// public: webhooks (one URL per admin) + uploaded images (WhatsApp downloads them from here)
app.get('/webhook/:key', wh.verify);
app.post('/webhook/:key', rateLimit(600, 60 * 1000, (req) => req.params.key), wh.receive);
app.post('/razorpay-webhook/:key', rateLimit(120, 60 * 1000, (req) => req.params.key), wh.razorpay);
app.use('/uploads', express.static(UPLOAD_ROOT, { index: false, dotfiles: 'deny', maxAge: '7d', setHeaders: (res) => res.set('X-Content-Type-Options', 'nosniff') }));
app.get('/health', (_req, res) => res.json({ ok: true, db: mongoose.connection.readyState === 1 ? 'connected' : 'not connected' }));

// API
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/superadmin', require('./routes/superAdminRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/setup', require('./routes/setupRoutes'));
app.use('/api/chatflows', r.chatflows);
app.use('/api/automations', r.automations);
app.use('/api/categories', r.categories);
app.use('/api/products', r.products);
app.use('/api/branches', r.branches);
app.use('/api/orders', r.orders);
app.use('/api/bulk', r.bulk);
app.use('/api/submissions', r.submissions);
app.use('/api/conversations', r.conversations);
app.use('/api/uploads', r.uploads);

app.use(notFoundHandler);
app.use(errorHandler);
module.exports = app;
