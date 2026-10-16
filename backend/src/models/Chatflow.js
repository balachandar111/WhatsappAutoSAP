const mongoose = require('mongoose');
/*
 Chat flow built by the admin (same node model as the chatbot builder):
   flow = { [language]: { start: "Q1", questions: { Q1: { nodeType, text, isEnd, options[], products[], formFields[], steps[] ... } } } }
 `flow`     = working copy (what the builder edits; may be incomplete)
 `liveFlow` = last copy that passed validation; this is what automations actually run
*/
module.exports = mongoose.model('Chatflow', new mongoose.Schema({
  admin: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true, index: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  languages: { type: [String], default: ['english'] },
  flow: { type: mongoose.Schema.Types.Mixed, default: {} },
  liveFlow: { type: mongoose.Schema.Types.Mixed, default: null },
  status: { type: String, enum: ['draft', 'ready'], default: 'draft', index: true },
  version: { type: Number, default: 0 },
  validation: {
    valid: { type: Boolean, default: false },
    errors: { type: [String], default: [] },
    warnings: { type: [String], default: [] },
    checkedAt: Date,
  },
}, { timestamps: true, minimize: false }));
