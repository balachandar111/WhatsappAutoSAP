// Creates the first Super Admin (also runs automatically on server start when SUPERADMIN_PASSWORD is set).
const bcrypt = require('bcryptjs');
const SuperAdmin = require('./models/SuperAdmin');
const c = require('./config');

async function ensureSuperAdmin() {
  if (await SuperAdmin.exists({})) return false;
  if (!c.SUPERADMIN_PASSWORD || c.SUPERADMIN_PASSWORD.length < 8) {
    console.warn('No Super Admin exists. Set SUPERADMIN_PASSWORD (min 8 chars) in .env and restart (or run: npm run seed).');
    return false;
  }
  await SuperAdmin.create({ name: c.SUPERADMIN_NAME, username: c.SUPERADMIN_USERNAME.toLowerCase(), password: await bcrypt.hash(c.SUPERADMIN_PASSWORD, 10) });
  console.log(`Super Admin created -> username: ${c.SUPERADMIN_USERNAME}`);
  return true;
}
module.exports = { ensureSuperAdmin };

if (require.main === module) {
  const connectDb = require('./config/db');
  const mongoose = require('mongoose');
  connectDb({ retry: false }).then(ensureSuperAdmin).then(() => mongoose.disconnect()).catch((e) => { console.error(e); process.exit(1); });
}
