import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import Modal from './Modal';

// "Test on the server": runs the REAL conversation engine in dry-run mode (nothing is sent to WhatsApp,
// no submissions are saved) and shows the exact WhatsApp payloads it would have sent.
export default function SimulatorModal({ automation, onClose, endpoint }) {
  const [msgs, setMsgs] = useState([]);       // { from:'bot'|'user'|'sys', ... }
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const [sheet, setSheet] = useState(null);
  const bodyRef = useRef(null);
  const id = useRef(0);

  useEffect(() => { bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' }); }, [msgs, sheet]);

  const toMsg = (p) => {
    const m = { id: ++id.current, from: 'bot' };
    if (p.type === 'text') return { ...m, text: p.text?.body };
    if (p.type === 'image') return { ...m, image: p.image?.link, text: p.image?.caption };
    if (p.type === 'location') return { ...m, text: `📍 ${p.location?.name || ''} ${p.location?.address || ''}` };
    if (p.type === 'template') return { ...m, text: `📨 Template: ${p.template?.name}` };
    if (p.type === 'interactive') {
      const i = p.interactive || {};
      const base = { ...m, image: i.header?.image?.link, text: i.body?.text };
      if (i.type === 'button') return { ...base, buttons: i.action.buttons.map((b) => ({ id: b.reply.id, title: b.reply.title })) };
      if (i.type === 'list') return { ...base, list: { button: i.action.button, rows: i.action.sections.flatMap((s) => s.rows) } };
      if (i.type === 'cta_url') return { ...base, link: i.action.parameters };
      if (i.type === 'location_request_message') return { ...base, askLocation: true, text: `${i.body?.text}` };
      if (i.type === 'product_list') return { ...base, text: `${i.body?.text}\n\n🛒 (WhatsApp catalog list: ${i.action.sections.flatMap((s) => s.product_items).map((x) => x.product_retailer_id).join(', ')})` };
    }
    return { ...m, text: `(${p.type} message)` };
  };

  const call = async (body, userText) => {
    setBusy(true); setSheet(null);
    if (userText) setMsgs((p) => [...p, { id: ++id.current, from: 'user', text: userText }]);
    try {
      const r = await api(endpoint || `/automations/${automation.id}/simulate`, { method: 'POST', body });
      setMsgs((p) => [...p, ...(body.reset ? [] : []), ...r.data.messages.map(toMsg)]);
      setFinished(r.data.finished);
      if (r.data.finished) setMsgs((p) => [...p, { id: ++id.current, from: 'sys', text: 'Conversation ended' }]);
    } catch (e) { setMsgs((p) => [...p, { id: ++id.current, from: 'sys', text: `⚠ ${e.message}` }]); }
    setBusy(false);
  };

  const restart = () => { setMsgs([]); setFinished(false); call({ reset: true }); };
  useEffect(() => { call({ reset: true }); }, []); // eslint-disable-line

  const send = (e) => {
    e.preventDefault();
    const t = text.trim(); if (!t || busy) return;
    setText(''); call({ text: t }, t);
  };
  const pick = (r) => call({ replyId: r.id, replyTitle: r.title }, r.title);

  return (
    <Modal title={`Test “${automation.name}”`} onClose={onClose} width={420}>
      <div className="row-between" style={{ marginBottom: 8 }}>
        <span className="muted">Runs the real engine, sends nothing.</span>
        <button className="btn small secondary" onClick={restart} disabled={busy}>↻ Restart</button>
      </div>
      <div className="phone">
        <div className="phone-screen" style={{ height: 520 }}>
          <div className="wa-head"><div className="wa-avatar">🧪</div><div><b>{automation.name}</b><small>Server simulation</small></div></div>
          <div className="wa-body" ref={bodyRef}>
            {msgs.map((m) => (m.from === 'sys' ? <div key={m.id} className="wa-sys">{m.text}</div> : (
              <div key={m.id} className={`wa-msg ${m.from}`}>
                {(m.text || m.image) && (
                  <div className={`wa-bubble ${m.image ? 'wa-card' : ''}`}>
                    {m.image && <img src={m.image} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
                    {m.text}
                  </div>
                )}
                {m.askLocation && <button className="wa-btn" disabled={busy} onClick={() => call({ sampleLocation: true }, '📍 (shared a location near your first outlet)')}>📍 Share sample location</button>}
                {m.link && <a className="wa-btn" href={m.link.url} target="_blank" rel="noreferrer">🔗 {m.link.display_text}</a>}
                {m.buttons?.map((b) => <button key={b.id} className="wa-btn" disabled={busy} onClick={() => pick(b)}>{b.title}</button>)}
                {m.list && <button className="wa-btn" disabled={busy} onClick={() => setSheet(m.list)}>☰ {m.list.button}</button>}
              </div>
            )))}
            {busy && <div className="wa-sys">…</div>}
          </div>
          <form className="wa-foot" onSubmit={send}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={finished ? 'Conversation ended — restart or type a keyword' : 'Message'} />
            <button aria-label="Send" disabled={busy}>➤</button>
          </form>
          {sheet && (
            <div className="wa-sheet" onClick={() => setSheet(null)}>
              <div className="wa-sheet-inner" onClick={(e) => e.stopPropagation()}>
                <h5>{sheet.button}</h5>
                {sheet.rows.map((r) => <button key={r.id} className="wa-row" onClick={() => pick(r)}>{r.title}{r.description && <div className="muted">{r.description}</div>}</button>)}
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
