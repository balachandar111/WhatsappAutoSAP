// Normalizes a raw WhatsApp Cloud API message object into one flat shape the engines work with.
function parseInbound(msg) {
  const out = { id: msg.id, from: msg.from, type: msg.type, text: '', replyId: '', replyTitle: '', location: null, order: null, media: null };
  switch (msg.type) {
    case 'text': out.text = (msg.text?.body || '').trim(); break;
    case 'interactive': {
      const r = msg.interactive?.button_reply || msg.interactive?.list_reply;
      if (r) { out.replyId = r.id || ''; out.replyTitle = r.title || ''; out.text = (r.title || '').trim(); }
      break;
    }
    case 'button': out.replyId = msg.button?.payload || ''; out.replyTitle = msg.button?.text || ''; out.text = (msg.button?.text || '').trim(); break; // template quick-reply
    case 'location': out.location = msg.location || null; break;
    case 'order': out.order = msg.order || null; break;
    case 'image': case 'document': case 'audio': case 'video': case 'sticker': {
      const m = msg[msg.type] || {};
      out.media = { id: m.id, mime: m.mime_type || '', filename: m.filename || '', caption: m.caption || '', kind: msg.type };
      out.text = (m.caption || '').trim();
      break;
    }
    default: break;
  }
  return out;
}
module.exports = { parseInbound };
