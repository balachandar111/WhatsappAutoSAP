const mongoose = require('mongoose');
// One document per admin. Secret fields are stored AES-256-GCM encrypted (see utils/crypto.js).
const S = String;
module.exports = mongoose.model('Setting', new mongoose.Schema({
  admin: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true, unique: true },

  // Public id used in this admin's webhook URLs: /webhook/<webhookKey>
  webhookKey: { type: S, required: true, unique: true, index: true },

  // WhatsApp Cloud API
  appId: S, graphVersion: S,
  phoneNumberId: S, wabaId: S, catalogId: S,
  verifyToken: S,                      // you paste this into Meta's "Verify token" box
  waToken: S, appSecret: S,            // encrypted

  // Razorpay (only needed by the commerce automation)
  rzpKeyId: S, rzpKeySecret: S, rzpWebhookSecret: S, // last two encrypted

  // Business / commerce defaults
  shopName: S, ownerPhone: S, orderPrefix: S, welcomeMessage: S,
  deliveryFee: { type: Number, default: 0 },
  freeDeliveryAbove: { type: Number, default: 0 },
  maxDeliveryKm: { type: Number, default: 0 },

  // Test results. whatsappVerified is only trusted while verifiedFingerprint still matches the saved credentials,
  // so editing the token / phone number / app secret automatically requires a fresh test.
  verifiedFingerprint: S,
  whatsappVerifiedAt: Date,
  whatsappInfo: { type: mongoose.Schema.Types.Mixed, default: null },
  razorpayFingerprint: S,
  razorpayVerifiedAt: Date,
  webhookSubscribedAt: Date,
}, { timestamps: true, minimize: false }));
