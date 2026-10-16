const mongoose = require('mongoose');
const variant = new mongoose.Schema({
  label: { type: String, required: true, trim: true },   // e.g. 250g / 500g / 1kg
  price: { type: Number, required: true, min: 0 },
  sku: { type: String, trim: true, uppercase: true },     // Content ID in the Meta catalog (only if you use a catalog)
}, { _id: false });
const schema = new mongoose.Schema({
  admin: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true, index: true },
  code: { type: String, required: true, trim: true, uppercase: true }, // = Content ID in Meta catalog (single-size items)
  name: { type: String, required: true, trim: true },
  category: { type: String, required: true, trim: true, lowercase: true },  // = Category.key of the same admin
  description: { type: String, default: '' },
  image: { type: String, default: '' },
  price: { type: Number, required: true, min: 0 },
  unit: { type: String, default: 'pack' },
  variants: { type: [variant], default: [] },             // empty = single size (price/unit)
  unavailableAt: { type: [String], default: [] },         // branch codes where this item is out of stock
  available: { type: Boolean, default: true },
}, { timestamps: true });
schema.index({ admin: 1, code: 1 }, { unique: true });
module.exports = mongoose.model('Product', schema);
