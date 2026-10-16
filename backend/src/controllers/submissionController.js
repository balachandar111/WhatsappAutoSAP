const FlowSubmission = require('../models/FlowSubmission');
const InboundLog = require('../models/InboundLog');
const { getSettings } = require('../services/settings');
const { downloadMedia } = require('../services/whatsapp');
const { bad, notFound, escRe, page, HttpError } = require('../utils/http');

const A = (req) => ({ admin: req.admin._id });

// GET /api/submissions?chatflow=&automation=&status=&q=&from=&to=&page=&limit=
exports.list = async (req, res) => {
  const { skip, limit, page: p } = page(req);
  const f = { ...A(req) };
  for (const k of ['chatflow', 'automation']) if (req.query[k]) f[k] = String(req.query[k]);
  if (['new', 'reviewed', 'closed'].includes(req.query.status)) f.status = req.query.status;
  if (req.query.from || req.query.to) {
    f.createdAt = {};
    if (req.query.from) f.createdAt.$gte = new Date(req.query.from);
    if (req.query.to) { const d = new Date(req.query.to); d.setHours(23, 59, 59, 999); f.createdAt.$lte = d; }
  }
  if (req.query.q) { const r = new RegExp(escRe(String(req.query.q).trim()), 'i'); f.$or = [{ phone: r }, { profileName: r }, { submissionId: r }, { formTitle: r }]; }
  const [data, total] = await Promise.all([FlowSubmission.find(f).sort({ createdAt: -1 }).skip(skip).limit(limit), FlowSubmission.countDocuments(f)]);
  res.json({ success: true, data, total, page: p, pages: Math.max(Math.ceil(total / limit), 1) });
};

exports.get = async (req, res) => {
  const s = await FlowSubmission.findOne({ _id: req.params.id, ...A(req) });
  if (!s) throw notFound();
  res.json({ success: true, data: s });
};

// PATCH /api/submissions/:id  { status, note }
exports.update = async (req, res) => {
  const set = {};
  if (req.body?.status !== undefined) { if (!['new', 'reviewed', 'closed'].includes(req.body.status)) throw bad('Invalid status'); set.status = req.body.status; }
  if (typeof req.body?.note === 'string') set.note = req.body.note.slice(0, 1000);
  const s = await FlowSubmission.findOneAndUpdate({ _id: req.params.id, ...A(req) }, set, { new: true });
  if (!s) throw notFound();
  res.json({ success: true, data: s });
};

exports.remove = async (req, res) => {
  const r = await FlowSubmission.deleteOne({ _id: req.params.id, ...A(req) });
  if (!r.deletedCount) throw notFound();
  res.json({ success: true });
};

// GET /api/submissions/export.csv?chatflow=...   (one CSV per form: columns = that form's fields)
const cell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };   // also neutralises spreadsheet formula injection
exports.exportCsv = async (req, res) => {
  const f = { ...A(req) };
  for (const k of ['chatflow', 'automation']) if (req.query[k]) f[k] = String(req.query[k]);
  if (req.query.nodeKey) f.nodeKey = String(req.query.nodeKey);
  const rows = await FlowSubmission.find(f).sort({ createdAt: -1 }).limit(10000);
  const keys = [];
  for (const r of rows) for (const fl of r.fields) if (!keys.find((k) => k.key === fl.key)) keys.push(fl);
  const head = ['Submission ID', 'Date', 'Phone', 'Name', 'Status', ...keys.map((k) => k.label)];
  const lines = [head.map(cell).join(',')];
  for (const r of rows) lines.push([r.submissionId, r.createdAt.toISOString(), r.phone, r.profileName, r.status, ...keys.map((k) => r.answers?.[k.key] ?? '')].map(cell).join(','));
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename=submissions.csv' });
  res.send('﻿' + lines.join('\r\n'));
};

// GET /api/submissions/:id/media/:mediaId   streams a customer's uploaded photo/document from WhatsApp (ids expire after ~30 days)
exports.media = async (req, res) => {
  const s = await FlowSubmission.findOne({ _id: req.params.id, ...A(req) });
  const file = s?.files?.find((x) => x.mediaId === req.params.mediaId);
  if (!file) throw notFound('File not found');
  try {
    const { buffer, mime } = await downloadMedia(await getSettings(req.admin._id), file.mediaId);
    res.set({ 'Content-Type': mime, 'Content-Disposition': `inline; filename="${String(file.filename || 'file').replace(/[^\w.\-]/g, '_')}"`, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
    res.send(buffer);
  } catch (e) { throw new HttpError(502, `Could not fetch the file from WhatsApp: ${e.message}`); }
};

// GET /api/conversations?phone=&page=   inbound message log (kept 30 days)
exports.conversations = async (req, res) => {
  const { skip, limit, page: p } = page(req, 50, 200);
  const f = { ...A(req), ...(req.query.phone ? { from: String(req.query.phone).replace(/\D/g, '') } : {}) };
  const [data, total] = await Promise.all([InboundLog.find(f).sort({ createdAt: -1 }).skip(skip).limit(limit).select('-admin'), InboundLog.countDocuments(f)]);
  res.json({ success: true, data, total, page: p });
};
