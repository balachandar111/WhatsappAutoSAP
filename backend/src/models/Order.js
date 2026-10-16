const mongoose = require('mongoose');
const item = new mongoose.Schema({ code: String, name: String, variant: String, sku: String, price: Number, qty: Number }, { _id: false });
const schema = new mongoose.Schema({
  admin: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true, index: true },
  orderId: { type: String, unique: true, index: true },
  phone: { type: String, index: true },          // customer WhatsApp number (with country code)
  name: String,
  address: String,
  items: [item],
  subtotal: Number,
  deliveryFee: { type: Number, default: 0 },
  amount: Number,                                 // subtotal + deliveryFee
  fulfilment: { type: String, enum: ['delivery', 'pickup'], default: 'delivery', index: true },
  branchCode: { type: String, index: true },
  branchName: String,
  distanceKm: Number,
  location: { lat: Number, lng: Number },
  pickupSlot: String,
  rider: { name: String, phone: String, trackingUrl: String },
  paymentStatus: { type: String, enum: ['pending', 'paid', 'expired'], default: 'pending', index: true },
  status: { type: String, enum: ['new', 'packed', 'ready', 'dispatched', 'delivered', 'cancelled'], default: 'new', index: true },
  paymentLink: String,
  paymentId: String,
  paidAt: Date,
}, { timestamps: true });
schema.index({ admin: 1, createdAt: -1 });
module.exports = mongoose.model('Order', schema);
