import { useEffect, useState } from 'react';
import { useAuth } from '../../../context/AuthContext';
import { api, uploadImage } from '../../../api/client';
import { FIELD_TYPES, SHOP_LIMITS, WA, choiceKind, slugifyKey, titleLimit } from './flowUtils';

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

/* ============================================================================
   SHOP nodes — they run on the admin's LIVE Product / Category / Branch pages
   ============================================================================ */

// Categories + products + outlets of this admin (shared by every shop editor; cached for 20 s)
let shopCache = null;
const loadShopData = () => {
  if (shopCache && Date.now() - shopCache.at < 20000) return shopCache.p;
  const p = Promise.all([api('/categories'), api('/products'), api('/branches')]).then(([c, pr, b]) => ({ cats: c.data, prods: pr.data, branches: b.data }));
  shopCache = { at: Date.now(), p };
  p.catch(() => { shopCache = null; });
  return p;
};
function useShopData() {
  const [d, setD] = useState({ loading: true, cats: [], prods: [], branches: [], err: '' });
  useEffect(() => {
    let on = true;
    loadShopData().then((r) => on && setD({ loading: false, ...r, err: '' })).catch((e) => on && setD((x) => ({ ...x, loading: false, err: e.message })));
    return () => { on = false; };
  }, []);
  return d;
}

const Explain = ({ children }) => <p className="helper-text" style={{ marginBottom: 10 }}>{children}</p>;

/* ------------------------------ SHOP node ------------------------------ */
export function ShopEditor({ node, keys, onChange }) {
  const { loading, cats, prods, err } = useShopData();
  const xs = node.shopExtras || [];
  const selCats = node.shopCategories || [];
  const selProds = node.shopProducts || [];
  const [showProds, setShowProds] = useState(selProds.length > 0);
  const setX = (i, patch) => onChange({ shopExtras: xs.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const activeCats = cats.filter((c) => c.active);
  const shown = selCats.length ? activeCats.filter((c) => selCats.includes(c.key)) : activeCats;
  const rowsUsed = shown.length + xs.length;                    // + 1 more when the customer already has a cart
  const toggle = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  return (
    <>
      <Explain>
        Customers get: <b>menu → category → product → size → quantity → cart</b>. Categories, products, sizes, prices and stock are read <b>live</b> from your
        <b> Product section</b> — change a product there and the chat changes with it. Use <code>{'{shop}'}</code> in the welcome message for your shop name.
      </Explain>
      {err && <div className="error-text">Could not load your products: {err}</div>}

      <h4>Categories shown in the menu</h4>
      <div className="stack" style={{ gap: 6, marginBottom: 10 }}>
        <label className="check" style={{ margin: 0 }}><input type="radio" checked={selCats.length === 0} onChange={() => onChange({ shopCategories: [], shopProducts: [] })} />
          All active categories {!loading && <span className="muted">({activeCats.length} now: {activeCats.map((c) => c.label).join(', ') || '—'})</span>}</label>
        <label className="check" style={{ margin: 0 }}><input type="radio" checked={selCats.length > 0} onChange={() => activeCats[0] && onChange({ shopCategories: [activeCats[0].key] })} disabled={!activeCats.length} />Only the categories I tick</label>
      </div>
      {selCats.length > 0 && (
        <div className="sub-card">
          {cats.map((c) => (
            <label key={c.key} className="check" style={{ margin: '2px 0' }}>
              <input type="checkbox" checked={selCats.includes(c.key)} onChange={() => { const next = toggle(selCats, c.key); onChange({ shopCategories: next, shopProducts: selProds.filter((code) => prods.find((p) => p.code === code && next.includes(p.category))) }); }} />
              {c.emoji} {c.label} <span className="muted">· {c.products} product{c.products === 1 ? '' : 's'}{!c.active ? ' · inactive' : ''}</span>
            </label>
          ))}
        </div>
      )}
      {!loading && !err && cats.length === 0 && <div className="warn">You have no categories yet. Add categories and products in the Product section first.</div>}

      <div style={{ margin: '4px 0 10px' }}>
        <button type="button" className="btn ghost small" onClick={() => setShowProds((v) => !v)}>{showProds ? '▾' : '▸'} Limit to specific products (optional){selProds.length ? ` — ${selProds.length} chosen` : ''}</button>
        {showProds && (
          <div className="sub-card">
            <p className="helper-text" style={{ marginBottom: 6 }}>Leave everything unticked to offer every available product of the chosen categories.</p>
            {shown.map((c) => (
              <div key={c.key} style={{ marginBottom: 6 }}>
                <b style={{ fontSize: 12.5 }}>{c.emoji} {c.label}</b>
                {prods.filter((p) => p.category === c.key).map((p) => (
                  <label key={p.code} className="check" style={{ margin: '1px 0 1px 12px' }}>
                    <input type="checkbox" checked={selProds.includes(p.code)} onChange={() => onChange({ shopProducts: toggle(selProds, p.code) })} />
                    {p.name} <span className="muted">· {p.code}{p.available ? '' : ' · switched off'}</span>
                  </label>
                ))}
              </div>
            ))}
            {selProds.length > 0 && <button type="button" className="btn ghost small" onClick={() => onChange({ shopProducts: [] })}>Clear selection</button>}
          </div>
        )}
      </div>

      <h4>Extra menu rows (after the categories)</h4>
      <Explain>Rows that lead to other nodes — e.g. Bulk &amp; Gifting, Track my order, Our outlets. WhatsApp lists hold {SHOP_LIMITS.ROWS_MAX} rows in total; the customer's “My cart” row is added on top when they have items.</Explain>
      {xs.map((x, i) => (
        <div className="sub-card" key={i}>
          <div className="field-row">
            <input style={{ flex: '1 1 170px' }} value={x.text} onChange={(e) => setX(i, { text: e.target.value })} placeholder="Row title, e.g. 🎁 Bulk & Gifting" />
            <div style={{ flex: '0 0 170px' }}><NextSelect value={x.next} onChange={(v) => setX(i, { next: v })} keys={keys} none="— choose a node —" /></div>
            <button type="button" className="btn ghost small" onClick={() => onChange({ shopExtras: xs.filter((_, j) => j !== i) })} aria-label="Remove row">✕</button>
          </div>
          <input style={{ marginTop: 6, fontSize: 12.5 }} value={x.description || ''} onChange={(e) => setX(i, { description: e.target.value })} placeholder="Small description under the title (optional)" />
          <Counter text={x.text} max={WA.LIST_TITLE} />
        </div>
      ))}
      <button type="button" className="btn outline small" onClick={() => onChange({ shopExtras: [...xs, { text: '', description: '', next: '' }] })} disabled={xs.length >= SHOP_LIMITS.EXTRAS_MAX}>+ Add menu row</button>
      {!loading && rowsUsed >= SHOP_LIMITS.ROWS_MAX && <div className="warn" style={{ marginTop: 8 }}>{shown.length} categories + {xs.length} extra rows fill the {SHOP_LIMITS.ROWS_MAX}-row WhatsApp list. Extra rows are always kept; some categories will be hidden — tick fewer categories above.</div>}

      <label style={{ marginTop: 14 }}>When the customer taps “🧾 Checkout”, continue to
        <NextSelect value={node.checkoutNext} onChange={(v) => onChange({ checkoutNext: v })} keys={keys} none="— choose a node (usually the Checkout node) —" />
      </label>
    </>
  );
}

/* ------------------------------ CHECKOUT node ------------------------------ */
export function CheckoutEditor({ node, onChange }) {
  const { branches, loading } = useShopData();
  const live = branches.filter((b) => b.active);
  return (
    <>
      <Explain>
        Runs the order steps: <b>name → delivery / pickup → location pin → nearest outlet that has every item in stock → address</b> (or <b>outlet → pickup time</b>) →
        <b> order summary → Razorpay payment link</b>. When the customer pays, the order appears in Orders and they get the confirmation here.
        Delivery fee, free-delivery amount and delivery radius come from <b>Setup</b>; outlets from <b>Outlets</b>.
      </Explain>
      <div className="stack" style={{ gap: 6 }}>
        <label className="check" style={{ margin: 0 }}><input type="checkbox" checked={node.allowDelivery !== false} onChange={(e) => onChange({ allowDelivery: e.target.checked })} />🚚 Offer home delivery</label>
        <label className="check" style={{ margin: 0 }}><input type="checkbox" checked={node.allowPickup !== false} onChange={(e) => onChange({ allowPickup: e.target.checked })} />🏬 Offer self pickup</label>
        <label className="check" style={{ margin: 0 }}><input type="checkbox" checked={node.askName !== false} onChange={(e) => onChange({ askName: e.target.checked })} />Ask for the customer's name <span className="muted">(off = use their WhatsApp profile name)</span></label>
      </div>
      {node.allowDelivery === false && node.allowPickup === false && <div className="error-text">Allow at least one of delivery or pickup.</div>}
      {node.allowDelivery !== false && node.allowPickup !== false && <p className="helper-text" style={{ margin: '6px 0 0' }}>With both on, the customer chooses; with one on, that question is skipped.</p>}
      <div className="field-row" style={{ marginTop: 12, alignItems: 'flex-start' }}>
        <label style={{ flex: 1, minWidth: 220 }}>Name question (optional)
          <input value={node.namePrompt || ''} onChange={(e) => onChange({ namePrompt: e.target.value })} placeholder="Please enter your *full name*:" />
        </label>
        <label style={{ flex: 1, minWidth: 220 }}>Address question (optional)
          <input value={node.addressPrompt || ''} onChange={(e) => onChange({ addressPrompt: e.target.value })} placeholder="Now send your *full delivery address with landmark & pincode*:" />
        </label>
      </div>
      {!loading && live.length === 0 && <div className="warn">You have no active outlets. Add at least one in Outlets — orders are routed to an outlet.</div>}
      {!loading && live.length > 0 && <p className="helper-text" style={{ marginTop: 6 }}>Active outlets: {live.map((b) => b.name).join(', ')}</p>}
    </>
  );
}

/* ------------------------------ BULK node ------------------------------ */
export function BulkEditor({ node, keys, onChange }) {
  const os = node.bulkOccasions || [];
  const setO = (i, patch) => onChange({ bulkOccasions: os.map((o, j) => {
    if (j !== i) return o;
    const u = { ...o, ...patch };
    if (patch.label !== undefined) u.key = slugifyKey(patch.label.replace(/[^\p{L}\p{N} ]/gu, ''), os.filter((_, k) => k !== i).map((x) => x.key)).replace(/_/g, '-').slice(0, 30);
    return u;
  }) });
  return (
    <>
      <Explain>Asks: <b>occasion → what do you need → needed by</b>, saves it under <b>Bulk enquiries</b> and alerts the owner's WhatsApp number (Setup).</Explain>
      <h4>Occasions (list rows)</h4>
      {os.map((o, i) => (
        <div className="sub-card" key={i}>
          <div className="field-row">
            <div style={{ flex: '1 1 200px' }}><input value={o.label} onChange={(e) => setO(i, { label: e.target.value })} placeholder="e.g. 💍 Wedding" /><Counter text={o.label} max={WA.LIST_TITLE} /></div>
            <span className="muted mono">saved as: {o.key}</span>
            <button type="button" className="btn ghost small" onClick={() => onChange({ bulkOccasions: os.filter((_, j) => j !== i) })} aria-label="Remove occasion">✕</button>
          </div>
        </div>
      ))}
      <button type="button" className="btn outline small" style={{ marginBottom: 12 }} disabled={os.length >= SHOP_LIMITS.OCCASIONS_MAX}
        onClick={() => onChange({ bulkOccasions: [...os, { key: slugifyKey('occasion', os.map((x) => x.key)).replace(/_/g, '-'), label: '' }] })}>+ Add occasion</button>
      <div className="field-row" style={{ alignItems: 'flex-start' }}>
        <label style={{ flex: 1, minWidth: 220 }}>“What do you need?” question (optional)
          <input value={node.bulkDetailsPrompt || ''} onChange={(e) => onChange({ bulkDetailsPrompt: e.target.value })} placeholder="Please tell us *what you need* — items, quantity and budget:" />
        </label>
        <label style={{ flex: 1, minWidth: 220 }}>“When do you need it?” question (optional)
          <input value={node.bulkDatePrompt || ''} onChange={(e) => onChange({ bulkDatePrompt: e.target.value })} placeholder='When do you need it? (date & time, e.g. "25 Oct evening")' />
        </label>
      </div>
      <label>Thank-you message (optional — use {'{id}'} for the enquiry number and {'{name}'})
        <textarea rows={2} value={node.bulkSuccessText || ''} onChange={(e) => onChange({ bulkSuccessText: e.target.value })} placeholder="🎁 Thank you! Your bulk enquiry *{id}* is received. Our team will contact you shortly." />
      </label>
      <label>After the enquiry is saved, continue to (optional)
        <NextSelect value={node.bulkNext} onChange={(v) => onChange({ bulkNext: v })} keys={keys} none="— end conversation —" />
      </label>
    </>
  );
}

/* ------------------------------ TRACK node ------------------------------ */
export function TrackEditor({ node, keys, onChange }) {
  return (
    <>
      <Explain>Sends the status of this customer's latest order (matched by their WhatsApp number): confirmed / packed / ready for pickup / out for delivery (with rider details) / delivered, or the pending payment link.</Explain>
      <label>After the status, continue to (optional)
        <NextSelect value={node.trackNext} onChange={(v) => onChange({ trackNext: v })} keys={keys} none="— stay where the customer was (cart is kept) —" />
      </label>
    </>
  );
}

/* ------------------------------ OUTLETS node ------------------------------ */
export function OutletsEditor({ node, keys, onChange }) {
  const { branches, loading } = useShopData();
  const live = branches.filter((b) => b.active);
  return (
    <>
      <Explain>Sends your active outlets from the <b>Outlets</b> page — name, address, phone and opening hours{!loading && live.length ? ` (${live.length} active now)` : ''}.</Explain>
      <label className="check"><input type="checkbox" checked={node.outletsMaps !== false} onChange={(e) => onChange({ outletsMaps: e.target.checked })} />Also send a map pin for the first 3 outlets</label>
      <label>After the outlets, continue to (optional)
        <NextSelect value={node.outletsNext} onChange={(v) => onChange({ outletsNext: v })} keys={keys} none="— stay where the customer was (cart is kept) —" />
      </label>
    </>
  );
}
