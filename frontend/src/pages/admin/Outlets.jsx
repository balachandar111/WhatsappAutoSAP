import { useEffect, useState } from 'react';
import { api } from '../../api/client';

const EMPTY = { code: '', name: '', address: '', phone: '', alertPhone: '', lat: '', lng: '', openTime: '09:00', closeTime: '21:00', active: true };

export default function Outlets() {
  const [list, setList] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [err, setErr] = useState('');
  const load = () => api('/branches').then(r => setList(r.data)).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);
  const f = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault(); setErr('');
    try {
      await api(editId ? `/branches/${editId}` : '/branches', { method: editId ? 'PUT' : 'POST', body: form });
      setForm(EMPTY); setEditId(null); load();
    } catch (er) { setErr(er.message); }
  };
  const edit = (b) => { setEditId(b._id); setForm({ ...EMPTY, ...b }); window.scrollTo(0, 0); };
  const toggle = async (b) => { try { await api(`/branches/${b._id}`, { method: 'PUT', body: { active: !b.active } }); load(); } catch (e) { setErr(e.message); } };
  const del = async (b) => { if (confirm(`Delete outlet ${b.name}?`)) { try { await api(`/branches/${b._id}`, { method: 'DELETE' }); load(); } catch (e) { setErr(e.message); } } };

  return (
    <>
      <h1>Outlets</h1>
      <p className="muted">Orders are routed to the <b>nearest active outlet</b> using the customer's shared WhatsApp location. Latitude/longitude: open the shop in Google Maps → right-click the pin → click the coordinates to copy.</p>
      <form className="card" onSubmit={submit}>
        <div className="grid2">
          <label>Code (unique, e.g. KDB)<input value={form.code} onChange={f('code')} required disabled={!!editId} /></label>
          <label>Name<input value={form.name} onChange={f('name')} required /></label>
          <label>Address (shown to customers)<input value={form.address} onChange={f('address')} /></label>
          <label>Shop phone (shown to customers)<input value={form.phone} onChange={f('phone')} placeholder="+91 44 ..." /></label>
          <label>Latitude<input type="number" step="any" value={form.lat} onChange={f('lat')} required placeholder="13.0512" /></label>
          <label>Longitude<input type="number" step="any" value={form.lng} onChange={f('lng')} required placeholder="80.2246" /></label>
          <label>Opens (pickup slots)<input type="time" value={form.openTime} onChange={f('openTime')} /></label>
          <label>Closes<input type="time" value={form.closeTime} onChange={f('closeTime')} /></label>
          <label>WhatsApp alert number for this outlet's paid orders (optional, e.g. 919876543210)<input value={form.alertPhone} onChange={f('alertPhone')} /></label>
        </div>
        <div className="inline">
          <button className="btn">{editId ? 'Update outlet' : 'Add outlet'}</button>
          {editId && <button type="button" className="btn secondary" onClick={() => { setEditId(null); setForm(EMPTY); }}>Cancel</button>}
        </div>
        {err && <div className="error">{err}</div>}
      </form>

      <div className="card table-wrap">
        <table>
          <thead><tr><th>Code</th><th>Name</th><th>Address / phone</th><th>Lat, Lng</th><th>Hours</th><th>Active</th><th /></tr></thead>
          <tbody>
            {list.map(b => (
              <tr key={b._id} className={b.active ? '' : 'dim'}>
                <td>{b.code}</td><td><b>{b.name}</b></td>
                <td>{b.address}<div className="muted">{b.phone}</div></td>
                <td>{b.lat}, {b.lng}</td><td>{b.openTime}–{b.closeTime}</td>
                <td><input type="checkbox" checked={b.active} onChange={() => toggle(b)} /></td>
                <td><button className="btn small secondary" onClick={() => edit(b)}>Edit</button>{' '}
                  <button className="btn small danger" onClick={() => del(b)}>Delete</button></td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan="7" className="muted center">No outlets yet — add your first outlet using the form above.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
