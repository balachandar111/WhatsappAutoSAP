const mongoose = require('mongoose');
// One live chat per (admin, customer phone): which automation owns it and where the customer is.
// Mixed fields: engines call markModified() before save.
const schema = new mongoose.Schema({
  admin: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
  phone: { type: String, required: true },
  automation: { type: mongoose.Schema.Types.ObjectId, ref: 'Automation', default: null },
  kind: { type: String, enum: ['flow', 'commerce', null], default: null },
  profileName: { type: String, default: '' },
  awaitingInput: { type: Boolean, default: false },   // true while the bot expects free text (name, address, form answer…)
  // commerce engine state
  step: { type: String, default: 'menu' },
  cart: { type: [mongoose.Schema.Types.Mixed], default: [] },
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
  pending: { type: mongoose.Schema.Types.Mixed, default: null },
  // flow engine state: { lang, node, form: {...}, stepIdx }
  flow: { type: mongoose.Schema.Types.Mixed, default: {} },
  updatedAt: { type: Date, default: Date.now, index: { expires: 60 * 60 * 24 * 3 } },
}, { minimize: false });
schema.index({ admin: 1, phone: 1 }, { unique: true });
module.exports = mongoose.model('Session', schema);
