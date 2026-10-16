import { useEffect, useRef, useState } from 'react';
import { WA, choiceKind } from './flowUtils';

/*
| WhatsApp simulator — walks the flow exactly the way the bot will render it:
|   message  -> text + reply buttons (≤3) or a list menu (4–10)
|   products -> one image message per card, then an optional "Continue" button
|   steps    -> one image message per step with Back / Next, then the closing message
|   form     -> questions asked one at a time (typed answers, buttons/list for choices, photo for files)
| It only reads the flow; nothing is sent to WhatsApp.
*/

const HINT = {
  number: 'Numbers only.', tel: 'Please send a phone number.', email: 'Please send an email address.',
  date: 'Format: DD/MM/YYYY', file: 'Please send a photo.',
};
const VALID = {
  number: (t) => /^-?\d+(\.\d+)?$/.test(t),
  tel: (t) => t.replace(/\D/g, '').length >= 7,
  email: (t) => /^\S+@\S+\.\S+$/.test(t),
  date: (t) => /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(t),
};
const isVisible = (f, answers) => !f.showIf?.field || answers[f.showIf.field] === f.showIf.equals;

export default function WhatsAppPreview({ questions, start, businessName = 'Your business', resetKey }) {
  const [msgs, setMsgs] = useState([]);
  const [pending, setPending] = useState(null); // { key, idx, answers } while a form is being filled
  const [sheet, setSheet] = useState(null);     // open list menu
  const [text, setText] = useState('');
  const bodyRef = useRef(null);
  const seq = useRef(0);

  const push = (...items) => setMsgs((m) => [...m, ...items.map((i) => ({ id: ++seq.current, ...i }))]);
  const endConv = () => push({ from: 'sys', text: 'Conversation ended — customer can send “hi” to start again' });
  const user = (t, extra = {}) => push({ from: 'user', text: t, ...extra });

  const restart = () => { seq.current = 0; setMsgs([]); setPending(null); setSheet(null); setText(''); goto(start); };
  // restart when the language / flow identity changes (not on every keystroke in the builder)
  useEffect(() => { restart(); /* eslint-disable-next-line */ }, [resetKey]);
  useEffect(() => { bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' }); }, [msgs, sheet]);

  /* ---------------- node renderers ---------------- */
  const goto = (key) => {
    const n = questions[key];
    if (!n) return push({ from: 'sys', text: '⚠ This path leads to a node that no longer exists.' });
    const t = n.nodeType || 'message';
    if (t === 'message') return showMessage(key, n);
    if (t === 'products') return showProducts(key, n);
    if (t === 'steps') return showStep(key, n, 0);
    if (t === 'form') return startForm(key, n);
  };

  const choiceMsg = (body, items, mk) => {
    // items: [{ title, act }]  -> buttons (≤3) or list (≤10)
    const kind = choiceKind(items.length);
    if (kind === 'buttons') return push({ from: 'bot', text: body, buttons: items });
    if (kind === 'list') return push({ from: 'bot', text: body, list: { title: mk || 'Choose an option', rows: items } });
    if (kind === 'paged') return push({ from: 'bot', text: body, list: { title: mk || 'Choose an option', rows: items } }, { from: 'sys', text: `ℹ ${items.length} options — on WhatsApp the bot shows them in pages with a “More…” row` });
    push({ from: 'bot', text: body }, { from: 'sys', text: `⚠ ${items.length} options — the maximum is ${WA.OPTIONS_MAX}` });
  };

  const showMessage = (key, n) => {
    const opts = n.options || [];
    if (n.isEnd || !opts.length) { push({ from: 'bot', text: n.text || '(empty message)' }); return endConv(); }
    choiceMsg(n.text || '(empty message)', opts.map((o) => ({ title: o.text || '(no text)', act: { t: 'opt', key, text: o.text, next: o.next, url: o.url, handoff: o.handoff } })), 'Choose an option');
  };

  const showProducts = (key, n) => {
    if (n.text) push({ from: 'bot', text: n.text });
    (n.products || []).forEach((p) => push({ from: 'bot', card: { image: p.image, title: p.title, desc: p.description, link: p.redirectUrl, linkLabel: p.buttonText } }));
    if (!(n.products || []).length) push({ from: 'sys', text: 'No product cards yet' });
    if (n.productsNext) push({ from: 'bot', text: 'Ready to continue?', buttons: [{ title: 'Continue ▶', act: { t: 'cont', next: n.productsNext } }] });
    else endConv();
  };

  const showStep = (key, n, i) => {
    const steps = n.steps || [];
    if (!steps.length) return push({ from: 'sys', text: 'No steps yet' });
    if (i === 0 && n.text) push({ from: 'bot', text: n.text });
    const s = steps[i];
    const buttons = [];
    if (i > 0) buttons.push({ title: '◀ Back', act: { t: 'step', key, i: i - 1, label: '◀ Back' } });
    buttons.push(i < steps.length - 1 ? { title: 'Next ▶', act: { t: 'step', key, i: i + 1, label: 'Next ▶' } } : { title: 'Finish ✅', act: { t: 'finish', key } });
    push({ from: 'bot', card: { image: s.image, title: `Step ${i + 1}/${steps.length}: ${s.title}`, desc: s.desc }, buttons });
  };

  /* ---- form: ask visible fields one by one ---- */
  const startForm = (key, n) => { if (n.text) push({ from: 'bot', text: n.text }); askNext(key, n, 0, {}); };

  const askNext = (key, n, from, answers) => {
    const fs = n.formFields || [];
    let idx = from;
    while (idx < fs.length && !isVisible(fs[idx], answers)) idx++;
    if (idx >= fs.length) {
      setPending(null);
      const lines = fs.filter((f) => answers[f.key] !== undefined && answers[f.key] !== '').map((f) => `• ${f.label}: ${answers[f.key]}`).join('\n');
      push({ from: 'bot', text: `✅ ${n.formSubmitLabel || 'Thank you'} — we received:\n${lines || '(nothing)'}` });
      return n.formNext ? goto(n.formNext) : endConv();
    }
    const f = fs[idx];
    setPending({ key, idx, answers });
    const skip = !f.required ? { title: 'Skip', act: { t: 'skip', key, idx, answers } } : null;
    const hint = HINT[f.fieldType] ? `\n${HINT[f.fieldType]}` : '';
    if (f.fieldType === 'select') {
      const opts = (f.options || []).filter(Boolean);
      const items = opts.map((o) => ({ title: o, act: { t: 'pick', key, idx, answers, value: o } }));
      if (skip && items.length <= 2) items.push(skip);
      return choiceMsg(f.label || '(question)', items, 'Choose');
    }
    if (f.fieldType === 'file') {
      return push({ from: 'bot', text: `${f.label || '(question)'}${hint}`, buttons: [{ title: '📎 Send sample photo', act: { t: 'photo', key, idx, answers } }, ...(skip ? [skip] : [])] });
    }
    push({ from: 'bot', text: `${f.label || '(question)'}${hint}`, ...(skip ? { buttons: [skip] } : {}) });
  };

  /* ---------------- user actions ---------------- */
  const act = (a) => {
    setSheet(null);
    const n = a.key ? questions[a.key] : null;
    if (a.t === 'opt') {
      user(a.text);
      if (a.handoff === 'commerce') { push({ from: 'sys', text: '🛒 Handed over to the ordering bot (runs on WhatsApp only — not shown in this preview)' }); return endConv(); }
      if (a.url) push({ from: 'bot', text: `🔗 ${a.url}` });
      if (a.next) return goto(a.next);
      return a.url ? goto(a.key) : endConv();
    }
    if (a.t === 'cont') { user('Continue ▶'); return goto(a.next); }
    if (a.t === 'step') { user(a.label); return showStep(a.key, n, a.i); }
    if (a.t === 'finish') {
      user('Finish ✅');
      push({ from: 'bot', card: { image: n.closingImage, title: n.closingTitle || 'All done! 🎉', desc: n.closingMessage || 'Hope that helped.' } });
      return n.stepsNext ? goto(n.stepsNext) : endConv();
    }
    const f = n?.formFields?.[a.idx];
    if (a.t === 'pick') { user(a.value); return askNext(a.key, n, a.idx + 1, { ...a.answers, [f.key]: a.value }); }
    if (a.t === 'skip') { user('Skip'); return askNext(a.key, n, a.idx + 1, a.answers); }
    if (a.t === 'photo') { user('📷 photo.jpg'); return askNext(a.key, n, a.idx + 1, { ...a.answers, [f.key]: '(photo received)' }); }
  };

  const send = (e) => {
    e.preventDefault();
    const t = text.trim(); if (!t) return;
    setText('');
    if (/^(hi|hello|menu|start)$/i.test(t)) { user(t); return again(); }
    if (pending) {
      const n = questions[pending.key]; const f = n?.formFields?.[pending.idx];
      user(t);
      if (!f) return;
      if (f.fieldType === 'select' || f.fieldType === 'file') return push({ from: 'bot', text: f.fieldType === 'file' ? 'Please send a photo 📷 (use the button above).' : 'Please tap one of the choices above 👆' });
      if (VALID[f.fieldType] && !VALID[f.fieldType](t)) return push({ from: 'bot', text: `That doesn't look right. ${HINT[f.fieldType]}` });
      return askNext(pending.key, n, pending.idx + 1, { ...pending.answers, [f.key]: t });
    }
    user(t);
    push({ from: 'bot', text: 'Please tap one of the options above 👆 or send *hi* to start again.' });
  };
  const again = () => { setPending(null); setSheet(null); goto(start); };

  /* ---------------- render ---------------- */
  return (
    <div>
      <div className="row-between" style={{ marginBottom: 8 }}>
        <b style={{ fontFamily: 'var(--font-display)' }}>WhatsApp preview</b>
        <button className="btn small secondary" onClick={restart}>↻ Restart</button>
      </div>
      <div className="phone">
        <div className="phone-screen">
          <div className="wa-head"><div className="wa-avatar">💬</div><div><b>{businessName}</b><small>Business account · simulator</small></div></div>
          <div className="wa-body" ref={bodyRef}>
            {msgs.map((m) => (
              m.from === 'sys' ? <div key={m.id} className="wa-sys">{m.text}</div> : (
                <div key={m.id} className={`wa-msg ${m.from}`}>
                  {(m.text || m.card) && (
                    <div className={`wa-bubble ${m.card ? 'wa-card' : ''}`}>
                      {m.card && (m.card.image ? <img src={m.card.image} alt="" /> : <div className="ph">🖼 no image</div>)}
                      {m.card ? (
                        <>
                          <b>{m.card.title}</b>
                          {m.card.desc && <div>{m.card.desc}</div>}
                          {m.card.link && <div style={{ color: '#027eb5', wordBreak: 'break-all' }}>🔗 {m.card.linkLabel || 'Open'}: {m.card.link}</div>}
                        </>
                      ) : m.text}
                    </div>
                  )}
                  {m.buttons?.map((b, i) => <button key={i} className="wa-btn" onClick={() => act(b.act)}>{b.title}</button>)}
                  {m.list && <button className="wa-btn" onClick={() => setSheet(m.list)}>☰ {m.list.title}</button>}
                </div>
              )
            ))}
          </div>
          <form className="wa-foot" onSubmit={send}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={pending ? 'Type your answer…' : 'Message'} />
            <button aria-label="Send">➤</button>
          </form>
          {sheet && (
            <div className="wa-sheet" onClick={() => setSheet(null)}>
              <div className="wa-sheet-inner" onClick={(e) => e.stopPropagation()}>
                <h5>{sheet.title}</h5>
                {sheet.rows.map((r, i) => <button key={i} className="wa-row" onClick={() => act(r.act)}>{r.title}</button>)}
              </div>
            </div>
          )}
        </div>
      </div>
      <p className="helper-text" style={{ marginTop: 8 }}>Approximation of how WhatsApp will show this flow. Type <b>hi</b> to restart.</p>
    </div>
  );
}
