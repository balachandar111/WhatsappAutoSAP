import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { PageHeader } from '../../components/common';

const EMPTY = { key: '', label: '', emoji: '', description: '', sortOrder: 0, active: true };
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);

// Categories are the rows of the WhatsApp ordering menu. Products reference a category by its key.
export default function Categories() {
  const [list, setList] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [keyTouched, setKeyTouched] = useState(false);
  const [err, setErr] = useState('');

  const load = () => api('/categories').then((r) => setList(r.data)).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const setLabel = (label) => setForm((f) => ({ ...f, label, key: editId || keyTouched ? f.key : slug(label) }));

  const submit = async (e) => {
    e.preventDefault(); setErr('');
    try {
      await api(editId ? `/categories/${editId}` : '/categories', { method: editId ? 'PUT' : 'POST', body: { ...form, sortOrder: Number(form.sortOrder) || 0 } });
      setForm(EMPTY); setEditId(null); setKeyTouched(false); load();
    } catch (er) { setErr(er.message); }
  };
  const edit = (c) => { setEditId(c._id); setForm({ key: c.key, label: c.label, emoji: c.emoji || '', description: c.description || '', sortOrder: c.sortOrder || 0, active: c.active }); window.scrollTo(0, 0); };
  const cancel = () => { setEditId(null); setForm(EMPTY); setKeyTouched(false); };
  const toggle = async (c) => { try { await api(`/categories/${c._id}`, { method: 'PUT', body: { active: !c.active } }); load(); } catch (e) { setErr(e.message); } };
  const del = async (c) => { if (confirm(`Delete category “${c.label}”?`)) { try { await api(`/categories/${c._id}`, { method: 'DELETE' }); setErr(''); load(); } catch (e) { setErr(e.message); } } };

  return (
    <>
      <PageHeader title="Categories" subtitle="Categories are the first menu the ordering bot shows on WhatsApp (e.g. Sweets, Savouries). Create them before adding products." />
      <form className="card" onSubmit={submit}>
        <div className="grid2">
          <label>Name shown to customers (max 40)<input value={form.label} onChange={(e) => setLabel(e.target.value)} required maxLength={40} placeholder="Sweets" /></label>
          <label>Key (a-z, 0-9, “-”; cannot change later)<input value={form.key} onChange={(e) => { setKeyTouched(true); setForm({ ...form, key: slug(e.target.value) }); }} required disabled={!!editId} placeholder="sweets" /></label>
          <label>Emoji (optional)<input value={form.emoji} onChange={(e) => setForm({ ...form, emoji: e.target.value })} maxLength={8} placeholder="🍬" /></label>
          <label>Short description (max 72)<input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={72} /></label>
          <label>Sort order (lower first)<input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} /></label>
        </div>
        <div className="inline">
          <button className="btn">{editId ? 'Update category' : 'Add category'}</button>
          {editId && <button type="button" className="btn secondary" onClick={cancel}>Cancel</button>}
        </div>
        {err && <div className="error">{err}</div>}
      </form>

      <div className="card table-wrap">
        <table>
          <thead><tr><th>Order</th><th>Category</th><th>Key</th><th>Products</th><th>Active</th><th /></tr></thead>
          <tbody>
            {list.map((c) => (
              <tr key={c._id} className={c.active ? '' : 'dim'}>
                <td>{c.sortOrder}</td>
                <td><b>{c.emoji} {c.label}</b><div className="muted">{c.description}</div></td>
                <td className="mono">{c.key}</td><td>{c.products}</td>
                <td><input type="checkbox" checked={c.active} onChange={() => toggle(c)} /></td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="btn small secondary" onClick={() => edit(c)}>Edit</button>{' '}
                  <button className="btn small danger" onClick={() => del(c)}>Delete</button>
                </td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan="6" className="muted center">No categories yet — add your first one above.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
