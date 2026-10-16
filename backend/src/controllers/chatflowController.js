const Chatflow = require('../models/Chatflow');
const Automation = require('../models/Automation');
const { sanitizeFlow, LANG_RE } = require('../services/flowValidator');
const templates = require('../services/flowTemplates');
const { parseFlowWorkbook, flowToWorkbookBuffer, buildTemplateWorkbookBuffer } = require('../utils/flowExcel');
const { bad, notFound, escRe } = require('../utils/http');
const { featuresOf } = require('../middleware/features');

const one = async (req) => {
  const f = await Chatflow.findOne({ _id: req.params.id, admin: req.admin._id });
  if (!f) throw notFound('Chat flow not found');
  return f;
};
const summary = (f, extra = {}) => ({
  id: f._id, name: f.name, description: f.description, languages: f.languages, status: f.status, version: f.version,
  validation: { valid: f.validation?.valid, errors: f.validation?.errors?.length || 0, warnings: f.validation?.warnings?.length || 0, checkedAt: f.validation?.checkedAt },
  nodeCount: Object.fromEntries(Object.entries(f.flow || {}).map(([l, lf]) => [l, Object.keys(lf?.questions || {}).length])),
  createdAt: f.createdAt, updatedAt: f.updatedAt, ...extra,
});
const detail = (f) => ({ ...summary(f), flow: f.flow, validation: f.validation, hasLiveVersion: !!f.liveFlow });

// Mongo cannot store keys containing "." or starting with "$"; also bound nesting so a crafted body cannot blow the stack.
function assertStorable(v, depth = 0) {
  if (depth > 10) throw bad('The flow is nested too deeply');
  if (Array.isArray(v)) return v.forEach((x) => assertStorable(x, depth + 1));
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) {
      if (k.includes('.') || k.startsWith('$')) throw bad(`Invalid key "${k}" in the flow (keys cannot contain "." or start with "$")`);
      assertStorable(v[k], depth + 1);
    }
  }
}

const cleanLanguages = (v) => {
  const list = [...new Set((Array.isArray(v) ? v : []).map((l) => String(l).trim().toLowerCase()).filter(Boolean))];
  for (const l of list) if (!LANG_RE.test(l)) throw bad(`Language "${l}" is not valid (lowercase letters, e.g. english, tamil, hindi)`);
  if (list.length > 6) throw bad('A chat flow supports up to 6 languages');
  return list;
};

// Validates; a VALID flow becomes the live copy that automations run. An invalid one is kept as a draft only.
async function applyFlow(doc, rawFlow, admin) {
  assertStorable(rawFlow);
  const r = sanitizeFlow(rawFlow, { languages: doc.languages, ecommerce: featuresOf(admin).ecommerce });
  const valid = r.errors.length === 0;
  if (valid) { doc.flow = r.flow; doc.liveFlow = r.flow; doc.status = 'ready'; doc.version += 1; }
  else { doc.flow = rawFlow; doc.status = doc.liveFlow ? 'ready' : 'draft'; }   // keeps running the last good version
  doc.validation = { valid, errors: r.errors, warnings: r.warnings, checkedAt: new Date() };
  doc.markModified('flow'); doc.markModified('liveFlow');
  await doc.save();
  return r;
}
const result = (doc, r, extra = {}) => ({
  success: true, saved: true, valid: r.errors.length === 0, errors: r.errors, warnings: r.warnings,
  message: r.errors.length ? `Saved as a draft - fix ${r.errors.length} problem(s) before it can go live` : 'Chat flow saved and ready to use in an automation',
  data: detail(doc), ...extra,
});

// GET /api/chatflows
exports.list = async (req, res) => {
  const f = { admin: req.admin._id };
  if (req.query.q) f.name = new RegExp(escRe(String(req.query.q).trim()), 'i');
  if (['draft', 'ready'].includes(req.query.status)) f.status = req.query.status;
  const flows = await Chatflow.find(f).select('-liveFlow').sort({ updatedAt: -1 });
  const used = await Automation.aggregate([{ $match: { admin: req.admin._id, chatflow: { $ne: null } } }, { $group: { _id: '$chatflow', n: { $sum: 1 } } }]);
  const usedMap = new Map(used.map((u) => [String(u._id), u.n]));
  res.json({ success: true, count: flows.length, data: flows.map((x) => summary(x, { automations: usedMap.get(String(x._id)) || 0 })) });
};

// POST /api/chatflows  { name, description, languages, template: "blank" | "sample" | "empty" }
exports.create = async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) throw bad('Name is required');
  const languages = cleanLanguages(b.languages && b.languages.length ? b.languages : ['english']);
  const doc = new Chatflow({ admin: req.admin._id, name: name.slice(0, 80), description: String(b.description || '').slice(0, 300), languages });
  const tpl = b.template === 'sample' ? templates.sample : b.template === 'empty' ? null : templates.blank;
  if (b.flow) await applyFlow(doc, b.flow, req.admin);
  else if (tpl) await applyFlow(doc, Object.assign({}, ...languages.map((l) => tpl(l))), req.admin);
  else { doc.validation = { valid: false, errors: ['The flow is empty'], warnings: [], checkedAt: new Date() }; await doc.save(); }
  res.status(201).json({ success: true, message: 'Chat flow created', data: detail(doc) });
};

// GET /api/chatflows/:id
exports.get = async (req, res) => res.json({ success: true, data: detail(await one(req)) });

// PUT /api/chatflows/:id   { name, description, languages }
exports.update = async (req, res) => {
  const doc = await one(req);
  const b = req.body || {};
  if (typeof b.name === 'string') { if (!b.name.trim()) throw bad('Name cannot be empty'); doc.name = b.name.trim().slice(0, 80); }
  if (typeof b.description === 'string') doc.description = b.description.slice(0, 300);
  if (Array.isArray(b.languages)) {
    const langs = cleanLanguages(b.languages);
    if (!langs.length) throw bad('Keep at least one language');
    doc.languages = langs;
    for (const l of Object.keys(doc.flow || {})) if (!langs.includes(l)) delete doc.flow[l];   // dropped language -> its flow goes too
    doc.markModified('flow');
    const r = await applyFlow(doc, doc.flow || {}, req.admin);
    return res.json(result(doc, r, { message: 'Chat flow updated' }));
  }
  await doc.save();
  res.json({ success: true, message: 'Chat flow updated', data: detail(doc) });
};

// PUT /api/chatflows/:id/flow   { flow }       <- the builder's "Save"
exports.saveFlow = async (req, res) => {
  const doc = await one(req);
  if (!req.body || typeof req.body.flow !== 'object') throw bad('Send the flow as { "flow": { "<language>": { "start": "Q1", "questions": { ... } } } }');
  // the languages present in the saved flow ARE the chat flow's languages
  const langs = Object.keys(req.body.flow);
  if (langs.length) doc.languages = cleanLanguages(langs);
  const r = await applyFlow(doc, req.body.flow, req.admin);
  res.json(result(doc, r));
};

// POST /api/chatflows/:id/validate   (re-checks the stored working copy, changes nothing)
exports.validate = async (req, res) => {
  const doc = await one(req);
  const r = sanitizeFlow(doc.flow, { languages: doc.languages, ecommerce: featuresOf(req.admin).ecommerce });
  res.json({ success: true, valid: r.errors.length === 0, errors: r.errors, warnings: r.warnings });
};

// DELETE /api/chatflows/:id
exports.remove = async (req, res) => {
  const doc = await one(req);
  const used = await Automation.find({ admin: req.admin._id, chatflow: doc._id }).select('name');
  if (used.length) throw Object.assign(bad(`This chat flow is used by automation(s): ${used.map((a) => a.name).join(', ')}. Remove or change them first.`), { status: 409 });
  await doc.deleteOne();
  res.json({ success: true, message: 'Chat flow deleted' });
};

// POST /api/chatflows/:id/duplicate
exports.duplicate = async (req, res) => {
  const src = await one(req);
  const doc = new Chatflow({ admin: req.admin._id, name: `${src.name} (copy)`.slice(0, 80), description: src.description, languages: src.languages });
  await applyFlow(doc, JSON.parse(JSON.stringify(src.flow || {})), req.admin);
  res.status(201).json({ success: true, message: 'Chat flow duplicated', data: detail(doc) });
};

// ---- Excel (same sheets as the chatbot builder)
exports.template = (_req, res) => {
  res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename=chatflow-template.xlsx' });
  res.send(buildTemplateWorkbookBuffer());
};
exports.exportExcel = async (req, res) => {
  const doc = await one(req);
  const safeName = (doc.name || 'chatflow').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename=${safeName}-flow.xlsx` });
  res.send(flowToWorkbookBuffer(doc.flow || {}));
};
// POST /api/chatflows/:id/import-excel   multipart field "file"  -> REPLACES the working flow
exports.importExcel = async (req, res) => {
  const doc = await one(req);
  if (!req.file) throw bad('No file uploaded');
  const { flow, error } = parseFlowWorkbook(req.file.buffer);
  if (error) throw bad(error);
  doc.languages = cleanLanguages(Object.keys(flow));
  const r = await applyFlow(doc, flow, req.admin);
  res.json(result(doc, r, { message: r.errors.length ? 'Imported as a draft - fix the listed problems' : 'Excel imported and saved' }));
};
