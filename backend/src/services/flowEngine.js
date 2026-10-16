/*
 Runs a saved Chatflow over WhatsApp.
 Node types -> WhatsApp:
   message  -> text + reply buttons (<=3 options) or a list (<=10, paginated beyond that). isEnd = final message.
   products -> one picture card per product with an "open link" button (cta_url), then an optional Continue button.
   form     -> asks every field one by one in the chat (validated), saves a FlowSubmission, optional follow-up node.
   steps    -> one step per message with Back / Next buttons, a closing message, optional follow-up node.
 Navigation is carried in the reply ids (o:<node>:<i>, c:<node>, s:<node>:<i>, sf:<node>, f:<field>:<i>, lang:<x>), so old
 buttons keep working. State (language, current node, half-finished form) lives in session.flow.
*/
const FlowSubmission = require('../models/FlowSubmission');
const { t } = require('./i18n');
const { clip, newId } = require('../utils/helpers');

const LIST_PAGE = 9;
const eq = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// ---------------------------------------------------------------- state helpers
const st = (ctx) => (ctx.session.flow = ctx.session.flow && typeof ctx.session.flow === 'object' ? ctx.session.flow : {});
const touch = (ctx) => { ctx.session.markModified('flow'); };
const langFlow = (ctx) => ctx.flow[st(ctx).lang];
const nodeOf = (ctx, key) => langFlow(ctx)?.questions?.[key];

function endChat(ctx) { ctx.ended = true; }               // dispatcher deletes the session

// ---------------------------------------------------------------- entry points
async function start(ctx) {
  const s = st(ctx);
  s.form = null;
  const langs = Object.keys(ctx.flow);
  if (langs.length === 1) { s.lang = langs[0]; return sendNode(ctx, ctx.flow[s.lang].start); }
  s.lang = null; s.node = null;
  ctx.session.awaitingInput = false;
  touch(ctx);
  const rows = langs.map((l) => [`lang:${l}`, cap(l)]);
  const body = t('english', 'chooseLang');
  return rows.length <= 3 ? ctx.W.buttons(ctx.to, body, rows) : ctx.W.list(ctx.to, body, t('english', 'choose'), rows, 'Languages');
}

async function handle(ctx) {
  const s = st(ctx);
  const { input } = ctx;
  const id = input.replyId;

  if (id?.startsWith('lang:')) {
    const l = id.slice(5);
    if (ctx.flow[l]) { s.lang = l; s.form = null; return sendNode(ctx, ctx.flow[l].start); }
  }
  if (!s.lang || !ctx.flow[s.lang]) return start(ctx);

  const lang = s.lang;
  if (s.form) return handleForm(ctx);

  if (id) {
    const [kind, key, arg] = id.split(':');
    const node = nodeOf(ctx, key);
    if (node) {
      if (kind === 'o') return chooseOption(ctx, key, parseInt(arg, 10));
      if (kind === 'more') return sendNode(ctx, key, { page: parseInt(arg, 10) || 0 });
      if (kind === 'c' && node.nodeType === 'products') return goNext(ctx, node.productsNext);
      if (kind === 's' && node.nodeType === 'steps') return sendStep(ctx, key, parseInt(arg, 10) || 0);
      if (kind === 'sf' && node.nodeType === 'steps') return finishSteps(ctx, key);
    }
  }

  // typed text on a question: match an option by label / number / text
  const cur = nodeOf(ctx, s.node);
  if (cur && cur.nodeType === 'message' && !cur.isEnd && input.text) {
    const q = input.text;
    let idx = cur.options.findIndex((o) => eq(o.label, q) || eq(o.text, q));
    if (idx < 0 && /^\d{1,2}$/.test(q) && +q >= 1 && +q <= cur.options.length) idx = +q - 1;
    if (idx < 0) idx = cur.options.findIndex((o) => o.text.toLowerCase().startsWith(q.toLowerCase()) && q.length >= 3);
    if (idx >= 0) return chooseOption(ctx, s.node, idx);
    await ctx.W.text(ctx.to, t(lang, 'pick'));
    return sendNode(ctx, s.node, { page: s.page || 0 });
  }
  return cur ? sendNode(ctx, s.node) : sendNode(ctx, ctx.flow[lang].start);
}

// ---------------------------------------------------------------- nodes
async function goNext(ctx, key) {
  if (key && nodeOf(ctx, key)) return sendNode(ctx, key);
  await ctx.W.text(ctx.to, t(st(ctx).lang, 'ended'));
  return endChat(ctx);
}

async function sendNode(ctx, key, { page = 0 } = {}) {
  const node = nodeOf(ctx, key);
  const s = st(ctx);
  if (!node) return endChat(ctx);
  s.node = key; s.page = page; s.form = null; s.stepIdx = 0;
  ctx.session.awaitingInput = false;
  touch(ctx);

  switch (node.nodeType) {
    case 'products': return sendProducts(ctx, key, node);
    case 'form': return startForm(ctx, key, node);
    case 'steps': return sendStepsIntro(ctx, key, node);
    default: return sendMessage(ctx, key, node, page);
  }
}

async function sendMessage(ctx, key, node, page) {
  const lang = st(ctx).lang;
  if (node.isEnd) { await ctx.W.text(ctx.to, node.text); return endChat(ctx); }
  const opts = node.options;
  if (opts.length <= 3) return ctx.W.buttons(ctx.to, node.text, opts.map((o, i) => [`o:${key}:${i}`, o.text]));

  let from = 0, rows;
  if (opts.length <= 10) rows = opts.map((o, i) => [`o:${key}:${i}`, o.text]);
  else {
    from = page * LIST_PAGE;
    rows = opts.slice(from, from + LIST_PAGE).map((o, i) => [`o:${key}:${from + i}`, o.text]);
    if (from + LIST_PAGE < opts.length) rows.push([`more:${key}:${page + 1}`, t(lang, 'more')]);
  }
  return ctx.W.list(ctx.to, node.text, t(lang, 'choose'), rows, 'Options');
}

async function chooseOption(ctx, key, i) {
  const node = nodeOf(ctx, key);
  const o = node?.options?.[i];
  if (!o) return sendNode(ctx, key);
  if (o.url) await ctx.W.text(ctx.to, `🔗 ${o.text}\n${o.url}`);
  if (o.handoff === 'commerce') return ctx.switchTo('commerce');
  if (o.next) return sendNode(ctx, o.next);
  if (o.url) return sendNode(ctx, key, { page: st(ctx).page || 0 });   // link only: stay on the question so they can pick again
  await ctx.W.text(ctx.to, t(st(ctx).lang, 'ended'));
  return endChat(ctx);
}

// ---- product cards
async function sendCard(ctx, c) {
  const body = [c.title && `*${c.title}*`, c.description].filter(Boolean).join('\n') || c.title;
  const link = c.redirectUrl;
  try {
    if (link) return await ctx.client.cta(ctx.to, { body, label: c.buttonText, url: link, image: c.image || undefined });
    if (c.image) return await ctx.client.image(ctx.to, c.image, body);
    return await ctx.client.text(ctx.to, body);
  } catch (e) {
    // cta_url / image rejected (bad image link, account without cta support ...) -> plain text with the link
    console.error('product card fallback:', e.message);
    return ctx.W.text(ctx.to, `${body}${link ? `\n🔗 ${c.buttonText}: ${link}` : ''}`);
  }
}

async function sendProducts(ctx, key, node) {
  const lang = st(ctx).lang;
  if (node.text) await ctx.W.text(ctx.to, node.text);
  for (const c of node.products) await sendCard(ctx, c);
  if (node.productsNext) return ctx.W.buttons(ctx.to, t(lang, 'anythingElse'), [[`c:${key}`, t(lang, 'cont')]]);
  await ctx.W.text(ctx.to, t(lang, 'ended'));
  return endChat(ctx);
}

// ---- steps
async function sendStepsIntro(ctx, key, node) {
  if (node.text) await ctx.W.text(ctx.to, node.text);
  return sendStep(ctx, key, 0);
}

async function sendStep(ctx, key, i) {
  const node = nodeOf(ctx, key);
  const lang = st(ctx).lang;
  const n = node.steps.length;
  i = Math.min(Math.max(i, 0), n - 1);
  const step = node.steps[i];
  st(ctx).node = key; st(ctx).stepIdx = i; touch(ctx);
  const body = `*${t(lang, 'step')} ${i + 1}/${n} — ${step.title}*${step.desc ? `\n${step.desc}` : ''}`;
  const buttons = [];
  if (i > 0) buttons.push([`s:${key}:${i - 1}`, t(lang, 'back')]);
  buttons.push(i < n - 1 ? [`s:${key}:${i + 1}`, t(lang, 'next')] : [`sf:${key}`, t(lang, 'finish')]);
  try {
    return await ctx.client.buttons(ctx.to, body, buttons, { image: step.image || undefined });
  } catch (e) {
    console.error('step fallback:', e.message);
    return ctx.W.buttons(ctx.to, body, buttons);
  }
}

async function finishSteps(ctx, key) {
  const node = nodeOf(ctx, key);
  const lang = st(ctx).lang;
  const head = node.closingTitle ? `*${node.closingTitle}*${node.closingMessage ? `\n${node.closingMessage}` : ''}` : (node.closingMessage || t(lang, 'allDone'));
  if (node.closingImage) {
    try { await ctx.client.image(ctx.to, node.closingImage, head); } catch { await ctx.W.text(ctx.to, head); }
  } else await ctx.W.text(ctx.to, head);
  return goNext(ctx, node.stepsNext);
}

// ---------------------------------------------------------------- forms
const visible = (field, answers) => !field.showIf || answers[field.showIf.field] === field.showIf.equals;
const nextIdx = (node, answers, from) => { for (let i = from; i < node.formFields.length; i++) if (visible(node.formFields[i], answers)) return i; return -1; };

async function startForm(ctx, key, node) {
  const s = st(ctx);
  if (node.text) await ctx.W.text(ctx.to, node.text);
  s.form = { node: key, idx: 0, answers: {}, files: [] };
  const i = nextIdx(node, {}, 0);
  s.form.idx = i;
  ctx.session.awaitingInput = true;
  touch(ctx);
  return askField(ctx, node.formFields[i]);
}

async function askField(ctx, f) {
  const lang = st(ctx).lang;
  const star = f.required ? ' *' : ` ${t(lang, 'optional')}`;
  if (f.fieldType === 'select') {
    const rows = f.options.map((o, i) => [`f:${f.key}:${i}`, o]);
    const body = `${f.label}${f.required ? ' *' : ''}`;
    return rows.length <= 3 ? ctx.W.buttons(ctx.to, body, rows) : ctx.W.list(ctx.to, body, t(lang, 'choose'), rows, 'Choices');
  }
  const hint = { date: t(lang, 'hintDate'), tel: t(lang, 'hintTel'), file: t(lang, 'hintFile') }[f.fieldType] || f.placeholder;
  const body = `${f.label}${star}${hint ? `\n_${hint}_` : ''}`;
  if (!f.required) return ctx.W.buttons(ctx.to, body, [['fskip', t(lang, 'skip')]]);
  return ctx.W.text(ctx.to, body);
}

function parseDate(v) {
  let m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(v);
  let d, mo, y;
  if (m) { d = +m[1]; mo = +m[2]; y = +m[3]; }
  else if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// -> { value } or { error: <i18n key> }
function validate(f, raw, lang) {
  const v = String(raw || '').trim();
  if (!v) return { error: 'required' };
  switch (f.fieldType) {
    case 'number': { const n = v.replace(/,/g, ''); return /^-?\d+(\.\d+)?$/.test(n) ? { value: n } : { error: 'invalidNumber' }; }
    case 'tel': { const d = v.replace(/[\s\-()]/g, '').replace(/^\+/, ''); return /^\d{7,15}$/.test(d) ? { value: d } : { error: 'invalidTel' }; }
    case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) && v.length <= 200 ? { value: v.toLowerCase() } : { error: 'invalidEmail' };
    case 'date': { const d = parseDate(v); return d ? { value: d } : { error: 'invalidDate' }; }
    case 'textarea': return v.length <= 2000 ? { value: v } : { error: 'tooLong' };
    default: return v.length <= 500 ? { value: v } : { error: 'tooLong' };
  }
}

async function handleForm(ctx) {
  const s = st(ctx);
  const lang = s.lang;
  const form = s.form;
  const node = nodeOf(ctx, form.node);
  if (!node || node.nodeType !== 'form') { s.form = null; return start(ctx); }
  const f = node.formFields[form.idx];
  const { input } = ctx;

  if (/^cancel$/i.test(input.text || '')) {
    s.form = null;
    await ctx.W.text(ctx.to, t(lang, 'cancelled'));
    return sendNode(ctx, ctx.flow[lang].start);
  }

  let value;
  if (input.replyId === 'fskip' && !f.required) value = '';
  else if (f.fieldType === 'select') {
    let i = -1;
    if (input.replyId?.startsWith(`f:${f.key}:`)) i = parseInt(input.replyId.split(':')[2], 10);
    else if (input.text) i = f.options.findIndex((o) => eq(o, input.text));
    if (!(i >= 0 && i < f.options.length)) { await ctx.W.text(ctx.to, t(lang, 'selectOne')); return askField(ctx, f); }
    value = f.options[i];
  } else if (f.fieldType === 'file') {
    if (!input.media) { await ctx.W.text(ctx.to, t(lang, 'sendFile')); return askField(ctx, f); }
    form.files.push({ key: f.key, mediaId: input.media.id, mime: input.media.mime, filename: input.media.filename, caption: input.media.caption, kind: input.media.kind });
    value = `📎 ${input.media.filename || input.media.kind}`;
  } else {
    const r = validate(f, input.text, lang);
    if (r.error) { await ctx.W.text(ctx.to, t(lang, r.error)); return askField(ctx, f); }
    value = r.value;
  }

  form.answers[f.key] = value;
  const next = nextIdx(node, form.answers, form.idx + 1);
  if (next >= 0) { form.idx = next; touch(ctx); return askField(ctx, node.formFields[next]); }
  return finishForm(ctx, node);
}

async function finishForm(ctx, node) {
  const s = st(ctx);
  const form = s.form;
  const fields = node.formFields.filter((f) => visible(f, form.answers));
  // the simulator (flow preview in the dashboard) must not create real submissions or message the owner
  const sub = ctx.simulate ? { submissionId: 'SIMULATED' } : await FlowSubmission.create({
    admin: ctx.adminId, automation: ctx.automation._id, chatflow: ctx.flowDoc._id, submissionId: newId('FS'),
    nodeKey: form.node, formTitle: clip(node.text, 120), lang: s.lang, phone: ctx.to, profileName: ctx.profileName || '',
    answers: Object.fromEntries(fields.map((f) => [f.key, form.answers[f.key] ?? ''])),
    fields: fields.map((f) => ({ key: f.key, label: f.label, type: f.fieldType })),
    files: form.files,
  });
  s.form = null; ctx.session.awaitingInput = false; touch(ctx);
  await ctx.W.text(ctx.to, node.formSuccessText || t(s.lang, 'thanks'));

  if (ctx.cfg.ownerPhone && !ctx.simulate) {
    const lines = fields.map((f) => `• ${f.label}: ${form.answers[f.key] || '-'}`).join('\n');
    await ctx.W.text(ctx.cfg.ownerPhone, `📝 NEW FORM ${sub.submissionId}\n${clip(node.text, 80)}\n${lines}\n👤 ${ctx.profileName || ''} (+${ctx.to})`);
  }
  return goNext(ctx, node.formNext);
}

module.exports = { start, handle, validate, parseDate };
