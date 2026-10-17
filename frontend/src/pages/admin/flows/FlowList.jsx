import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import { api, download, qs } from '../../../api/client';
import Modal from '../../../components/Modal';
import { Loader, PageHeader } from '../../../components/common';
import { Badge, fmtDate } from '../../../lib/ui';
import { LANGS, LANG_RE, MAX_LANGS, blankFlow, langLabel, starterFlow } from './flowUtils';

export const nodeTotal = (nodeCount) => Object.values(nodeCount || {}).reduce((a, b) => a + b, 0);

export default function FlowList() {
  const nav = useNavigate();
  const { isEcommerce } = useAuth();
  const [flows, setFlows] = useState(null);
  const [filters, setFilters] = useState({ q: '', status: '' });
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', languages: ['english'], template: 'starter', custom: '' });
  const [del, setDel] = useState(null);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api('/chatflows' + qs(filters)).then((r) => setFlows(r.data)).catch((e) => setErr(e.message));
  useEffect(() => { const t = setTimeout(load, filters.q ? 250 : 0); return () => clearTimeout(t); }, [filters]); // eslint-disable-line

  const toggleLang = (l) => setForm((f) => ({ ...f, languages: f.languages.includes(l) ? f.languages.filter((x) => x !== l) : [...f.languages, l] }));
  const addCustom = () => {
    const l = form.custom.trim().toLowerCase();
    if (!LANG_RE.test(l)) return setErr('Language names are lowercase letters, e.g. “urdu” (2–20 characters).');
    setErr('');
    setForm((f) => ({ ...f, languages: f.languages.includes(l) ? f.languages : [...f.languages, l], custom: '' }));
  };

  const create = async (e) => {
    e.preventDefault(); setErr('');
    if (!form.languages.length) return setErr('Pick at least one language');
    if (form.languages.length > MAX_LANGS) return setErr(`A chat flow supports up to ${MAX_LANGS} languages`);
    setBusy(true);
    try {
      // the shop template is built by the server (it knows the exact ordering flow); the others are built here
      const flow = form.template === 'shop' ? undefined : Object.fromEntries(form.languages.map((l) => [l, form.template === 'starter' ? starterFlow(l) : blankFlow()]));
      const r = await api('/chatflows', { method: 'POST', body: { name: form.name, description: form.description, languages: form.languages, ...(flow ? { flow } : { template: 'shop' }) } });
      nav(`/app/flows/${r.data.id}`);
    } catch (er) { setErr(er.message); }
    setBusy(false);
  };

  const duplicate = async (f) => {
    try { const r = await api(`/chatflows/${f.id}/duplicate`, { method: 'POST' }); nav(`/app/flows/${r.data.id}`); } catch (er) { setErr(er.message); }
  };
  const remove = async () => {
    try { await api(`/chatflows/${del.id}`, { method: 'DELETE' }); setDel(null); setInfo('Chat flow deleted.'); load(); }
    catch (er) { setErr(er.message); setDel(null); }
  };
  const template = () => download('/chatflows/excel-template', 'chatflow-template.xlsx').catch((er) => setErr(er.message));

  return (
    <>
      <PageHeader title="Chat flows"
        subtitle="Design the conversation your WhatsApp number has with customers. Save a flow, then attach it to an automation to take it live."
        actions={<>
          <button className="btn secondary" onClick={template}>⬇ Excel template</button>
          <button className="btn" onClick={() => { setShow(true); setErr(''); }}>+ New flow</button>
        </>} />
      {err && !show && <div className="error">{err}</div>}
      {info && !err && <div className="success">{info}</div>}

      <div className="card filters">
        <input placeholder="Search flows by name" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">All statuses</option><option value="ready">Ready</option><option value="draft">Draft</option>
        </select>
      </div>

      {!flows ? (err ? null : <Loader />) : flows.length === 0 ? (
        <div className="card empty-state"><h3>No chat flows yet</h3><p>Create your first flow — we'll start you off with a simple menu, product cards and an enquiry form. You can also import one from Excel.</p></div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Flow</th><th>Languages</th><th>Nodes</th><th>Status</th><th>Automations</th><th>Updated</th><th /></tr></thead>
            <tbody>
              {flows.map((f) => (
                <tr key={f.id} className="click" onClick={() => nav(`/app/flows/${f.id}`)}>
                  <td><b>{f.name}</b>{f.description && <div className="muted">{f.description}</div>}</td>
                  <td>{f.languages.map(langLabel).join(', ')}</td>
                  <td>{nodeTotal(f.nodeCount)}</td>
                  <td>
                    <Badge value={f.status} />
                    {f.validation?.errors > 0 && <div className="muted" style={{ color: 'var(--danger)' }}>{f.validation.errors} problem{f.validation.errors === 1 ? '' : 's'}</div>}
                    {f.status === 'ready' && f.validation?.valid === false && <div className="muted">older version live</div>}
                  </td>
                  <td>{f.automations ? <span className="badge green">{f.automations} attached</span> : <span className="muted">—</span>}</td>
                  <td>{fmtDate(f.updatedAt)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                    <Link className="btn small secondary" to={`/app/flows/${f.id}`}>Edit</Link>{' '}
                    <button className="btn small secondary" onClick={() => duplicate(f)}>Duplicate</button>{' '}
                    <button className="btn small danger" onClick={() => setDel(f)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {show && (
        <Modal title="New chat flow" onClose={() => setShow(false)} width={500}>
          <form onSubmit={create}>
            <label>Flow name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Festival offers menu" required maxLength={80} autoFocus /></label>
            <label>Description (optional)<input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={300} /></label>
            <label style={{ marginBottom: 4 }}>Languages <span className="muted">(up to {MAX_LANGS})</span></label>
            <div className="inline" style={{ marginBottom: 8 }}>
              {[...new Set([...Object.keys(LANGS).slice(0, 4), ...form.languages])].map((k) => (
                <label key={k} className="check" style={{ margin: 0 }}><input type="checkbox" checked={form.languages.includes(k)} onChange={() => toggleLang(k)} />{langLabel(k)}</label>
              ))}
            </div>
            <div className="inline" style={{ marginBottom: 12 }}>
              <input value={form.custom} onChange={(e) => setForm({ ...form, custom: e.target.value })} placeholder="Another language, e.g. urdu" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }} />
              <button type="button" className="btn small secondary" onClick={addCustom}>Add</button>
            </div>
            {form.languages.length > 1 && <p className="helper-text" style={{ marginBottom: 12 }}>With more than one language the bot first asks the customer to pick a language, then runs that language's flow.</p>}
            <label>Start from
              <select value={form.template} onChange={(e) => setForm({ ...form, template: e.target.value })}>
                {isEcommerce && <option value="shop">🛍️ Shop ordering — live products, cart, checkout, payment, bulk, track, outlets</option>}
                <option value="starter">Starter — menu, product cards, enquiry form</option>
                <option value="blank">Blank — one empty message</option>
              </select>
            </label>
            {form.template === 'shop' && <p className="helper-text" style={{ marginBottom: 12 }}>Builds the full sweet-shop ordering chat from your <b>Product, Category and Outlet</b> pages: menu → category → product → size → quantity → cart → checkout → Razorpay, plus Bulk &amp; Gifting, Track my order and Our outlets. Edit any step afterwards.</p>}
            {err && <p className="error-text">{err}</p>}
            <div className="modal-actions">
              <button type="button" className="btn secondary" onClick={() => setShow(false)}>Cancel</button>
              <button className="btn" disabled={busy}>{busy ? 'Creating…' : 'Create & open builder'}</button>
            </div>
          </form>
        </Modal>
      )}

      {del && (
        <Modal title="Delete flow?" onClose={() => setDel(null)} width={420}>
          <p><b>{del.name}</b> will be permanently deleted.{del.automations ? ' It is used by an automation — the server will refuse until you detach or delete that automation.' : ''}</p>
          <div className="modal-actions">
            <button className="btn secondary" onClick={() => setDel(null)}>Cancel</button>
            <button className="btn danger" onClick={remove}>Delete</button>
          </div>
        </Modal>
      )}
    </>
  );
}
