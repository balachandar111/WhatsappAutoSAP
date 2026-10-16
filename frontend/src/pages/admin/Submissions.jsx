import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, apiBlob, download, qs } from '../../api/client';
import Modal from '../../components/Modal';
import { Loader, PageHeader } from '../../components/common';
import { Badge, fmtDate } from '../../lib/ui';

const STATUSES = ['new', 'reviewed', 'closed'];

export default function Submissions() {
  const [params] = useSearchParams();
  const [f, setF] = useState({ q: '', status: params.get('status') || '', chatflow: '', from: '', to: '' });
  const [flows, setFlows] = useState([]);
  const [page, setPage] = useState(1);
  const [res, setRes] = useState(null);
  const [sel, setSel] = useState(null);
  const [err, setErr] = useState('');

  const load = useCallback(() => api('/submissions' + qs({ ...f, page, limit: 20 })).then((r) => { setRes(r); setErr(''); }).catch((e) => setErr(e.message)), [f, page]);
  useEffect(() => { const t = setTimeout(load, f.q ? 250 : 0); const i = setInterval(load, 30000); return () => { clearTimeout(t); clearInterval(i); }; }, [load, f.q]);
  useEffect(() => { api('/chatflows').then((r) => setFlows(r.data)).catch(() => {}); }, []);

  const setFilter = (k, v) => { setPage(1); setF((p) => ({ ...p, [k]: v })); };
  const flowName = (id) => flows.find((x) => x.id === id)?.name;
  const exportCsv = () => download('/submissions/export.csv' + qs({ chatflow: f.chatflow }), 'submissions.csv').catch((e) => setErr(e.message));

  return (
    <>
      <PageHeader title="Form submissions" subtitle="Answers customers gave to the forms in your chat flows."
        actions={<button className="btn secondary" onClick={exportCsv} title={f.chatflow ? 'Exports the selected flow' : 'Exports all submissions (columns = form fields)'}>⬇ Export CSV</button>} />
      {err && <div className="error">{err}</div>}

      <div className="card filters">
        <input placeholder="Search name / phone / ID / form" value={f.q} onChange={(e) => setFilter('q', e.target.value)} />
        <select value={f.status} onChange={(e) => setFilter('status', e.target.value)}>
          <option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={f.chatflow} onChange={(e) => setFilter('chatflow', e.target.value)}>
          <option value="">All chat flows</option>{flows.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <input type="date" value={f.from} onChange={(e) => setFilter('from', e.target.value)} aria-label="From date" />
        <input type="date" value={f.to} onChange={(e) => setFilter('to', e.target.value)} aria-label="To date" />
      </div>

      {!res ? (err ? null : <Loader />) : (
        <>
          <div className="card table-wrap">
            <table>
              <thead><tr><th>ID</th><th>Received</th><th>Customer</th><th>Form</th><th>Answers</th><th>Status</th><th /></tr></thead>
              <tbody>
                {res.data.map((s) => (
                  <tr key={s._id} className="click" onClick={() => setSel(s)}>
                    <td className="mono">{s.submissionId}</td>
                    <td>{fmtDate(s.createdAt)}</td>
                    <td>{s.profileName || '—'}<div className="muted">+{s.phone}</div></td>
                    <td>{s.formTitle ? s.formTitle.slice(0, 40) : s.nodeKey}<div className="muted">{flowName(s.chatflow) || ''}</div></td>
                    <td className="muted" style={{ maxWidth: 280 }}>{s.fields.slice(0, 3).map((fl) => `${fl.label}: ${s.answers?.[fl.key] ?? '—'}`).join(' · ').slice(0, 120)}</td>
                    <td><Badge value={s.status} /></td>
                    <td style={{ textAlign: 'right' }}><button className="btn small secondary">Open</button></td>
                  </tr>
                ))}
                {!res.data.length && <tr><td colSpan="7" className="muted center">No submissions found.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <button className="btn secondary small" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</button>
            <span>Page {res.page} of {res.pages} · {res.total} total</span>
            <button className="btn secondary small" disabled={page >= res.pages} onClick={() => setPage(page + 1)}>Next →</button>
          </div>
        </>
      )}

      {sel && <SubmissionModal sub={sel} flowName={flowName(sel.chatflow)} onClose={() => setSel(null)} onChanged={(s) => { setSel(s); load(); }} onDeleted={() => { setSel(null); load(); }} />}
    </>
  );
}

function FileThumb({ subId, file }) {
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState('');
  const isImage = (file.mime || '').startsWith('image/');
  useEffect(() => {
    let u;
    apiBlob(`/submissions/${subId}/media/${encodeURIComponent(file.mediaId)}`).then(({ blob }) => { u = URL.createObjectURL(blob); setUrl(u); }).catch((e) => setErr(e.message));
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [subId, file.mediaId]);
  return (
    <div className="sub-card" style={{ width: 170 }}>
      {err ? <div className="error-text" style={{ fontSize: 12 }}>{err}</div> : !url ? <div className="muted">Loading…</div> : isImage
        ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={file.filename} style={{ width: '100%', borderRadius: 6 }} /></a>
        : <a href={url} download={file.filename || 'file'}>⬇ {file.filename || 'Download'}</a>}
      <div className="muted" style={{ fontSize: 11.5 }}>{file.key}{file.caption ? ` · ${file.caption}` : ''}</div>
    </div>
  );
}

function SubmissionModal({ sub, flowName, onClose, onChanged, onDeleted }) {
  const [note, setNote] = useState(sub.note || '');
  const [err, setErr] = useState('');
  const patch = async (body) => { try { const r = await api(`/submissions/${sub._id}`, { method: 'PATCH', body }); onChanged(r.data); setErr(''); } catch (e) { setErr(e.message); } };
  const del = async () => { if (!confirm('Delete this submission permanently?')) return; try { await api(`/submissions/${sub._id}`, { method: 'DELETE' }); onDeleted(); } catch (e) { setErr(e.message); } };
  const fileKeys = new Set((sub.files || []).map((x) => x.key));

  return (
    <Modal title={`Submission ${sub.submissionId}`} onClose={onClose} width={620}>
      <div className="row-between">
        <span className="muted">{fmtDate(sub.createdAt)}{flowName ? ` · ${flowName}` : ''}{sub.lang ? ` · ${sub.lang}` : ''}</span>
        <Badge value={sub.status} />
      </div>
      <p style={{ margin: '8px 0' }}><b>{sub.profileName || 'Customer'}</b> · <a href={`https://wa.me/${sub.phone}`} target="_blank" rel="noreferrer">💬 +{sub.phone}</a></p>
      {sub.formTitle && <p className="muted" style={{ marginBottom: 8 }}>{sub.formTitle}</p>}
      <table><tbody>
        {sub.fields.map((fl) => (
          <tr key={fl.key}><td className="muted" style={{ width: '38%' }}>{fl.label}</td><td style={{ whiteSpace: 'pre-wrap' }}>{fileKeys.has(fl.key) && !sub.answers?.[fl.key] ? '📎 file attached' : String(sub.answers?.[fl.key] ?? '—')}</td></tr>
        ))}
      </tbody></table>
      {sub.files?.length > 0 && (
        <>
          <h4>Files</h4>
          <div className="inline" style={{ alignItems: 'flex-start' }}>{sub.files.map((x) => <FileThumb key={x.mediaId} subId={sub._id} file={x} />)}</div>
          <p className="helper-text">Files are fetched from WhatsApp on demand and expire after about 30 days — download anything you need to keep.</p>
        </>
      )}
      <h4>Follow-up</h4>
      <div className="status-buttons">
        {STATUSES.map((s) => <button key={s} className={`btn small ${sub.status === s ? '' : 'secondary'}`} disabled={sub.status === s} onClick={() => patch({ status: s })}>{s}</button>)}
      </div>
      <label style={{ marginTop: 10 }}>Internal note<textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="Call back tomorrow, quoted ₹…" /></label>
      {err && <p className="error-text">{err}</p>}
      <div className="modal-actions">
        <button className="btn danger small" style={{ marginRight: 'auto' }} onClick={del}>Delete</button>
        <button className="btn secondary" onClick={onClose}>Close</button>
        <button className="btn" disabled={note === (sub.note || '')} onClick={() => patch({ note })}>Save note</button>
      </div>
    </Modal>
  );
}
