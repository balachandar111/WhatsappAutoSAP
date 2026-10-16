const mongoose = require('mongoose');
// Product categories shown as rows in the WhatsApp ordering menu (replaces the old hard-coded sweet/kaaram/ghee).
const schema = new mongoose.Schema({
  admin: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true, index: true },
  key: { type: String, required: true, trim: true, lowercase: true, match: /^[a-z0-9-]{1,30}$/ },   // no "_" : used inside WhatsApp reply ids
  label: { type: String, required: true, trim: true, maxlength: 40 },
  emoji: { type: String, default: '', maxlength: 8 },
  description: { type: String, default: '', maxlength: 72 },
  sortOrder: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
}, { timestamps: true });
schema.index({ admin: 1, key: 1 }, { unique: true });
module.exports = mongoose.model('Category', schema);
