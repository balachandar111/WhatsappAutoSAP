const mongoose = require('mongoose');
// Every inbound WhatsApp message: gives idempotency (Meta can deliver twice) + a simple conversation log. Auto-purged after 30 days.
const schema = new mongoose.Schema({
  admin: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
  wamid: { type: String, required: true },
  from: { type: String, index: true },
  profileName: String,
  type: String,
  text: String,
  automation: { type: mongoose.Schema.Types.ObjectId, ref: 'Automation' },
  createdAt: { type: Date, default: Date.now, index: { expires: 60 * 60 * 24 * 30 } },
});
schema.index({ admin: 1, wamid: 1 }, { unique: true });
schema.index({ admin: 1, createdAt: -1 });
module.exports = mongoose.model('InboundLog', schema);
