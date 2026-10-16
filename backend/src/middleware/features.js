const { HttpError } = require('../utils/http');

const FEATURES = {
  NORMAL: { flows: true, automations: true, ecommerce: false },
  ECOMMERCE: { flows: true, automations: true, ecommerce: true },
};
const featuresOf = (admin) => FEATURES[admin?.adminType] || FEATURES.NORMAL;

// Products, categories, branches, orders, bulk enquiries: only for admins the Super Admin set to ECOMMERCE
function requireEcommerce(req, _res, next) {
  if (!featuresOf(req.admin).ecommerce) {
    const e = new HttpError(403, 'Ecommerce operations are not enabled for your account. Ask the Super Admin to enable them.');
    e.code = 'ECOMMERCE_DISABLED';
    throw e;
  }
  next();
}
module.exports = { requireEcommerce, featuresOf, FEATURES };
