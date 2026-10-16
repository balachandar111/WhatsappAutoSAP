const mongoose = require('mongoose');
module.exports = mongoose.model('SuperAdmin', new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  username: { type: String, required: true, unique: true, trim: true, lowercase: true },
  password: { type: String, required: true },
  status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
  lastLoginAt: Date,
  passwordChangedAt: Date,        // tokens issued before this are rejected
}, { timestamps: true }));
