const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  admin: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true, index: true },
  code: { type: String, required: true, trim: true, uppercase: true },
  name: { type: String, required: true, trim: true },
  address: { type: String, default: '' },
  phone: { type: String, default: '' },          // shown to customers
  alertPhone: { type: String, default: '' },     // WhatsApp alert for this branch's paid orders (country code, digits)
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  openTime: { type: String, default: '09:00' },  // pickup slots are generated inside this window (IST)
  closeTime: { type: String, default: '21:00' },
  active: { type: Boolean, default: true },
}, { timestamps: true });
schema.index({ admin: 1, code: 1 }, { unique: true });
module.exports = mongoose.model('Branch', schema);
