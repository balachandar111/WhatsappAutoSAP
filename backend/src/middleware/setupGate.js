const { getSettings } = require('../services/settings');
const { HttpError } = require('../utils/http');

// Chat flows and automations are locked until the admin has saved AND successfully tested their WhatsApp credentials.
module.exports = async function requireSetup(req, _res, next) {
  const cfg = await getSettings(req.admin._id);
  if (!cfg.whatsappVerified) {
    const e = new HttpError(412, 'Complete the Setup page first: save your WhatsApp credentials and run "Test WhatsApp" successfully.');
    e.code = 'SETUP_REQUIRED';
    throw e;
  }
  req.cfg = cfg;
  next();
};
