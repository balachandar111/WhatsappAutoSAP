import { useState } from 'react';
import { useAuth } from '../../../context/AuthContext';
import { uploadImage } from '../../../api/client';
import { FIELD_TYPES, WA, choiceKind, slugifyKey, titleLimit } from './flowUtils';

/* ---------------------------- small shared bits ---------------------------- */
function ImagePicker({ value, onChange, emptyLabel = 'No image' }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const pick = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setBusy(true); setErr('');
    try { const { url } = await uploadImage(file); onChange(url); } catch (er) { setErr(er.message); }
    setBusy(false);
  };
  return (
    <div style={{ flex: '0 0 96px' }}>
      {value ? <img className="thumb" src={value} alt="" /> : <div className="thumb-empty">{emptyLabel}</div>}
      <label className="btn small secondary" style={{ marginTop: 6, marginBottom: 0, cursor: 'pointer', display: 'flex' }}>
        {busy ? 'Uploading…' : value ? 'Change' : 'Upload'}
        <input type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={pick} />
      </label>
      {value && <button type="button" className="btn small ghost" style={{ width: '100%', marginTop: 2 }} onClick={() => onChange('')}>Remove</button>}
      {err && <div className="error-text" style={{ fontSize: 11.5 }}>{err}</div>}
    </div>
  );
}

const NextSelect = ({ value, onChange, keys, none = '— end conversation —', disabled }) => (
  <select value={value || ''} onChange={(e) => onChange(e.target.value || null)} disabled={disabled}>
    <option value="">{none}</option>
    {keys.map((k) => <option key={k} value={k}>→ {k}</option>)}
  </select>
);

const Counter = ({ text, max }) => {
  const n = (text || '').length;
  return <div className={'counter' + (n > max ? ' over' : '')}>{n}/{max}</div>;
};

const swap = (arr, i, j) => { const a = [...arr]; [a[i], a[j]] = [a[j], a[i]]; return a; };

/* ------------------------------ MESSAGE node ------------------------------ */
export function MessageEditor({ node, keys, onChange }) {
  const { isEcommerce } = useAuth();
  const opts = node.options || [];
  const setOpt = (i, patch) => onChange({ options: opts.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  const addOpt = () => onChange({ options: [...opts, { label: String.fromCharCode(65 + (opts.length % 26)), text: '', next: '', url: '', handoff: '' }] });
  const delOpt = (i) => onChange({ options: opts.filter((_, j) => j !== i).map((o, j) => ({ ...o, label: String.fromCharCode(65 + (j % 26)) })) });
  const kind = choiceKind(opts.length);
  const max = titleLimit(opts.length);

  return (
    <>
      <label className="check" style={{ marginBottom: 10 }}>
        <input type="checkbox" checked={!!node.isEnd} onChange={(e) => onChange({ isEnd: e.target.checked, options: e.target.checked ? [] : opts })} />
        This is a final message (conversation ends after it)
      </label>
      {!node.isEnd && (
        <>
          {opts.map((o, i) => (
            <div className="sub-card" key={i}>
              <div className="field-row">
                <span className="badge gray">{String.fromCharCode(65 + (i % 26))}</span>
                <div style={{ flex: '1 1 200px' }}>
                  <input value={o.text} onChange={(e) => setOpt(i, { text: e.target.value })} placeholder="Button text shown to the customer" />
                  <Counter text={o.text} max={max} />
                </div>
                <div style={{ flex: '0 0 170px' }}><NextSelect value={o.next} onChange={(v) => setOpt(i, { next: v })} keys={keys} disabled={o.handoff === 'commerce'} /></div>
                <button type="button" className="btn ghost small" onClick={() => delOpt(i)} aria-label="Remove option">✕</button>
              </div>
              <input style={{ marginTop: 6, fontSize: 12.5, borderStyle: 'dashed' }} value={o.url || ''} onChange={(e) => setOpt(i, { url: e.target.value })}
                placeholder="🔗 Link (optional) — the bot sends this link when the option is tapped" />
              {(isEcommerce || o.handoff === 'commerce') && (
                <label className="check" style={{ marginTop: 6, marginBottom: 0 }}>
                  <input type="checkbox" checked={o.handoff === 'commerce'} onChange={(e) => setOpt(i, { handoff: e.target.checked ? 'commerce' : '' })} />
                  🛒 Hand this chat over to the ordering bot when tapped{!isEcommerce && <span className="muted"> (needs Ecommerce — ask the Super Admin)</span>}
                </label>
              )}
            </div>
          ))}
          <button type="button" className="btn outline small" onClick={addOpt} disabled={opts.length >= WA.OPTIONS_MAX}>+ Add option</button>
          <p className="helper-text" style={{ marginTop: 8 }}>
            {opts.length === 0 && 'Add the choices the customer can tap.'}
            {kind === 'buttons' && opts.length > 0 && `Shown as ${opts.length} reply button${opts.length > 1 ? 's' : ''} (max 3, 20 characters each).`}
            {kind === 'list' && `Shown as a list menu (4–10 rows, 24 characters each).`}
            {kind === 'paged' && `Shown as a list menu in pages of 9 with a “More…” row (up to ${WA.OPTIONS_MAX} options).`}
            {kind === 'too_many' && `A message can have at most ${WA.OPTIONS_MAX} options.`}
            {' '}Option with a link only → the bot sends the link and shows these options again. “End conversation” stops the flow.
          </p>
        </>
      )}
    </>
  );
}

/* ------------------------------ PRODUCTS node ------------------------------ */
export function ProductsEditor({ node, keys, onChange }) {
  const ps = node.products || [];
  const setP = (i, patch) => onChange({ products: ps.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  return (
    <>
      <p className="helper-text" style={{ marginBottom: 8 }}>Each card is sent as its own WhatsApp image message with the title, description and link in the caption.</p>
      {ps.map((p, i) => (
        <div className="sub-card row" key={i}>
          <ImagePicker value={p.image} onChange={(url) => setP(i, { image: url })} />
          <div className="stack" style={{ flex: 1, gap: 8 }}>
            <input value={p.title} onChange={(e) => setP(i, { title: e.target.value })} placeholder="Product title" />
            <textarea rows={2} value={p.description} onChange={(e) => setP(i, { description: e.target.value })} placeholder="Short description" />
            <div className="field-row">
              <input style={{ flex: '0 0 190px', width: 190 }} value={p.buttonText} onChange={(e) => setP(i, { buttonText: e.target.value })} placeholder="Link label (e.g. Order here)" />
              <input style={{ flex: 1, minWidth: 160 }} value={p.redirectUrl} onChange={(e) => setP(i, { redirectUrl: e.target.value })} placeholder="Link (https://…)" />
              <button type="button" className="btn ghost small" onClick={() => onChange({ products: ps.filter((_, j) => j !== i) })} aria-label="Remove card">✕</button>
            </div>
          </div>
        </div>
      ))}
      <button type="button" className="btn outline small" style={{ marginBottom: 12 }}
        onClick={() => onChange({ products: [...ps, { image: '', title: '', description: '', buttonText: 'View', redirectUrl: '' }] })}>+ Add product card</button>
      <label>After the cards, show a “Continue” button leading to (optional)
        <NextSelect value={node.productsNext} onChange={(v) => onChange({ productsNext: v })} keys={keys} none="— end conversation —" />
      </label>
    </>
  );
}

/* ------------------------------ STEPS node ------------------------------ */
export function StepsEditor({ node, keys, onChange }) {
  const ss = node.steps || [];
  const setS = (i, patch) => onChange({ steps: ss.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const move = (i, d) => { if (i + d >= 0 && i + d < ss.length) onChange({ steps: swap(ss, i, i + d) }); };
  return (
    <>
      <p className="helper-text" style={{ marginBottom: 8 }}>Sent one step at a time with <b>◀ Back</b> / <b>Next ▶</b> buttons — great for cooking, setup or usage instructions.</p>
      {ss.map((s, i) => (
        <div className="sub-card row" key={i}>
          <ImagePicker value={s.image} onChange={(url) => setS(i, { image: url })} emptyLabel="No photo" />
          <div className="stack" style={{ flex: 1, gap: 8 }}>
            <div className="field-row">
              <span className="badge blue">Step {i + 1}</span>
              <input style={{ flex: 1, minWidth: 140 }} value={s.title} onChange={(e) => setS(i, { title: e.target.value })} placeholder="Step title (e.g. Wash & soak)" />
              <button type="button" className="btn ghost small" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
              <button type="button" className="btn ghost small" disabled={i === ss.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
              <button type="button" className="btn ghost small" onClick={() => onChange({ steps: ss.filter((_, j) => j !== i) })} aria-label="Remove step">✕</button>
            </div>
            <textarea rows={2} value={s.desc} onChange={(e) => setS(i, { desc: e.target.value })} placeholder="Instructions shown to the customer" />
          </div>
        </div>
      ))}
      <button type="button" className="btn outline small" style={{ marginBottom: 12 }} onClick={() => onChange({ steps: [...ss, { image: '', title: '', desc: '' }] })}>+ Add step</button>

      <h4>Closing message (after “Finish” on the last step)</h4>
      <div className="sub-card row">
        <ImagePicker value={node.closingImage} onChange={(url) => onChange({ closingImage: url })} emptyLabel="No photo" />
        <div className="stack" style={{ flex: 1, gap: 8 }}>
          <input value={node.closingTitle || ''} onChange={(e) => onChange({ closingTitle: e.target.value })} placeholder='Title (optional) — default "All done! 🎉"' />
          <textarea rows={2} value={node.closingMessage || ''} onChange={(e) => onChange({ closingMessage: e.target.value })} placeholder="Message (optional)" />
        </div>
      </div>
      <label>After the closing message, continue to (optional)
        <NextSelect value={node.stepsNext} onChange={(v) => onChange({ stepsNext: v })} keys={keys} />
      </label>
    </>
  );
}

/* ------------------------------ FORM node ------------------------------ */
export function FormEditor({ node, keys, onChange }) {
  const fs = node.formFields || [];
  const set = (fields) => onChange({ formFields: fields });

  const addField = () => {
    const ks = fs.map((f) => f.key);
    set([...fs, { key: slugifyKey(`field${fs.length + 1}`, ks), label: '', fieldType: 'text', required: false, placeholder: '', options: [], showIf: null }]);
  };

  const update = (idx, patch) => {
    const prev = fs[idx];
    let next = fs.map((f, i) => {
      if (i !== idx) return f;
      const u = { ...f, ...patch };
      if (patch.label !== undefined) u.key = slugifyKey(patch.label, fs.filter((_, j) => j !== idx).map((x) => x.key));
      if (patch.fieldType !== undefined) {
        if (patch.fieldType === 'select' && !(u.options || []).length) u.options = ['', ''];
        if (patch.fieldType !== 'select') u.options = [];
      }
      return u;
    });
    // a later field's "show if" must not dangle if its trigger was renamed or stopped being a choice field
    const keyChanged = next[idx].key !== prev.key;
    const stoppedSelect = patch.fieldType !== undefined && patch.fieldType !== 'select' && prev.fieldType === 'select';
    if (keyChanged || stoppedSelect) next = next.map((f) => (f.showIf?.field === prev.key ? { ...f, showIf: null } : f));
    set(next);
  };

  const setOption = (idx, oi, val) => update(idx, { options: fs[idx].options.map((o, j) => (j === oi ? val : o)) });
  const remove = (idx) => {
    const k = fs[idx].key;
    set(fs.filter((_, i) => i !== idx).map((f) => (f.showIf?.field === k ? { ...f, showIf: null } : f)));
  };

  return (
    <>
      <p className="helper-text" style={{ marginBottom: 8 }}>WhatsApp has no on-screen forms, so the bot asks each field as a question, one after another. Answers are saved as a submission.</p>
      {fs.map((f, idx) => {
        const triggers = fs.slice(0, idx).filter((x) => x.fieldType === 'select' && x.key);
        const filled = (f.options || []).filter((o) => o.trim()).length;
        return (
          <div className="sub-card" key={idx}>
            <div className="field-row">
              <input style={{ flex: '1 1 220px' }} value={f.label} onChange={(e) => update(idx, { label: e.target.value })} placeholder="Question the bot asks (e.g. What is your name?)" />
              <select style={{ flex: '0 0 210px', width: 210 }} value={f.fieldType} onChange={(e) => update(idx, { fieldType: e.target.value })}>
                {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <label className="check" style={{ margin: 0 }}><input type="checkbox" checked={!!f.required} onChange={(e) => update(idx, { required: e.target.checked })} />Required</label>
              <button type="button" className="btn ghost small" onClick={() => remove(idx)} aria-label="Remove field">✕</button>
            </div>
            <div className="muted mono" style={{ margin: '4px 2px 0' }}>saved as: {f.key}</div>

            {f.fieldType === 'select' && (
              <div style={{ marginTop: 8 }}>
                <span className="helper-text">Choices — {choiceKind(filled) === 'buttons' ? 'shown as reply buttons' : 'shown as a list'} ({titleLimit(filled)} characters max each)</span>
                {(f.options || []).map((o, oi) => (
                  <div className="field-row" key={oi} style={{ marginTop: 4 }}>
                    <input style={{ flex: '1 1 160px' }} value={o} onChange={(e) => setOption(idx, oi, e.target.value)} placeholder={`Choice ${oi + 1}`} />
                    <button type="button" className="btn ghost small" onClick={() => update(idx, { options: f.options.filter((_, j) => j !== oi) })}>✕</button>
                  </div>
                ))}
                <button type="button" className="btn outline small" style={{ marginTop: 6 }} disabled={(f.options || []).length >= WA.LIST_MAX} onClick={() => update(idx, { options: [...(f.options || []), ''] })}>+ Add choice</button>
              </div>
            )}

            {triggers.length > 0 && (
              <div className="field-row" style={{ marginTop: 8 }}>
                <span className="helper-text">Ask this only if</span>
                <select style={{ width: 'auto' }} value={f.showIf?.field || ''} onChange={(e) => update(idx, { showIf: e.target.value ? { field: e.target.value, equals: '' } : null })}>
                  <option value="">— always ask —</option>
                  {triggers.map((t) => <option key={t.key} value={t.key}>{t.label || t.key}</option>)}
                </select>
                {f.showIf?.field && (
                  <>
                    <span className="helper-text">is</span>
                    <select style={{ width: 'auto' }} value={f.showIf.equals || ''} onChange={(e) => update(idx, { showIf: { ...f.showIf, equals: e.target.value } })}>
                      <option value="">— pick an answer —</option>
                      {(triggers.find((t) => t.key === f.showIf.field)?.options || []).filter(Boolean).map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
      <button type="button" className="btn outline small" style={{ marginBottom: 12 }} onClick={addField}>+ Add question</button>
      <div className="field-row" style={{ alignItems: 'flex-start' }}>
        <label style={{ flex: '0 0 210px' }}>Confirmation message title
          <input value={node.formSubmitLabel || ''} onChange={(e) => onChange({ formSubmitLabel: e.target.value })} placeholder="Submit" />
        </label>
        <label style={{ flex: 1, minWidth: 200 }}>After the last answer, continue to (optional)
          <NextSelect value={node.formNext} onChange={(v) => onChange({ formNext: v })} keys={keys} none="— end conversation (thank-you) —" />
        </label>
      </div>
    </>
  );
}
