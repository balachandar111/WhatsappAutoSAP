import { useCallback, useEffect, useState } from 'react';
import { api, qs } from '../../api/client';
import Modal from '../../components/Modal';
import { Copy, Loader, PageHeader } from '../../components/common';
import { Badge, fmtDate, fmtDay } from '../../lib/ui';

const EMPTY = { name: '', company: '', username: '', email: '', phone: '', password: '', adminType: 'NORMAL' };
const genPassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(12))).map((b) => chars[b % chars.length]).join('');
};

const TYPE_HELP = {
  NORMAL: 'Setup, chat flows, automations, form submissions and conversations.',
  ECOMMERCE: 'Everything in Normal, plus categories, products, outlets, orders, bulk enquiries and the WhatsApp ordering bot.',
};

function TypePicker({ value, onChange }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Admin type</div>
      {['NORMAL', 'ECOMMERCE'].map((t) => (
        <label key={t} className="sub-card check" style={{ alignItems: 'flex-start', cursor: 'pointer', marginBottom: 8, borderColor: value === t ? 'var(--primary)' : undefined, background: value === t ? 'var(--primary-soft)' : undefined }}>
          <input type="radio" checked={value === t} onChange={() => onChange(t)} style={{ marginTop: 4 }} />
          <span><b>{t === 'NORMAL' ? 'Normal' : 'Ecommerce'}</b><br /><span className="muted">{TYPE_HELP[t]}</span></span>
        </label>
      ))}
    </div>
  );
}

export default function Admins() {
  const [res, setRes] = useState(null);       // { data, total, page, pages }
  const [filters, setFilters] = useState({ q: '', status: '', adminType: '' });
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [created, setCreated] = useState(null);
  const [modal, setModal] = useState(null);   // { kind: 'status'|'type'|'password'|'delete'|'edit'|'view', admin }
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => api('/superadmin/admins' + qs({ ...filters, page, limit: 20 })).then(setRes).catch((e) => setError(e.message)), [filters, page]);
  useEffect(() => { const t = setTimeout(load, filters.q ? 250 : 0); return () => clearTimeout(t); }, [load, filters.q]);
  const setFilter = (k, v) => { setPage(1); setFilters((f) => ({ ...f, [k]: v })); };

  const f = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const create = async (e) => {
    e.preventDefault(); setError(''); setSaving(true);
    try {
      await api('/superadmin/admins', { method: 'POST', body: form });
      setCreated({ username: form.username, password: form.password, name: form.name, adminType: form.adminType });
      setShowCreate(false); setForm(EMPTY); load();
    } catch (er) { setError(er.message); }
    setSaving(false);
  };

  const admins = res?.data;

  return (
    <>
      <PageHeader title="Admins & activation"
        subtitle="Create admin accounts, choose what they can use, and switch them on or off. A deactivated admin is cut off immediately and their WhatsApp automations stop replying."
        actions={<button className="btn" onClick={() => { setShowCreate(true); setError(''); }}>+ Create admin</button>} />
      {error && !showCreate && <div className="error">{error}</div>}

      {created && (
        <div className="success">
          <b>Admin “{created.name}” created ({created.adminType === 'ECOMMERCE' ? 'Ecommerce' : 'Normal'}).</b> Share these login details securely — the password is not shown again.
          <div className="inline" style={{ marginTop: 8 }}>
            <span>Username: <code>{created.username}</code></span>
            <span>Password: <code>{created.password}</code></span>
            <Copy text={`Username: ${created.username}\nPassword: ${created.password}`} label="Copy both" />
            <button className="btn small ghost" onClick={() => setCreated(null)}>Dismiss</button>
          </div>
        </div>
      )}

      <div className="card filters">
        <input placeholder="Search by name, company, username or email" value={filters.q} onChange={(e) => setFilter('q', e.target.value)} />
        <select value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
          <option value="">All statuses</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option>
        </select>
        <select value={filters.adminType} onChange={(e) => setFilter('adminType', e.target.value)}>
          <option value="">All types</option><option value="NORMAL">Normal</option><option value="ECOMMERCE">Ecommerce</option>
        </select>
      </div>

      {!admins ? (error ? null : <Loader />) : admins.length === 0 ? (
        <div className="card empty-state"><h3>No admins found</h3><p>{res.total === 0 && !filters.q && !filters.status && !filters.adminType ? 'Create your first admin to get started.' : 'Try different filters.'}</p></div>
      ) : (
        <>
          <div className="card table-wrap">
            <table>
              <thead><tr><th>Admin</th><th>Type</th><th>Contact</th><th>WhatsApp</th><th>Last login</th><th>Status</th><th /></tr></thead>
              <tbody>
                {admins.map((a) => (
                  <tr key={a.id} className={a.status === 'ACTIVE' ? '' : 'dim'}>
                    <td><b>{a.name}</b><div className="muted">{a.company || '—'} · <span className="mono">{a.username}</span></div></td>
                    <td><Badge value={a.adminType} /></td>
                    <td>{a.email || '—'}<div className="muted">{a.phone}</div></td>
                    <td>{a.whatsappTested ? <span className="badge green">Tested</span> : <span className="badge gray">Not tested</span>}</td>
                    <td>{a.lastLoginAt ? fmtDate(a.lastLoginAt) : <span className="muted">never</span>}<div className="muted">added {fmtDay(a.createdAt)}</div></td>
                    <td><Badge value={a.status} /></td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn small secondary" onClick={() => setModal({ kind: 'view', admin: a })}>Details</button>{' '}
                      <button className={`btn small ${a.status === 'ACTIVE' ? 'danger' : ''}`} onClick={() => setModal({ kind: 'status', admin: a })}>
                        {a.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <button className="btn secondary small" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</button>
            <span>Page {res.page} of {res.pages} · {res.total} admin{res.total === 1 ? '' : 's'}</span>
            <button className="btn secondary small" disabled={page >= res.pages} onClick={() => setPage(page + 1)}>Next →</button>
          </div>
        </>
      )}

      {showCreate && (
        <Modal title="Create admin" onClose={() => setShowCreate(false)} width={560}>
          <form onSubmit={create}>
            <TypePicker value={form.adminType} onChange={(t) => setForm({ ...form, adminType: t })} />
            <div className="grid2">
              <label>Full name<input value={form.name} onChange={f('name')} required autoFocus /></label>
              <label>Company<input value={form.company} onChange={f('company')} /></label>
              <label>Username (3–30: a-z 0-9 . _ -)<input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase().replace(/\s/g, '') })} required minLength={3} maxLength={30} pattern="[a-z0-9._\-]{3,30}" /></label>
              <label>Password
                <div className="inline">
                  <input value={form.password} onChange={f('password')} required minLength={8} maxLength={72} placeholder="min 8 characters" />
                  <button type="button" className="btn small secondary" onClick={() => setForm({ ...form, password: genPassword() })}>Generate</button>
                </div>
              </label>
              <label>Email<input type="email" value={form.email} onChange={f('email')} /></label>
              <label>Phone<input type="tel" value={form.phone} onChange={f('phone')} /></label>
            </div>
            <p className="muted">Chat flows and automations unlock for the admin once they save their WhatsApp credentials and the connection test passes. You can change the type later.</p>
            {error && <p className="error-text">{error}</p>}
            <div className="modal-actions">
              <button type="button" className="btn secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn" disabled={saving}>{saving ? 'Creating…' : 'Create admin'}</button>
            </div>
          </form>
        </Modal>
      )}

      {modal?.kind === 'view' && <AdminDetails id={modal.admin.id} onClose={() => setModal(null)} onChanged={load} onAction={(kind, admin) => setModal({ kind, admin })} />}
      {modal?.kind === 'status' && <StatusModal admin={modal.admin} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />}
      {modal?.kind === 'edit' && <EditModal admin={modal.admin} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />}
      {modal?.kind === 'type' && <TypeModal admin={modal.admin} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />}
      {modal?.kind === 'password' && <PasswordModal admin={modal.admin} onClose={() => setModal(null)} />}
      {modal?.kind === 'delete' && <DeleteModal admin={modal.admin} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />}
    </>
  );
}

function AdminDetails({ id, onClose, onAction }) {
  const [a, setA] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api(`/superadmin/admins/${id}`).then((r) => setA(r.data)).catch((e) => setErr(e.message)); }, [id]);
  return (
    <Modal title="Admin details" onClose={onClose} width={600}>
      {err && <div className="error">{err}</div>}
      {!a ? (!err && <Loader />) : (
        <>
          <div className="row-between">
            <div><h3 style={{ margin: 0 }}>{a.name}</h3><div className="muted">{a.company || '—'} · <span className="mono">{a.username}</span></div></div>
            <span className="inline"><Badge value={a.adminType} /><Badge value={a.status} /></span>
          </div>
          <p style={{ marginTop: 8 }}>{a.email || 'No email'} · {a.phone || 'No phone'}</p>
          <h4>WhatsApp setup</h4>
          <p>
            {a.setup.whatsappVerified ? <span className="badge green">Connected</span> : a.setup.whatsappConfigured ? <span className="badge orange">Saved · not tested</span> : <span className="badge gray">Not configured</span>}
            {a.setup.phoneNumber && <> &nbsp;<b>{a.setup.phoneNumber}</b></>}
            {a.setup.whatsappVerifiedAt && <span className="muted"> · tested {fmtDate(a.setup.whatsappVerifiedAt)}</span>}
          </p>
          <h4>Usage</h4>
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))' }}>
            {Object.entries(a.usage).map(([k, v]) => (
              <div className="stat-card" key={k}><div className="stat-label">{k}</div><div className="stat-value" style={{ fontSize: 22 }}>{v}</div></div>
            ))}
          </div>
          <p className="muted" style={{ marginTop: 10 }}>Last login: {a.lastLoginAt ? fmtDate(a.lastLoginAt) : 'never'} · Created {fmtDay(a.createdAt)}{a.statusChangedAt ? ` · status changed ${fmtDate(a.statusChangedAt)}` : ''}</p>
          <div className="modal-actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
            <button className="btn small secondary" onClick={() => onAction('edit', a)}>Edit details</button>
            <button className="btn small secondary" onClick={() => onAction('type', a)}>Change type</button>
            <button className="btn small secondary" onClick={() => onAction('password', a)}>Reset password</button>
            <button className="btn small danger" onClick={() => onAction('delete', a)}>Delete admin</button>
          </div>
        </>
      )}
    </Modal>
  );
}

function StatusModal({ admin, onClose, onDone }) {
  const [err, setErr] = useState('');
  const next = admin.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
  const go = async () => {
    try { await api(`/superadmin/admins/${admin.id}/status`, { method: 'PATCH', body: { status: next } }); onDone(); } catch (e) { setErr(e.message); }
  };
  return (
    <Modal title={next === 'INACTIVE' ? 'Deactivate admin?' : 'Activate admin?'} onClose={onClose} width={440}>
      <p>{next === 'INACTIVE'
        ? <><b>{admin.name}</b> is cut off immediately: API calls are refused and their WhatsApp number stops replying. Their data is kept.</>
        : <><b>{admin.name}</b> can log in again and their automations resume.</>}</p>
      {err && <p className="error-text">{err}</p>}
      <div className="modal-actions">
        <button className="btn secondary" onClick={onClose}>Cancel</button>
        <button className={`btn ${next === 'INACTIVE' ? 'danger' : ''}`} onClick={go}>{next === 'INACTIVE' ? 'Deactivate' : 'Activate'}</button>
      </div>
    </Modal>
  );
}

function EditModal({ admin, onClose, onDone }) {
  const [v, setV] = useState({ name: admin.name || '', company: admin.company || '', email: admin.email || '', phone: admin.phone || '' });
  const [err, setErr] = useState('');
  const go = async (e) => {
    e.preventDefault();
    try { await api(`/superadmin/admins/${admin.id}`, { method: 'PUT', body: v }); onDone(); } catch (er) { setErr(er.message); }
  };
  const f = (k) => (e) => setV({ ...v, [k]: e.target.value });
  return (
    <Modal title={`Edit ${admin.username}`} onClose={onClose} width={480}>
      <form onSubmit={go}>
        <div className="grid2">
          <label>Full name<input value={v.name} onChange={f('name')} required /></label>
          <label>Company<input value={v.company} onChange={f('company')} /></label>
          <label>Email<input type="email" value={v.email} onChange={f('email')} /></label>
          <label>Phone<input value={v.phone} onChange={f('phone')} /></label>
        </div>
        {err && <p className="error-text">{err}</p>}
        <div className="modal-actions"><button type="button" className="btn secondary" onClick={onClose}>Cancel</button><button className="btn">Save</button></div>
      </form>
    </Modal>
  );
}

function TypeModal({ admin, onClose, onDone }) {
  const [t, setT] = useState(admin.adminType);
  const [err, setErr] = useState('');
  const go = async () => {
    try { await api(`/superadmin/admins/${admin.id}/type`, { method: 'PATCH', body: { adminType: t } }); onDone(); } catch (e) { setErr(e.message); }
  };
  return (
    <Modal title={`Admin type · ${admin.username}`} onClose={onClose} width={520}>
      <TypePicker value={t} onChange={setT} />
      {admin.adminType === 'ECOMMERCE' && t === 'NORMAL' && <div className="warn" style={{ marginTop: 0 }}>Switching to Normal locks products, orders, outlets and bulk enquiries, and switches the ordering-bot automation off. Their data is kept and returns if you switch back.</div>}
      {err && <p className="error-text">{err}</p>}
      <div className="modal-actions">
        <button className="btn secondary" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={go} disabled={t === admin.adminType}>Save type</button>
      </div>
    </Modal>
  );
}

function PasswordModal({ admin, onClose }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const go = async (e) => {
    e.preventDefault();
    try { await api(`/superadmin/admins/${admin.id}/password`, { method: 'PUT', body: { password: pw } }); setDone(true); } catch (er) { setErr(er.message); }
  };
  return (
    <Modal title={`Reset password · ${admin.username}`} onClose={onClose} width={460}>
      {done ? (
        <>
          <div className="success">Password reset. {admin.name} has been signed out everywhere. New password: <code>{pw}</code> <Copy text={pw} /></div>
          <div className="modal-actions"><button className="btn" onClick={onClose}>Done</button></div>
        </>
      ) : (
        <form onSubmit={go}>
          <label>New password
            <div className="inline">
              <input value={pw} onChange={(e) => setPw(e.target.value)} required minLength={8} maxLength={72} placeholder="min 8 characters" />
              <button type="button" className="btn small secondary" onClick={() => setPw(genPassword())}>Generate</button>
            </div>
          </label>
          {err && <p className="error-text">{err}</p>}
          <div className="modal-actions"><button type="button" className="btn secondary" onClick={onClose}>Cancel</button><button className="btn">Reset password</button></div>
        </form>
      )}
    </Modal>
  );
}

function DeleteModal({ admin, onClose, onDone }) {
  const [typed, setTyped] = useState('');
  const [err, setErr] = useState('');
  const go = async () => {
    try { await api(`/superadmin/admins/${admin.id}`, { method: 'DELETE' }); onDone(); } catch (e) { setErr(e.message); }
  };
  return (
    <Modal title="Delete admin permanently?" onClose={onClose} width={480}>
      <p><b>{admin.name}</b> and <b>all of their data</b> — WhatsApp settings, chat flows, automations, submissions, products, orders — will be erased. This cannot be undone. Consider deactivating instead.</p>
      <label style={{ marginTop: 12 }}>Type <code>{admin.username}</code> to confirm<input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus /></label>
      {err && <p className="error-text">{err}</p>}
      <div className="modal-actions">
        <button className="btn secondary" onClick={onClose}>Cancel</button>
        <button className="btn danger" disabled={typed !== admin.username} onClick={go}>Delete forever</button>
      </div>
    </Modal>
  );
}
