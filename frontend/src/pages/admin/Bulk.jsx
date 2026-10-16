import { useEffect, useState } from 'react';
import { api, qs } from '../../api/client';
import { Badge, fmtDate } from '../../lib/ui';

const STATUSES = ['new', 'contacted', 'quoted', 'confirmed', 'closed'];

export default function Bulk() {
  const [list, setList] = useState([]);
  const [status, setStatus] = useState('');
  const [err, setErr] = useState('');
  const load = () => api('/bulk' + qs({ status })).then(r => { setList(r.data); setErr(''); }).catch(e => setErr(e.message));
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, [status]);

  const patch = async (q, body) => { try { await api(`/bulk/${q._id}`, { method: 'PATCH', body }); load(); } catch (e) { setErr(e.message); } };

  return (
    <>
      <div className="row-between"><h1>Bulk / gifting enquiries</h1>
        <select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All</option>{STATUSES.map(s => <option key={s}>{s}</option>)}
        </select></div>
      <p className="muted">Collected from the WhatsApp “Bulk &amp; Gifting” menu (wedding, festival, corporate, catering). Call or WhatsApp the customer, send a quote, then update the status.</p>
      {err && <div className="error">{err}</div>}
      {list.map(q => (
        <div className="card" key={q._id}>
          <div className="row-between">
            <div><b>{q.enquiryId}</b> · <Badge value={q.status} /> <span className="muted">{q.type} · {fmtDate(q.createdAt)}</span></div>
            <a href={`https://wa.me/${q.phone}`} target="_blank" rel="noreferrer">💬 {q.name} +{q.phone}</a>
          </div>
          <p style={{ whiteSpace: 'pre-wrap' }}>{q.details}</p>
          <p className="muted">Needed by: <b>{q.neededBy}</b></p>
          <div className="inline">
            <select value={q.status} onChange={e => patch(q, { status: e.target.value })}>{STATUSES.map(s => <option key={s}>{s}</option>)}</select>
            <input defaultValue={q.note} placeholder="Internal note (quote, follow-up…)" onBlur={e => e.target.value !== q.note && patch(q, { note: e.target.value })} />
          </div>
        </div>
      ))}
      {!list.length && <p className="muted">No enquiries yet.</p>}
    </>
  );
}
