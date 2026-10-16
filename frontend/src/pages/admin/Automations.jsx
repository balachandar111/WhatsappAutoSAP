import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import AutomationModal from '../../components/AutomationModal';
import SimulatorModal from '../../components/SimulatorModal';
import Modal from '../../components/Modal';
import { Loader, PageHeader, Switch } from '../../components/common';
import { fmtDate } from '../../lib/ui';

export default function Automations() {
  const [list, setList] = useState(null);
  const [edit, setEdit] = useState(null);   // null | {} (new) | automation
  const [del, setDel] = useState(null);
  const [sim, setSim] = useState(null);
  const [err, setErr] = useState('');
  const [warns, setWarns] = useState([]);

  const load = () => api('/automations').then((r) => setList(r.data)).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const toggle = async (a, active) => {
    setErr(''); setWarns([]);
    try { const r = await api(`/automations/${a.id}/status`, { method: 'PATCH', body: { active } }); setWarns(r.warnings || []); load(); } catch (e) { setErr(e.message); }
  };
  const remove = async () => {
    try { await api(`/automations/${del.id}`, { method: 'DELETE' }); setDel(null); load(); } catch (e) { setErr(e.message); setDel(null); }
  };

  const hasDefault = (list || []).some((a) => a.active && a.isDefault);

  return (
    <>
      <PageHeader title="Automations"
        subtitle="Automations decide what your WhatsApp number does when a customer messages you. Attach a saved chat flow (or the built-in ordering bot) to a trigger."
        actions={<button className="btn" onClick={() => setEdit({})}>+ New automation</button>} />
      {err && <div className="error">{err}</div>}
      {warns.length > 0 && <div className="warn" style={{ marginTop: 0 }}>{warns.map((w, i) => <div key={i}>⚠ {w}</div>)}</div>}

      <div className="card sunken">
        <b>How incoming messages are routed</b>
        <p className="muted" style={{ marginTop: 4 }}>1 · A message that matches a <b>keyword</b> automation runs that automation (higher priority wins a clash). 2 · Anything else starts the <b>default</b> automation. 3 · Once a conversation is inside a flow, the customer's next taps and answers continue it. Changes you save to a Ready flow go live in its automations immediately.</p>
      </div>

      {list && list.length > 0 && !hasDefault && <div className="warn">No active default automation — customers who message you without a trigger keyword won't get a reply.</div>}

      {!list ? (err ? null : <Loader />) : list.length === 0 ? (
        <div className="card empty-state"><h3>No automations yet</h3><p>Create one to put a chat flow live on your WhatsApp number.</p></div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Automation</th><th>Runs</th><th>Trigger</th><th>Chats</th><th>Active</th><th>Updated</th><th /></tr></thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id} className={a.active ? '' : 'dim'}>
                  <td><b>{a.name}</b>{a.priority !== 0 && <div className="muted">priority {a.priority}</div>}</td>
                  <td>{a.type === 'commerce' ? '🛒 Ordering bot' : a.chatflow ? <>💬 <Link to={`/app/flows/${a.chatflow.id}`}>{a.chatflow.name || 'Chat flow'}</Link></> : '—'}</td>
                  <td>
                    {a.isDefault && <span className="badge blue keep-case">Default</span>}{' '}
                    {a.trigger.keywords.map((k) => <span key={k} className="chip">{k}</span>)}
                    {a.trigger.keywords.length > 0 && <div className="muted">{a.trigger.matchType}</div>}
                    {!a.isDefault && !a.trigger.keywords.length && <span className="muted">no trigger</span>}
                  </td>
                  <td>{a.stats?.conversations || 0}{a.stats?.lastTriggeredAt && <div className="muted">last {fmtDate(a.stats.lastTriggeredAt)}</div>}</td>
                  <td><Switch checked={a.active} onChange={(v) => toggle(a, v)} label={`Toggle ${a.name}`} /></td>
                  <td>{fmtDate(a.updatedAt)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {a.type === 'flow' && <><button className="btn small outline" onClick={() => setSim(a)}>Test</button>{' '}</>}
                    <button className="btn small secondary" onClick={() => setEdit(a)}>Edit</button>{' '}
                    <button className="btn small danger" onClick={() => setDel(a)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {edit && <AutomationModal automation={edit.id ? edit : null} onClose={() => setEdit(null)} onSaved={(r) => { setEdit(null); setWarns(r.warnings || []); load(); }} />}
      {sim && <SimulatorModal automation={sim} onClose={() => setSim(null)} />}
      {del && (
        <Modal title="Delete automation?" onClose={() => setDel(null)} width={420}>
          <p><b>{del.name}</b> will stop replying on WhatsApp and any running chats are ended. The chat flow itself is kept.</p>
          <div className="modal-actions"><button className="btn secondary" onClick={() => setDel(null)}>Cancel</button><button className="btn danger" onClick={remove}>Delete</button></div>
        </Modal>
      )}
    </>
  );
}
