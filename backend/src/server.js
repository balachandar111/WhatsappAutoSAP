const app = require('./app');
const c = require('./config');
const connectDb = require('./config/db');
const { ensureSuperAdmin } = require('./seed');

// Listen first so /health answers (and the host sees the service as up) even if MongoDB is slow.
app.listen(c.PORT, () => console.log(`WhatsApp automation API on :${c.PORT}`));
connectDb().then(ensureSuperAdmin).catch((e) => console.error(e));

process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e));
