const mongoose = require('mongoose');
module.exports = mongoose.model('BulkEnquiry', new mongoose.Schema({
  admin: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true, index: true },
  enquiryId: { type: String, unique: true, index: true },
  phone: String,
  name: String,
  type: { type: String, default: 'other' },      // wedding | festival | corporate | other
  details: String,
  neededBy: String,
  status: { type: String, enum: ['new', 'contacted', 'quoted', 'confirmed', 'closed'], default: 'new', index: true },
  note: { type: String, default: '' },
}, { timestamps: true }));
