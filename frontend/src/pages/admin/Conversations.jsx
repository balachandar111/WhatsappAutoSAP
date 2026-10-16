import { useCallback, useEffect, useState } from 'react';
import { api, qs } from '../../api/client';
import { Loader, PageHeader } from '../../components/common';
import { fmtDate } from '../../lib/ui';

const LIMIT = 50;

// Inbound WhatsApp message log (kept 30 days). Handy to see what customers actually type.
export default function Conversations() {
  const [phone, setPhone] = useState('');
  const [applied, setApplied] = useState('');
  const [page, setPage] = useState(1);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState('');

  const load = useCallback(() => api('/conversations' + qs({ phone: applied, page, limit: LIMIT })).then((r) => { setRes(r); setErr(''); }).catch((e) => setErr(e.message)), [applied, page]);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  const apply = (p) => { setPage(1); setApplied(p.replace(/\D/g, '')); setPhone(p.replace(/\D/g, '')); };
  const pages = res ? Math.max(Math.ceil(res.total / LIMIT), 1) : 1;

  return (
    <>
      <PageHeader title="Conversations" subtitle="Every message customers send to your number (kept for 30 days). Click a number to see just that customer." />
      {err && <div className="error">{err}</div>}
      <form className="card filters" onSubmit={(e) => { e.preventDefault(); apply(phone); }}>
        <input placeholder="Filter by phone, e.g. 919876543210" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <button className="btn secondary">Filter</button>
        {applied && <button type="button" className="btn ghost" onClick={() => apply('')}>Clear ({applied})</button>}
      </form>
      {!res ? (err ? null : <Loader />) : (
        <>
          <div className="card table-wrap">
            <table>
              <thead><tr><th>Time</th><th>Customer</th><th>Type</th><th>Message</th></tr></thead>
              <tbody>
                {res.data.map((m) => (
                  <tr key={m._id || m.wamid}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(m.createdAt)}</td>
                    <td>{m.profileName || '—'}<div><button className="link text" onClick={() => apply(m.from)}>+{m.from}</button></div></td>
                    <td><span className="badge gray">{m.type}</span></td>
                    <td style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.text || <span className="muted">—</span>}</td>
                  </tr>
                ))}
                {!res.data.length && <tr><td colSpan="4" className="muted center">No messages yet.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <button className="btn secondary small" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Newer</button>
            <span>Page {page} of {pages} · {res.total} message{res.total === 1 ? '' : 's'}</span>
            <button className="btn secondary small" disabled={page >= pages} onClick={() => setPage(page + 1)}>Older →</button>
          </div>
        </>
      )}
    </>
  );
}
