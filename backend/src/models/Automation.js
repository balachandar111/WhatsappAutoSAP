const mongoose = require('mongoose');
/*
 A WhatsApp automation = "when this happens on my number, run this".
   type 'flow'     -> runs a saved Chatflow
   type 'commerce' -> the built-in ordering bot (products, branches, orders, bulk enquiries, Razorpay)
 Trigger: keyword(s) typed by the customer, and/or the default automation for any other first message.
*/
module.exports = mongoose.model('Automation', new mongoose.Schema({
  admin: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true, index: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  type: { type: String, enum: ['flow', 'commerce'], default: 'flow' },
  chatflow: { type: mongoose.Schema.Types.ObjectId, ref: 'Chatflow', default: null },
  active: { type: Boolean, default: false, index: true },
  // answers any first message that no keyword automation claims (max one per admin)
  isDefault: { type: Boolean, default: false },
  trigger: {
    keywords: { type: [String], default: [] },                       // stored lowercase
    matchType: { type: String, enum: ['exact', 'contains', 'startsWith'], default: 'exact' },
  },
  priority: { type: Number, default: 0 },                              // higher wins when several keywords match
  restartKeywords: { type: [String], default: ['menu', 'restart', 'start over'] },
  endKeywords: { type: [String], default: ['stop', 'end', 'exit'] },
  sessionTimeoutMins: { type: Number, default: 1440 },                 // idle chat restarts after this
  stats: {
    conversations: { type: Number, default: 0 },
    lastTriggeredAt: Date,
  },
}, { timestamps: true }));
