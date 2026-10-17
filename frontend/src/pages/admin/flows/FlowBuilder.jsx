import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, download, upload } from '../../../api/client';
import { useAuth } from '../../../context/AuthContext';
import Modal from '../../../components/Modal';
import { Loader } from '../../../components/common';
import { Badge } from '../../../lib/ui';
import AutomationModal from '../../../components/AutomationModal';
import SimulatorModal from '../../../components/SimulatorModal';
import FlowMap from './FlowMap';
import WhatsAppPreview from './WhatsAppPreview';
import { BulkEditor, CheckoutEditor, FormEditor, MessageEditor, OutletsEditor, ProductsEditor, ShopEditor, StepsEditor, TrackEditor } from './NodeEditors';
import { LANGS, LANG_RE, MAX_LANGS, NEXT_FIELDS, NODE_TYPES, WA, blankFlow, buildFlowState, convertNode, langLabel, nextNodeKey, validateFlow } from './flowUtils';

const EDITORS = { message: MessageEditor, products: ProductsEditor, steps: StepsEditor, form: FormEditor, shop: ShopEditor, checkout: CheckoutEditor, bulk: BulkEditor, track: TrackEditor, outlets: OutletsEditor };
// these node types send no text of their own (everything comes from the live Product / Outlet / Order data)
const NO_TEXT = ['checkout', 'track', 'outlets'];
const TEXT_LABEL = { message: 'Message text', form: 'Intro text (sent before the first question)', shop: 'Welcome message (shown above the menu)', bulk: 'Intro text (shown above the occasion list)' };
const TEXT_HINT = { message: 'e.g. How can we help you today?', shop: 'e.g. 🙏 Welcome to *{shop}*!' };

export default function FlowBuilder() {
  const { id } = useParams();
  const nav = useNavigate();
  const { isEcommerce } = useAuth();
  const [doc, setDoc] = useState(null);
  const [name, setName] = useState('');
  const [flow, setFlow] = useState({});
  const [lang, setLang] = useState('english');
  const [view, setView] = useState('map');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [serverIssues, setServerIssues] = useState(null);   // { errors: string[], warnings: string[] } from the last save
  const [attached, setAttached] = useState([]);              // automations using this flow
  const [showPreview, setShowPreview] = useState(true);
  const [showAuto, setShowAuto] = useState(false);
  const [showChecks, setShowChecks] = useState(true);
  const [showLang, setShowLang] = useState(false);
  const [showTest, setShowTest] = useState(false);
  const [bizName, setBizName] = useState('Your business');
  const [loadErr, setLoadErr] = useState('');
  const fileRef = useRef(null);
  const refs = useRef({});

  const hydrate = (d) => { setDoc(d); setName(d.name); setFlow(buildFlowState(d)); setLang((l) => (d.languages.includes(l) ? l : d.languages[0])); setDirty(false); };

  useEffect(() => {
    api(`/chatflows/${id}`).then((r) => { hydrate(r.data); setServerIssues(r.data.validation && !r.data.validation.valid ? { errors: r.data.validation.errors, warnings: r.data.validation.warnings } : null); }).catch((e) => setLoadErr(e.message));
    api('/setup').then((r) => r.data.values.shopName && setBizName(r.data.values.shopName)).catch(() => {});
    api('/automations').then((r) => setAttached(r.data.filter((a) => a.chatflow?.id === id))).catch(() => {});
  }, [id]);

  // warn before leaving with unsaved edits
  useEffect(() => {
    if (!dirty) return;
    const h = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const langs = Object.keys(flow);
  const { errors, warnings } = useMemo(() => (doc ? validateFlow(flow, Object.keys(flow), { ecommerce: isEcommerce }) : { errors: [], warnings: [] }), [flow, doc, isEcommerce]);

  if (loadErr) return <div className="error">{loadErr} <Link to="/app/flows">Back to flows</Link></div>;
  if (!doc) return <Loader />;

  const lf = flow[lang] || blankFlow();
  const questions = lf.questions;
  const keys = Object.keys(questions);

  /* ---------------- state updates (all immutable) ---------------- */
  const updateLF = (fn) => { setFlow((p) => ({ ...p, [lang]: fn(p[lang] || blankFlow()) })); setDirty(true); };
  const updateNode = (key, patch) => updateLF((l) => ({ ...l, questions: { ...l.questions, [key]: { ...l.questions[key], ...patch } } }));
  const addNode = (type = 'message') => updateLF((l) => ({ ...l, questions: { ...l.questions, [nextNodeKey(l.questions)]: convertNode(type) } }));

  const setNodeType = (key, t) => updateLF((l) => ({ ...l, questions: { ...l.questions, [key]: convertNode(t, l.questions[key]) } }));

  const removeNode = (key) => updateLF((l) => {
    const questions = {};
    Object.entries(l.questions).filter(([k]) => k !== key).forEach(([k, n]) => {
      const c = { ...n };
      if (c.options) c.options = c.options.map((o) => (o.next === key ? { ...o, next: '' } : o));
      if (c.shopExtras) c.shopExtras = c.shopExtras.map((x) => (x.next === key ? { ...x, next: '' } : x));
      NEXT_FIELDS.forEach((f) => { if (c[f] === key) c[f] = null; });
      questions[k] = c;
    });
    let start = l.start;
    if (start === key) start = Object.keys(questions).find((k) => (questions[k].nodeType || 'message') === 'message' && !questions[k].isEnd) || Object.keys(questions)[0] || '';
    return { ...l, questions, start };
  });

  const jump = (l, key) => {
    setLang(l); setView('list');
    setTimeout(() => {
      const el = refs.current[`${l}:${key}`];
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.classList.add('flowmap-jump-highlight');
      setTimeout(() => el?.classList.remove('flowmap-jump-highlight'), 1600);
    }, 80);
  };

  /* ---------------- languages ---------------- */
  const addLanguage = (l, copyFrom) => {
    setFlow((p) => ({ ...p, [l]: copyFrom && p[copyFrom] ? JSON.parse(JSON.stringify(p[copyFrom])) : blankFlow() }));
    setLang(l); setDirty(true); setShowLang(false);
  };
  const removeLanguage = (l) => {
    if (langs.length <= 1) return;
    if (!confirm(`Remove the ${langLabel(l)} flow? Its nodes are deleted when you save.`)) return;
    setFlow((p) => { const n = { ...p }; delete n[l]; return n; });
    if (lang === l) setLang(langs.find((x) => x !== l));
    setDirty(true);
  };

  /* ---------------- save ---------------- */
  const save = async () => {
    if (!name.trim()) return setMsg({ ok: false, text: 'Give the flow a name first.' });
    setSaving(true); setMsg(null);
    try {
      if (name.trim() !== doc.name) await api(`/chatflows/${id}`, { method: 'PUT', body: { name: name.trim() } });
      const r = await api(`/chatflows/${id}/flow`, { method: 'PUT', body: { flow } });
      setDoc(r.data); setName(r.data.name); setDirty(false);
      setServerIssues(r.errors.length || r.warnings.length ? { errors: r.errors, warnings: r.warnings } : null);
      const live = attached.filter((a) => a.active).map((a) => a.name);
      setMsg(r.valid
        ? { ok: true, text: live.length ? `Saved ✅ Changes are now live in: ${live.join(', ')}.` : 'Saved ✅ This flow is Ready — attach it to an automation to use it on WhatsApp.' }
        : { ok: false, text: `Saved as a draft — fix the ${r.errors.length} problem${r.errors.length === 1 ? '' : 's'} listed below to make it live.${r.data.hasLiveVersion ? ' The previous live version keeps running until then.' : ''}` });
    } catch (er) { setMsg({ ok: false, text: er.message }); }
    setSaving(false);
  };

  /* ---------------- excel ---------------- */
  const exportExcel = async () => {
    if (dirty && !confirm('You have unsaved changes. The Excel export contains the last SAVED version. Export anyway?')) return;
    try { await download(`/chatflows/${id}/export-excel`, 'chatflow.xlsx'); } catch (er) { setMsg({ ok: false, text: er.message }); }
  };
  const importExcel = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    if (!confirm('Importing REPLACES this flow (all languages) with the contents of the Excel file. Continue?')) return;
    setSaving(true); setMsg(null);
    try {
      const r = await upload(`/chatflows/${id}/import-excel`, 'file', file);
      hydrate(r.data);
      setServerIssues(r.errors.length || r.warnings.length ? { errors: r.errors, warnings: r.warnings } : null);
      setMsg({ ok: r.valid, text: r.message });
    } catch (er) { setMsg({ ok: false, text: er.message }); }
    setSaving(false);
  };

  const errKeys = errors.filter((e) => e.lang === lang).map((e) => e.node);
  const canUse = doc.status === 'ready' && !dirty;
  const Issue = ({ i, kind }) => (
    <li>
      <span>{kind === 'e' ? '❌' : '⚠️'}</span>
      <span>{langs.length > 1 && <span className="badge gray" style={{ marginRight: 6 }}>{langLabel(i.lang)}</span>}
        {i.node !== '—' ? <button onClick={() => jump(i.lang, i.node)}>{i.node}</button> : null} {i.msg}</span>
    </li>
  );

  return (
    <>
      <div className="page-header" style={{ marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <Link to="/app/flows" className="muted">← All flows</Link>
          <input className="title-input" value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} aria-label="Flow name" />
          <div className="inline" style={{ marginTop: 2 }}>
            <Badge value={doc.status} />
            {doc.validation && !doc.validation.valid && doc.hasLiveVersion && <span className="muted">last save had problems — previous version still live</span>}
            {doc.version > 0 && <span className="muted">v{doc.version}</span>}
            {attached.map((a) => <span key={a.id} className={`badge ${a.active ? 'green' : 'gray'}`}>{a.active ? '● Live in' : 'Attached to'} {a.name}</span>)}
          </div>
        </div>
        <div className="page-actions">
          <button className="btn secondary" onClick={() => setShowPreview((s) => !s)}>{showPreview ? 'Hide preview' : '📱 Show preview'}</button>
          <button className="btn secondary" onClick={() => setShowTest(true)} disabled={!doc.hasLiveVersion || dirty}
            title={!doc.hasLiveVersion ? 'Save a valid flow first' : dirty ? 'Save your changes first — the test runs the saved version' : 'Run the real chatbot engine with your real products and outlets (nothing is sent, no orders are created)'}>🧪 Test with real data</button>
          <button className="btn secondary" onClick={exportExcel} title="Download this flow as an Excel file">⬇ Excel</button>
          <button className="btn secondary" onClick={() => fileRef.current?.click()} title="Replace this flow with an Excel file">⬆ Import</button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={importExcel} />
          <button className="btn" onClick={save} disabled={saving || !dirty}>{saving ? 'Saving…' : dirty ? 'Save flow •' : 'Saved'}</button>
          <button className="btn outline" onClick={() => setShowAuto(true)} disabled={!canUse}
            title={canUse ? '' : dirty ? 'Save your changes first' : 'Fix the problems and save to make this flow Ready'}>Use in automation →</button>
        </div>
      </div>

      {msg && <div className={msg.ok ? 'success' : 'warn'} style={{ marginTop: 0 }}>{msg.text}</div>}
      {dirty && !msg && <div className="warn" style={{ marginTop: 0 }}>Unsaved changes — customers only see what you've saved{doc.status === 'ready' ? ' (and only Ready flows go live)' : ''}.</div>}

      <div className={'builder-grid' + (showPreview ? '' : ' no-preview')}>
        <div>
          <div className="card">
            <div className="row-between">
              <div className="tabs" style={{ border: 0, margin: 0 }}>
                {langs.map((l) => (
                  <button key={l} className={'tab-btn' + (lang === l ? ' active' : '')} onClick={() => setLang(l)}>
                    {langLabel(l)}{errors.some((e) => e.lang === l) && <span style={{ color: 'var(--danger)' }}> ●</span>}
                  </button>
                ))}
                {langs.length < MAX_LANGS && <button className="tab-btn" onClick={() => setShowLang(true)} title="Add a language">+ Language</button>}
                {langs.length > 1 && <button className="tab-btn" onClick={() => removeLanguage(lang)} title={`Remove ${langLabel(lang)}`} style={{ color: 'var(--danger)' }}>Remove {langLabel(lang)}</button>}
              </div>
              <div className="view-toggle">
                <button className={view === 'map' ? 'active' : ''} onClick={() => setView('map')}>🗺️ Flow map</button>
                <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>🧱 Node list</button>
              </div>
            </div>
            <div className="field-row" style={{ marginTop: 14, alignItems: 'flex-end' }}>
              <label style={{ margin: 0, flex: '0 1 320px' }}>Start question (first message customers get)
                <select value={lf.start} onChange={(e) => updateLF((l) => ({ ...l, start: e.target.value }))}>
                  {keys.map((k) => <option key={k} value={k}>{k}{questions[k].text ? ` — ${questions[k].text.slice(0, 32)}` : ''}</option>)}
                </select>
              </label>
              <select className="btn outline small" style={{ marginLeft: 'auto', width: 'auto' }} value="" aria-label="Add a node"
                onChange={(e) => { if (e.target.value) addNode(e.target.value); e.target.value = ''; }}>
                <option value="">+ Add node…</option>
                {Object.entries(NODE_TYPES).filter(([, v]) => !v.commerce || isEcommerce).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
              </select>
            </div>
          </div>

          <div className="card">
            <div className="row-between" style={{ cursor: 'pointer' }} onClick={() => setShowChecks((s) => !s)}>
              <b>{errors.length === 0 ? '✅ Ready to go live' : `❌ ${errors.length} must fix`}{warnings.length > 0 && <span className="muted"> · ⚠️ {warnings.length} warning{warnings.length > 1 ? 's' : ''}</span>}</b>
              <span className="muted">{showChecks ? 'Hide' : 'Show'} checks</span>
            </div>
            {showChecks && (errors.length > 0 || warnings.length > 0) && (
              <ul className="issue-list">
                {errors.map((e, i) => <Issue key={'e' + i} i={e} kind="e" />)}
                {warnings.map((w, i) => <Issue key={'w' + i} i={w} kind="w" />)}
              </ul>
            )}
            {showChecks && errors.length === 0 && warnings.length === 0 && <p className="muted" style={{ marginTop: 6 }}>No problems found. WhatsApp limits: {WA.BUTTONS_MAX} buttons or {WA.LIST_MAX} list rows per message, {WA.BODY_MAX}-character bodies.</p>}
          </div>

          {serverIssues && (serverIssues.errors.length > 0 || serverIssues.warnings.length > 0) && !dirty && (
            <div className="card">
              <b>{serverIssues.errors.length ? `❌ The server found ${serverIssues.errors.length} problem${serverIssues.errors.length === 1 ? '' : 's'}` : '⚠️ Server warnings'}</b>
              <ul className="issue-list">
                {serverIssues.errors.map((m, i) => <li key={'se' + i}><span>❌</span><span>{m}</span></li>)}
                {serverIssues.warnings.map((m, i) => <li key={'sw' + i}><span>⚠️</span><span>{m}</span></li>)}
              </ul>
            </div>
          )}

          {view === 'map' && (
            <div className="card"><FlowMap questions={questions} start={lf.start} errorKeys={errKeys} onSelectNode={(k) => jump(lang, k)} /></div>
          )}

          {view === 'list' && keys.map((key) => {
            const node = questions[key];
            const t = node.nodeType || 'message';
            const Editor = EDITORS[t];
            const mine = errors.filter((e) => e.lang === lang && e.node === key);
            const myWarn = warnings.filter((e) => e.lang === lang && e.node === key);
            return (
              <div key={key} ref={(el) => { refs.current[`${lang}:${key}`] = el; }} className={`card node-card t-${t}` + (mine.length ? ' has-error' : '')}>
                <div className="field-row" style={{ marginBottom: 10 }}>
                  <span className="badge blue">{key}</span>
                  {lf.start === key ? <span className="badge green">Start</span> : <button className="btn ghost small" onClick={() => updateLF((l) => ({ ...l, start: key }))}>Make start</button>}
                  <select style={{ marginLeft: 'auto', width: 'auto' }} value={t} onChange={(e) => setNodeType(key, e.target.value)} aria-label="Node type">
                    {Object.entries(NODE_TYPES).filter(([k, v]) => !v.commerce || isEcommerce || k === t).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
                  </select>
                  <button className="btn danger small" onClick={() => removeNode(key)} disabled={keys.length === 1}>Delete</button>
                </div>
                {mine.length > 0 && <div className="node-issues">{mine.map((e, i) => <div key={i}>❌ {e.msg}</div>)}</div>}
                {myWarn.length > 0 && <div className="node-issues warn">{myWarn.map((e, i) => <div key={i}>⚠️ {e.msg}</div>)}</div>}
                {!NO_TEXT.includes(t) && (
                  <label>{TEXT_LABEL[t] || 'Heading sent before this'}
                    <textarea rows={2} value={node.text} onChange={(e) => updateNode(key, { text: e.target.value })} placeholder={TEXT_HINT[t] || 'e.g. Here are our bestsellers:'} />
                    <div className={'counter' + ((node.text || '').length > WA.BODY_MAX ? ' over' : '')}>{(node.text || '').length}/{WA.BODY_MAX}</div>
                  </label>
                )}
                <Editor node={node} keys={keys.filter((k) => k !== key)} onChange={(patch) => updateNode(key, patch)} />
              </div>
            );
          })}
        </div>

        {showPreview && (
          <aside className="builder-aside">
            <WhatsAppPreview questions={questions} start={lf.start} businessName={bizName} resetKey={`${id}:${lang}`} />
          </aside>
        )}
      </div>

      {showTest && <SimulatorModal automation={{ id, name: name || doc.name }} endpoint={`/chatflows/${id}/simulate`} onClose={() => setShowTest(false)} />}

      {showLang && <AddLanguageModal existing={langs} current={lang} onAdd={addLanguage} onClose={() => setShowLang(false)} />}

      {showAuto && (
        <AutomationModal presetFlowId={id} onClose={() => setShowAuto(false)}
          onSaved={() => { setShowAuto(false); nav('/app/automations'); }} />
      )}
    </>
  );
}

function AddLanguageModal({ existing, current, onAdd, onClose }) {
  const [custom, setCustom] = useState('');
  const [copy, setCopy] = useState(true);
  const [err, setErr] = useState('');
  const options = Object.keys(LANGS).filter((l) => !existing.includes(l));
  const add = (l) => {
    l = l.trim().toLowerCase();
    if (!LANG_RE.test(l)) return setErr('Use lowercase letters, numbers or “-” (2–20 characters), e.g. urdu.');
    if (existing.includes(l)) return setErr('That language is already in this flow.');
    onAdd(l, copy ? current : null);
  };
  return (
    <Modal title="Add a language" onClose={onClose} width={440}>
      <p className="muted" style={{ marginBottom: 10 }}>With several languages the bot first asks the customer to pick one, then runs that language's flow. Up to {MAX_LANGS} languages.</p>
      <label className="check"><input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} /> Start from a copy of {langLabel(current)} (then translate the texts)</label>
      <div className="inline" style={{ margin: '10px 0' }}>
        {options.map((l) => <button key={l} type="button" className="btn small secondary" onClick={() => add(l)}>{langLabel(l)}</button>)}
      </div>
      <div className="inline">
        <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Other language, e.g. urdu" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(custom); } }} />
        <button type="button" className="btn small" onClick={() => add(custom)}>Add</button>
      </div>
      {err && <p className="error-text">{err}</p>}
    </Modal>
  );
}
