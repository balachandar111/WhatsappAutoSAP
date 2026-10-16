const { clip } = require('../utils/helpers');

/*
 WhatsApp Cloud API client, built per tenant from that admin's saved credentials.
   makeClient(cfg)            -> real client (sends through Meta)
   makeClient(cfg, transport) -> same API but every payload goes to `transport(payload)` (used by the flow simulator + tests)
   safe(client)               -> same API that never throws (the bot must not crash on a failed send)
*/
async function graphCall(cfg, path, { method = 'GET', body, raw = false } = {}) {
  if (!cfg.waToken) throw new Error('WhatsApp access token is not configured (Setup page)');
  const url = path.startsWith('http') ? path : `https://graph.facebook.com/${cfg.graphVersion}/${path}`;
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${cfg.waToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  if (raw) return r;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.error?.error_user_msg || data.error?.message || `Graph API error (${r.status})`);
    err.code = data.error?.code;
    err.status = r.status;
    console.error('Graph API error:', JSON.stringify(data.error || data));
    throw err;
  }
  return data;
}

function makeClient(cfg, transport) {
  const send = transport || (async (payload) => {
    if (!cfg.phoneNumberId) throw new Error('Phone Number ID is not configured (Setup page)');
    return graphCall(cfg, `${cfg.phoneNumberId}/messages`, { method: 'POST', body: { messaging_product: 'whatsapp', ...payload } });
  });
  const interactive = (to, i) => send({ to, type: 'interactive', interactive: i });
  const image = (url) => ({ type: 'image', image: { link: url } });

  return {
    cfg,
    graph: (path, opts) => graphCall(cfg, path, opts),
    raw: send,

    text: (to, body) => send({ to, type: 'text', text: { body: String(body).slice(0, 4000), preview_url: true } }),

    // max 3 buttons, title <= 20 chars. Optional header image.
    buttons: (to, body, buttons, { image: img } = {}) => interactive(to, {
      type: 'button',
      ...(img ? { header: image(img) } : {}),
      body: { text: clip(body, 1024) },
      action: { buttons: buttons.slice(0, 3).map(([id, title]) => ({ type: 'reply', reply: { id: String(id).slice(0, 256), title: clip(title, 20) } })) },
    }),

    // rows: [id, title(24), description(72)?] - WhatsApp allows max 10 rows in total
    list: (to, body, button, rows, sectionTitle = 'Options') => interactive(to, {
      type: 'list',
      body: { text: clip(body, 1024) },
      action: {
        button: clip(button, 20),
        sections: [{ title: clip(sectionTitle, 24), rows: rows.slice(0, 10).map(([id, title, description]) => ({ id: String(id).slice(0, 200), title: clip(title, 24), ...(description ? { description: clip(description, 72) } : {}) })) }],
      },
    }),

    image: (to, link, caption = '') => send({ to, type: 'image', image: { link, ...(caption ? { caption: clip(caption, 1024) } : {}) } }),

    // Card with a single "open link" button (+ optional image on top)
    cta: (to, { body, label, url, image: img }) => interactive(to, {
      type: 'cta_url',
      ...(img ? { header: image(img) } : {}),
      body: { text: clip(body, 1024) },
      action: { name: 'cta_url', parameters: { display_text: clip(label || 'Open', 20), url } },
    }),

    locationRequest: (to, body) => interactive(to, { type: 'location_request_message', body: { text: clip(body, 1024) }, action: { name: 'send_location' } }),

    location: (to, { lat, lng, name, address }) => send({ to, type: 'location', location: { latitude: lat, longitude: lng, name: clip(name, 100), address: clip(address, 200) } }),

    template: (to, name, params = [], lang = 'en') => send({
      to, type: 'template',
      template: {
        name, language: { code: lang },
        components: params.length ? [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: clip(p, 60) || '-' })) }] : undefined,
      },
    }),
  };
}

const safe = (client) => new Proxy(client, {
  get(t, k) {
    const v = t[k];
    if (typeof v !== 'function' || k === 'graph') return v;
    return (...a) => Promise.resolve().then(() => v(...a)).catch((e) => { console.error(`WhatsApp send failed (${String(k)}):`, e.message); });
  },
});

// Downloads an inbound media file (customer photo/document). Returns { buffer, mime }
async function downloadMedia(cfg, mediaId) {
  const meta = await graphCall(cfg, String(mediaId));
  const r = await graphCall(cfg, meta.url, { raw: true });
  if (!r.ok) throw new Error(`Media download failed (${r.status})`);
  return { buffer: Buffer.from(await r.arrayBuffer()), mime: meta.mime_type || r.headers.get('content-type') || 'application/octet-stream' };
}

// recording transport used by the simulator / tests
function recorder() {
  const out = [];
  return { out, transport: async (payload) => { out.push(payload); return { messages: [{ id: 'sim' }] }; } };
}

module.exports = { makeClient, safe, graphCall, downloadMedia, recorder };
