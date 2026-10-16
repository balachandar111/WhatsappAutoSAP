const mongoose = require('mongoose');
// A tenant. Created by the Super Admin. Has full access to every module once ACTIVE.
// Setup credentials live in the Setting model (one per admin).
module.exports = mongoose.model('Admin', new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  company: { type: String, default: '', trim: true },
  username: { type: String, required: true, unique: true, trim: true, lowercase: true },
  email: { type: String, default: '', lowercase: true, trim: true },
  phone: { type: String, default: '', trim: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['ADMIN'], default: 'ADMIN' },
  // Set by the Super Admin:
  //   NORMAL    -> Setup + chat flows + automations (flow type)
  //   ECOMMERCE -> everything NORMAL has + categories, products, branches, orders, bulk enquiries + the ordering-bot automation
  adminType: { type: String, enum: ['NORMAL', 'ECOMMERCE'], default: 'NORMAL', index: true },
  status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE', index: true },
  statusChangedAt: Date,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'SuperAdmin' },
  lastLoginAt: Date,
  passwordChangedAt: Date,        // tokens issued before this are rejected
}, { timestamps: true }));
