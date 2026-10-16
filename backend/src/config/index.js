require('dotenv').config();
const e = process.env;
const isProd = e.NODE_ENV === 'production';

const cfg = {
  isProd,
  PORT: Number(e.PORT) || 5000,
  MONGO_URI: e.MONGO_URI || 'mongodb://127.0.0.1:27017/wa_automation',
  // Browser origins allowed to call the API (comma separated, wildcards like https://*.vercel.app allowed)
  CLIENT_ORIGIN: e.CLIENT_ORIGIN || 'http://localhost:5173',
  // Public HTTPS URL of THIS backend (domain / ngrok). Used to show webhook URLs + serve uploaded images to WhatsApp.
  PUBLIC_URL: (e.PUBLIC_URL || '').replace(/\/+$/, ''),
  JWT_SECRET: e.JWT_SECRET || '',
  JWT_EXPIRES_IN: e.JWT_EXPIRES_IN || '7d',
  // Encrypts every saved credential (WhatsApp token, app secret, Razorpay secrets). Never change after saving secrets.
  ENCRYPTION_KEY: e.ENCRYPTION_KEY || '',
  SUPERADMIN_NAME: e.SUPERADMIN_NAME || 'Super Admin',
  SUPERADMIN_USERNAME: e.SUPERADMIN_USERNAME || 'superadmin',
  SUPERADMIN_PASSWORD: e.SUPERADMIN_PASSWORD || '',
  GRAPH_VERSION: e.GRAPH_VERSION || 'v25.0',
  UPLOAD_DIR: e.UPLOAD_DIR || 'uploads',
  // DEV ONLY: accept webhook calls without an X-Hub-Signature-256 check
  ALLOW_UNSIGNED_WEBHOOKS: e.ALLOW_UNSIGNED_WEBHOOKS === 'true',
};

// Fail fast on a weak/missing secret in production; use dev fallbacks otherwise.
if (isProd) {
  if (!cfg.JWT_SECRET || cfg.JWT_SECRET.length < 24 || cfg.JWT_SECRET.startsWith('put_a_long'))
    throw new Error('JWT_SECRET must be set to a random string of at least 24 characters in production');
  if (!cfg.ENCRYPTION_KEY || cfg.ENCRYPTION_KEY.length < 24 || cfg.ENCRYPTION_KEY.startsWith('put_another'))
    throw new Error('ENCRYPTION_KEY must be set to a random string of at least 24 characters in production');
} else {
  cfg.JWT_SECRET = cfg.JWT_SECRET || 'dev_jwt_secret_change_me';
  cfg.ENCRYPTION_KEY = cfg.ENCRYPTION_KEY || 'dev_encryption_key_change_me';
}
module.exports = cfg;
