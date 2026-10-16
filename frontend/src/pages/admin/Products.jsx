import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs, uploadImage } from '../../api/client';
import { PageHeader } from '../../components/common';
import { inr } from '../../lib/ui';

const blankVariant = () => ({ label: '', price: '', sku: '' });
const EMPTY = (category = '') => ({ code: '', name: '', category, description: '', image: '', available: true, variants: [{ label: '250g', price: '', sku: '' }], unavailableAt: [] });

export default function Products() {
  const [list, setList] = useState([]);
  const [cats, setCats] = useState(null);
  const [branches, setBranches] = useState([]);
  const [form, setForm] = useState(EMPTY());
  const [editId, setEditId] = useState(null);
  const [filter, setFilter] = useState({ q: '', category: '' });
  const [err, setErr] = useState('');
  const [upBusy, setUpBusy] = useState(false);

  const loadProducts = () => api('/products' + qs(filter)).then((r) => setList(r.data)).catch((e) => setErr(e.message));
  useEffect(() => {
    Promise.all([api('/categories'), api('/branches')]).then(([c, b]) => { setCats(c.data); setBranches(b.data); setForm((f) => (f.category ? f : { ...f, category: c.data[0]?.key || '' })); }).catch((e) => setErr(e.message));
  }, []);
  useEffect(() => { const t = setTimeout(loadProducts, filter.q ? 250 : 0); return () => clearTimeout(t); }, [filter]); // eslint-disable-line

  const catLabel = (key) => cats?.find((c) => c.key === key)?.label || key;
  const setVar = (i, k, v) => setForm({ ...form, variants: form.variants.map((x, j) => (j === i ? { ...x, [k]: v } : x)) });
  const toggleOut = (code) => setForm({ ...form, unavailableAt: form.unavailableAt.includes(code) ? form.unavailableAt.filter((c) => c !== code) : [...form.unavailableAt, code] });
  const reset = () => { setForm(EMPTY(cats?.[0]?.key || '')); setEditId(null); };

  const pickImage = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setUpBusy(true); setErr('');
    try { const { url } = await uploadImage(file); setForm((f) => ({ ...f, image: url })); } catch (er) { setErr(er.message); }
    setUpBusy(false);
  };

  const submit = async (e) => {
    e.preventDefault(); setErr('');
    const variants = form.variants.filter((v) => v.label.trim() && v.price !== '').map((v) => ({ label: v.label.trim(), price: Number(v.price), sku: v.sku.trim() }));
    if (!variants.length) return setErr('Add at least one size with a price');
    if (!form.category) return setErr('Choose a category (create one first on the Categories page)');
    try {
      await api(editId ? `/products/${editId}` : '/products', { method: editId ? 'PUT' : 'POST', body: { ...form, variants } });
      reset(); loadProducts();
    } catch (e2) { setErr(e2.message); }
  };
  const edit = (p) => {
    setEditId(p._id);
    setForm({ code: p.code, name: p.name, category: p.category, description: p.description || '', image: p.image || '', available: p.available, unavailableAt: p.unavailableAt || [],
      variants: p.variants?.length ? p.variants.map((v) => ({ label: v.label, price: v.price, sku: v.sku || '' })) : [{ label: p.unit, price: p.price, sku: '' }] });
    window.scrollTo(0, 0);
  };
  const toggle = async (p) => { try { await api(`/products/${p._id}`, { method: 'PUT', body: { available: !p.available } }); loadProducts(); } catch (e) { setErr(e.message); } };
  const del = async (p) => { if (confirm(`Delete ${p.name}?`)) { try { await api(`/products/${p._id}`, { method: 'DELETE' }); loadProducts(); } catch (e) { setErr(e.message); } } };

  return (
    <>
      <PageHeader title="Products" subtitle="The ordering bot reads products live from here. Each product belongs to a category and can have several sizes." />
      {cats && cats.length === 0 && <div className="warn" style={{ marginTop: 0 }}>You have no categories yet. <Link to="/app/categories">Create a category first →</Link></div>}

      <form className="card" onSubmit={submit}>
        <div className="grid2">
          <label>Code (unique, e.g. SW010)<input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required disabled={!!editId} /></label>
          <label>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
          <label>Category
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} required>
              <option value="">{cats ? 'Select…' : 'Loading…'}</option>
              {(cats || []).map((c) => <option key={c.key} value={c.key}>{c.emoji} {c.label}{c.active ? '' : ' (inactive)'}</option>)}
            </select>
          </label>
          <label>Description (optional)<input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
        </div>
        <div className="field-row" style={{ alignItems: 'center', marginBottom: 6 }}>
          {form.image ? <img className="thumb" src={form.image} alt="" style={{ width: 64, height: 64 }} /> : <div className="thumb-empty" style={{ width: 64, height: 64 }}>No image</div>}
          <label className="btn small secondary" style={{ cursor: 'pointer', margin: 0 }}>{upBusy ? 'Uploading…' : form.image ? 'Change image' : 'Upload image'}
            <input type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={pickImage} /></label>
          {form.image && <button type="button" className="btn small ghost" onClick={() => setForm({ ...form, image: '' })}>Remove</button>}
        </div>
        <h4>Sizes &amp; prices</h4>
        {form.variants.map((v, i) => (
          <div className="filters" key={i} style={{ marginBottom: 8 }}>
            <input placeholder="Size (250g / 500g / 1kg)" value={v.label} onChange={(e) => setVar(i, 'label', e.target.value)} />
            <input type="number" min="0" step="any" placeholder="Price ₹" value={v.price} onChange={(e) => setVar(i, 'price', e.target.value)} />
            <input placeholder="Catalog Content ID (optional)" value={v.sku} onChange={(e) => setVar(i, 'sku', e.target.value)} />
            {form.variants.length > 1 && <button type="button" className="btn small danger" onClick={() => setForm({ ...form, variants: form.variants.filter((_, j) => j !== i) })}>✕</button>}
          </div>
        ))}
        <button type="button" className="btn small secondary" onClick={() => setForm({ ...form, variants: [...form.variants, blankVariant()] })}>+ Add size</button>
        {branches.length > 0 && (
          <>
            <h4>Out of stock at (tick outlets where this item is NOT available)</h4>
            <div className="inline">
              {branches.map((b) => (
                <label key={b.code} className="check"><input type="checkbox" checked={form.unavailableAt.includes(b.code)} onChange={() => toggleOut(b.code)} /> {b.name}</label>
              ))}
            </div>
          </>
        )}
        <div className="inline" style={{ marginTop: 12 }}>
          <button className="btn">{editId ? 'Update product' : 'Add product'}</button>
          {editId && <button type="button" className="btn secondary" onClick={reset}>Cancel</button>}
        </div>
        {err && <div className="error">{err}</div>}
      </form>
      <p className="muted">The first size is the base price. The <b>Content ID</b> is only needed if you use a Meta catalog (it must match the item's Content ID there); otherwise leave it empty.</p>

      <div className="card filters" style={{ marginTop: 12 }}>
        <input placeholder="Search by name or code" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
        <select value={filter.category} onChange={(e) => setFilter({ ...filter, category: e.target.value })}>
          <option value="">All categories</option>{(cats || []).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
      </div>

      <div className="card table-wrap">
        <table>
          <thead><tr><th /><th>Code</th><th>Name</th><th>Category</th><th>Sizes</th><th>Out of stock at</th><th>Available</th><th /></tr></thead>
          <tbody>
            {list.map((p) => (
              <tr key={p._id} className={p.available ? '' : 'dim'}>
                <td style={{ width: 48 }}>{p.image ? <img src={p.image} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 6 }} /> : null}</td>
                <td>{p.code}</td><td>{p.name}{p.description && <div className="muted">{p.description}</div>}</td><td>{catLabel(p.category)}</td>
                <td>{(p.variants?.length ? p.variants : [{ label: p.unit, price: p.price }]).map((v) => `${v.label} ${inr(v.price)}`).join(' · ')}</td>
                <td>{(p.unavailableAt || []).join(', ') || '—'}</td>
                <td><input type="checkbox" checked={p.available} onChange={() => toggle(p)} /></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn small secondary" onClick={() => edit(p)}>Edit</button>{' '}
                  <button className="btn small danger" onClick={() => del(p)}>Delete</button>
                </td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan="8" className="muted center">No products found.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
