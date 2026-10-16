const mongoose = require('mongoose');
// Answers a customer gave to a "form" node of a chat flow, over WhatsApp.
module.exports = mongoose.model('FlowSubmission', new mongoose.Schema({
  admin: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true, index: true },
  automation: { type: mongoose.Schema.Types.ObjectId, ref: 'Automation', index: true },
  chatflow: { type: mongoose.Schema.Types.ObjectId, ref: 'Chatflow', index: true },
  submissionId: { type: String, unique: true },
  nodeKey: String,
  formTitle: String,
  lang: String,
  phone: { type: String, index: true },
  profileName: String,
  answers: { type: mongoose.Schema.Types.Mixed, default: {} },       // { fieldKey: value }
  fields: { type: [mongoose.Schema.Types.Mixed], default: [] },      // [{ key, label, type }] snapshot for display/export
  files: { type: [mongoose.Schema.Types.Mixed], default: [] },       // [{ key, mediaId, mime, filename, caption }]
  status: { type: String, enum: ['new', 'reviewed', 'closed'], default: 'new', index: true },
  note: { type: String, default: '' },
}, { timestamps: true }));
