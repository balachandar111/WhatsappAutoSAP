import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import Modal from './Modal';
import { Switch } from './common';

const parseWords = (s) => [...new Set(s.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean))];
const MATCH = {
  exact: 'Exact — the whole message equals a keyword',
  contains: 'Contains — the message includes a keyword',
  startsWith: 'Starts with — the message begins with a keyword',
};

// Create / edit an automation: "when <trigger> happens on my WhatsApp number, run <chat flow | ordering bot>"
export default function AutomationModal({ automation, presetFlowId, onClose, onSaved }) {
  const { isEcommerce } = useAuth();
  const [flows, setFlows] = useState(null);
  const [others, setOthers] = useState([]);
  const [f, setF] = useState(() => ({
    name: automation?.name || '',
    description: automation?.description || '',
    type: automation?.type || 'flow',
    chatflow: automation?.chatflow?.id || presetFlowId || '',
    isDefault: automation ? automation.isDefault : true,
    keywords: (automation?.trigger?.keywords || []).join(', '),
    matchType: automation?.trigger?.matchType || 'exact',
    priority: automation?.priority ?? 0,
    restartKeywords: (automation?.restartKeywords || ['menu', 'restart', 'start over']).join(', '),
    endKeywords: (automation?.endKeywords || ['stop', 'end', 'exit']).join(', '),
    sessionTimeoutMins: automation?.sessionTimeoutMins ?? 1440,
    active: automation ? automation.active : true,
  }));
  const [adv, setAdv] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api('/chatflows'), api('/automations')])
      .then(([fl, au]) => { setFlows(fl.data.filter((x) => x.status === 'ready' || x.id === automation?.chatflow?.id)); setOthers(au.data.filter((a) => a.id !== automation?.id)); })
      .catch((e) => setErr(e.message));
  }, [automation]);

  useEffect(() => { // default the name to the chosen flow
    if (!automation && !f.name && f.type === 'flow' && f.chatflow && flows) {
      const fl = flows.find((x) => x.id === f.chatflow);
      if (fl) setF((p) => ({ ...p, name: fl.name }));
    }
  }, [flows, f.chatflow]); // eslint-disable-line

  const kws = parseWords(f.keywords);
  const hasCommerce = others.some((a) => a.type === 'commerce');
  const replaces = f.active && f.isDefault && others.find((a) => a.active && a.isDefault);
  const canCommerce = isEcommerce && (!hasCommerce || automation?.type === 'commerce');

  const submit = async (e) => {
    e.preventDefault(); setErr('');
    if (f.type === 'flow' && !f.chatflow) return setErr('Pick the chat flow this automation should run.');
    if (!f.isDefault && !kws.length) return setErr('Add at least one trigger keyword, or make this the default automation.');
    setBusy(true);
    try {
      const body = {
        name: f.name.trim(), description: f.description, active: f.active, isDefault: f.isDefault,
        trigger: { keywords: kws, matchType: f.matchType },
        restartKeywords: parseWords(f.restartKeywords), endKeywords: parseWords(f.endKeywords),
        sessionTimeoutMins: Number(f.sessionTimeoutMins), priority: Number(f.priority),
      };
      if (!automation) body.type = f.type;
      if (f.type === 'flow') body.chatflow = f.chatflow;
      const r = automation ? await api(`/automations/${automation.id}`, { method: 'PUT', body }) : await api('/automations', { method: 'POST', body });
      onSaved(r);
    } catch (er) { setErr(er.message); }
    setBusy(false);
  };

  const Radio = ({ name, value, title, desc, disabled }) => (
    <label className="sub-card check" style={{ alignItems: 'flex-start', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1, marginBottom: 8, borderColor: f[name] === value ? 'var(--primary)' : undefined, background: f[name] === value ? 'var(--primary-soft)' : undefined }}>
      <input type="radio" disabled={disabled} checked={f[name] === value} onChange={() => setF({ ...f, [name]: value })} style={{ marginTop: 4 }} />
      <span><b>{title}</b><br /><span className="muted">{desc}</span></span>
    </label>
  );

  return (
    <Modal title={automation ? 'Edit automation' : 'New automation'} onClose={onClose} width={580}>
      <form onSubmit={submit}>
        <label>Automation name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={80} autoFocus placeholder="e.g. Festival offers" /></label>

        <h4 style={{ marginTop: 4 }}>What should it run?</h4>
        {automation ? (
          <p className="muted">{f.type === 'commerce' ? '🛒 Ordering bot' : '💬 Chat flow'} <span className="helper-text">(the type cannot be changed after creating)</span></p>
        ) : (
          <>
            <Radio name="type" value="flow" title="💬 Chat flow" desc="A conversation you built in Chat flows (menus, product cards, steps, forms)." />
            <Radio name="type" value="commerce" disabled={!canCommerce} title="🛒 Ordering bot (built-in)"
              desc={!isEcommerce ? 'Needs Ecommerce operations — ask the Super Admin to enable them.' : hasCommerce ? 'You already have an ordering automation — edit that one instead.' : 'Categories → products → cart → delivery/pickup → nearest outlet → Razorpay payment → order tracking.'} />
          </>
        )}
        {f.type === 'flow' && (
          <label>Chat flow
            <select value={f.chatflow} onChange={(e) => setF({ ...f, chatflow: e.target.value })} required disabled={!flows}>
              <option value="">{flows ? 'Select a ready flow…' : 'Loading…'}</option>
              {(flows || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            {flows && flows.length === 0 && <span className="helper-text">No ready flows yet — build one in Chat flows and Save with no problems.</span>}
          </label>
        )}

        <h4>When should it start?</h4>
        <label className="sub-card check" style={{ alignItems: 'flex-start', marginBottom: 8 }}>
          <input type="checkbox" checked={f.isDefault} onChange={(e) => setF({ ...f, isDefault: e.target.checked })} style={{ marginTop: 4 }} />
          <span><b>Default automation</b><br /><span className="muted">Answers any first message that no keyword automation claims. Only one default per account.</span></span>
        </label>
        <label>Trigger keywords (comma separated{f.isDefault ? ', optional' : ''})
          <input value={f.keywords} onChange={(e) => setF({ ...f, keywords: e.target.value })} placeholder="offers, festival, diwali" />
          {kws.length > 0 && <span>{kws.map((k) => <span key={k} className="chip">{k}</span>)}</span>}
        </label>
        {kws.length > 0 && (
          <label>Keyword match
            <select value={f.matchType} onChange={(e) => setF({ ...f, matchType: e.target.value })}>
              {Object.entries(MATCH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        )}
        {replaces && <div className="warn">“{replaces.name}” is currently the default automation. Saving this one as the default will take that role over.</div>}

        <button type="button" className="btn ghost small" onClick={() => setAdv(!adv)}>{adv ? '▾' : '▸'} Advanced</button>
        {adv && (
          <div className="sub-card" style={{ marginTop: 8 }}>
            <label>Description<input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={300} /></label>
            <div className="grid2">
              <label>Priority (−100…100; higher wins when keywords clash)<input type="number" min={-100} max={100} step={1} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} /></label>
              <label>Idle timeout, minutes (5–10080)<input type="number" min={5} max={10080} step={1} value={f.sessionTimeoutMins} onChange={(e) => setF({ ...f, sessionTimeoutMins: e.target.value })} /></label>
            </div>
            <label>Restart keywords<input value={f.restartKeywords} onChange={(e) => setF({ ...f, restartKeywords: e.target.value })} /></label>
            <label>End keywords<input value={f.endKeywords} onChange={(e) => setF({ ...f, endKeywords: e.target.value })} /></label>
          </div>
        )}

        <div className="toggle-row">
          <div><b style={{ color: 'var(--ink)' }}>Active</b><div className="muted">Inactive automations never reply to customers.</div></div>
          <Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Active" />
        </div>

        {err && <p className="error-text">{err}</p>}
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy}>{busy ? 'Saving…' : automation ? 'Save changes' : 'Create automation'}</button>
        </div>
      </form>
    </Modal>
  );
}
