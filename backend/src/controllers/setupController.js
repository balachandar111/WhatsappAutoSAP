const { getSettings, updateSettings, publicView, markWhatsappVerified, clearWhatsappVerified, markRazorpayVerified, markSubscribed } = require('../services/settings');
const { makeClient, graphCall } = require('../services/whatsapp');
const { testRazorpay } = require('../services/razorpay');
const { DEFS } = require('../services/templates');
const { bad, HttpError } = require('../utils/http');
const { digits } = require('../utils/http');

const baseUrl = (req) => `${req.protocol}://${req.get('host')}`;
const view = async (req) => publicView(await getSettings(req.admin._id, { fresh: true }), baseUrl(req));
// Meta errors are the admin's problem to fix (wrong token etc.) -> 400 with Meta's own message
const metaFail = (e) => new HttpError(400, e.message || 'Request to Meta failed');

// GET /api/setup
exports.get = async (req, res) => res.json({ success: true, data: await view(req) });

// GET /api/setup/status   -> drives the sidebar lock on "Chat Flows" / "Automations"
exports.status = async (req, res) => {
  const v = await view(req);
  res.json({ success: true, data: { ...v.status, webhook: v.webhook } });
};

// PUT /api/setup   (secrets: blank or masked value = keep existing)
exports.save = async (req, res) => {
  const r = await updateSettings(req.admin._id, req.body || {});
  if (r.errors) throw bad(r.errors.join('. '));
  res.json({ success: true, message: 'Setup saved. Now run "Test WhatsApp".', data: await view(req) });
};

// POST /api/setup/test-whatsapp
// Calls Meta with the SAVED credentials. Success marks the setup as tested, which unlocks Chat Flows + Automations.
exports.testWhatsapp = async (req, res) => {
  const cfg = await getSettings(req.admin._id, { fresh: true });
  const missing = [['waToken', 'Access token'], ['phoneNumberId', 'Phone Number ID'], ['appSecret', 'App Secret']].filter(([k]) => !cfg[k]).map(([, l]) => l);
  if (missing.length) throw bad(`Save these first: ${missing.join(', ')}`);
  try {
    const info = await graphCall(cfg, `${cfg.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,code_verification_status,name_status,platform_type`);
    await markWhatsappVerified(req.admin._id, info);
    res.json({ success: true, message: 'WhatsApp connection works. Chat Flows are now unlocked.', info, data: await view(req) });
  } catch (e) {
    await clearWhatsappVerified(req.admin._id);
    throw metaFail(e);
  }
};

// POST /api/setup/test-token   (needs App ID + App Secret): is the token valid, permanent, which permissions?
exports.testToken = async (req, res) => {
  const cfg = await getSettings(req.admin._id, { fresh: true });
  if (!cfg.appId || !cfg.appSecret) throw bad('Save App ID and App Secret first');
  if (!cfg.waToken) throw bad('Save the access token first');
  const r = await fetch(`https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(cfg.waToken)}&access_token=${encodeURIComponent(`${cfg.appId}|${cfg.appSecret}`)}`, { signal: AbortSignal.timeout(20000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw bad(d.error?.message || 'debug_token failed');
  const t = d.data || {};
  res.json({
    success: true,
    info: {
      valid: t.is_valid, type: t.type, appMatches: String(t.app_id) === String(cfg.appId),
      expires: t.expires_at ? new Date(t.expires_at * 1000).toISOString() : 'never (permanent)',
      scopes: t.scopes || [], error: t.error?.message,
    },
  });
};

// POST /api/setup/subscribe-app   subscribes your Meta app to your WhatsApp Business Account so message webhooks are delivered
exports.subscribeApp = async (req, res) => {
  const cfg = await getSettings(req.admin._id, { fresh: true });
  if (!cfg.wabaId) throw bad('Save the WhatsApp Business Account ID first');
  try {
    await graphCall(cfg, `${cfg.wabaId}/subscribed_apps`, { method: 'POST' });
    const d = await graphCall(cfg, `${cfg.wabaId}/subscribed_apps`);
    await markSubscribed(req.admin._id);
    res.json({ success: true, apps: (d.data || []).map((a) => a.whatsapp_business_api_data?.name || a.name || a.id) });
  } catch (e) { throw metaFail(e); }
};

// POST /api/setup/send-test   { to, mode: "template" | "text" }
exports.sendTest = async (req, res) => {
  const to = digits(req.body?.to);
  if (to.length < 10) throw bad('Enter the number with country code, e.g. 919876543210');
  const cfg = await getSettings(req.admin._id, { fresh: true });
  const W = makeClient(cfg);
  try {
    if (req.body?.mode === 'text') await W.text(to, '✅ Test message from your WhatsApp automation.');
    else await W.raw({ to, type: 'template', template: { name: 'hello_world', language: { code: 'en_US' } } });
    res.json({ success: true, message: 'Test message sent' });
  } catch (e) { throw metaFail(e); }
};

// POST /api/setup/test-razorpay
exports.testRazorpay = async (req, res) => {
  const cfg = await getSettings(req.admin._id, { fresh: true });
  try { await testRazorpay(cfg); } catch (e) { throw bad(e.message); }
  await markRazorpayVerified(req.admin._id);
  res.json({ success: true, message: 'Razorpay keys work', data: await view(req) });
};

// GET /api/setup/templates
exports.templates = async (req, res) => {
  const cfg = await getSettings(req.admin._id, { fresh: true });
  if (!cfg.wabaId) throw bad('Save the WhatsApp Business Account ID first');
  try { res.json({ success: true, data: (await graphCall(cfg, `${cfg.wabaId}/message_templates?fields=name,status,category,language&limit=100`)).data || [] }); }
  catch (e) { throw metaFail(e); }
};

// POST /api/setup/templates/defaults   creates the order-update templates (utility) on your WhatsApp Business Account
exports.createDefaultTemplates = async (req, res) => {
  const cfg = await getSettings(req.admin._id, { fresh: true });
  if (!cfg.wabaId) throw bad('Save the WhatsApp Business Account ID first');
  const results = [];
  for (const d of DEFS) {
    try {
      await graphCall(cfg, `${cfg.wabaId}/message_templates`, { method: 'POST', body: { name: d.name, language: 'en', category: 'UTILITY', components: [{ type: 'BODY', text: d.text, example: { body_text: [['Ravi', 'ORD1A2B3C']] } }] } });
      results.push({ name: d.name, ok: true });
    } catch (e) { results.push({ name: d.name, ok: false, error: e.message }); }
  }
  res.json({ success: true, data: results });
};
