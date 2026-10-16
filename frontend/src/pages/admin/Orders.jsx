import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../../api/client';
import { Badge, inr, fmtDate } from '../../lib/ui';

const FLOW = ['new', 'packed', 'ready', 'dispatched', 'delivered', 'cancelled'];
const LABEL = { new: 'confirmed', ready: 'ready for pickup', dispatched: 'out for delivery' };

export default function Orders() {
  const [params] = useSearchParams();
  const [f, setF] = useState({
    status: params.get('status') || '', paymentStatus: params.get('paymentStatus') || '',
    q: '', from: '', to: '', branch: '', fulfilment: '',
  });
  const [branches, setBranches] = useState([]);
  const [rider, setRider] = useState({ name: '', phone: '', trackingUrl: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ data: [], total: 0, pages: 1 });
  const [sel, setSel] = useState(null);
  const [notify, setNotify] = useState(true);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try { setData(await api('/orders' + qs({ ...f, page, limit: 20 }))); setErr(''); } catch (e) { setErr(e.message); }
  }, [f, page]);

  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, [load]);
  useEffect(() => { api('/branches').then((r) => setBranches(r.data)).catch(() => {}); }, []);
  const open = (o) => { setSel(o); setMsg(null); setRider({ name: o.rider?.name || '', phone: o.rider?.phone || '', trackingUrl: o.rider?.trackingUrl || '' }); };
  const saveRider = async () => {
    try { const o = (await api(`/orders/${sel._id}/rider`, { method: 'PATCH', body: rider })).data; setSel(o); setMsg({ ok: true, text: 'Rider details saved (included in the next “out for delivery” message).' }); load(); }
    catch (e) { setMsg({ ok: false, text: e.message }); }
  };

  const setFilter = (k, v) => { setPage(1); setF({ ...f, [k]: v }); };

  const updateStatus = async (status) => {
    setMsg(null);
    try {
      const r = (await api(`/orders/${sel._id}/status`, { method: 'PATCH', body: { status, notify } })).data;
      setSel(r.order);
      setMsg({ ok: true, text: r.notified ? (r.via === 'template' ? 'Status updated & customer notified via approved template ✅ (24h window was closed)' : 'Status updated & customer notified on WhatsApp ✅') : (r.notifyError || 'Status updated.') });
      load();
    } catch (e) { setMsg({ ok: false, text: e.message }); }
  };

  const exportCsv = () => {
    const rows = [['OrderID', 'Date', 'Name', 'Phone', 'Type', 'Outlet', 'Pickup slot', 'Address', 'Items', 'Delivery fee', 'Amount', 'Payment', 'Status']];
    data.data.forEach(o => rows.push([
      o.orderId, new Date(o.createdAt).toLocaleString(), o.name, o.phone, o.fulfilment, o.branchName, o.pickupSlot, o.address,
      o.items.map(i => `${i.name}${i.variant ? ' (' + i.variant + ')' : ''} x${i.qty}`).join('; '), o.deliveryFee, o.amount, o.paymentStatus, o.status,
    ]));
    const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  return (
    <>
      <div className="row-between" style={{ marginBottom: 14 }}><h1>Orders <small className="muted">({data.total})</small></h1>
        <button className="btn secondary" onClick={exportCsv}>⬇ Export CSV (this page)</button></div>
      {err && <div className="error">{err}</div>}

      <div className="card filters">
        <input placeholder="Search order ID / name / phone" value={f.q} onChange={e => setFilter('q', e.target.value)} />
        <select value={f.paymentStatus} onChange={e => setFilter('paymentStatus', e.target.value)}>
          <option value="">All payments</option><option value="paid">Paid</option>
          <option value="pending">Pending</option><option value="expired">Expired</option>
        </select>
        <select value={f.status} onChange={e => setFilter('status', e.target.value)}>
          <option value="">All statuses</option>{FLOW.map(s => <option key={s}>{s}</option>)}
        </select>
        <select value={f.branch} onChange={e => setFilter('branch', e.target.value)}>
          <option value="">All outlets</option>{branches.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
        </select>
        <select value={f.fulfilment} onChange={e => setFilter('fulfilment', e.target.value)}>
          <option value="">Delivery + pickup</option><option value="delivery">Delivery</option><option value="pickup">Pickup</option>
        </select>
        <input type="date" value={f.from} onChange={e => setFilter('from', e.target.value)} />
        <input type="date" value={f.to} onChange={e => setFilter('to', e.target.value)} />
      </div>

      <div className="card table-wrap">
        <table>
          <thead><tr><th>Order</th><th>Time</th><th>Customer</th><th>Outlet</th><th>Items</th><th>Amount</th><th>Payment</th><th>Status</th><th /></tr></thead>
          <tbody>
            {data.data.map(o => (
              <tr key={o._id}>
                <td><b>{o.orderId}</b></td><td>{fmtDate(o.createdAt)}</td>
                <td>{o.name}<div className="muted">+{o.phone}</div></td>
                <td>{o.branchName || '—'}<div className="muted"><Badge value={o.fulfilment} /></div></td>
                <td>{o.items.map(i => `${i.name}${i.variant ? ' ' + i.variant : ''}×${i.qty}`).join(', ')}</td>
                <td>{inr(o.amount)}</td>
                <td><Badge value={o.paymentStatus} /></td><td><Badge value={o.status} /></td>
                <td><button className="btn small" onClick={() => open(o)}>View</button></td>
              </tr>
            ))}
            {!data.data.length && <tr><td colSpan="9" className="muted center">No orders found</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="pager">
        <button className="btn secondary small" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</button>
        <span>Page {data.page || page} of {data.pages}</span>
        <button className="btn secondary small" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Next →</button>
      </div>

      {sel && (
        <div className="modal-backdrop" onClick={() => setSel(null)}>
          <div className="modal" style={{ maxWidth: 640 }} onClick={e => e.stopPropagation()}>
            <div className="row-between"><h2>Order {sel.orderId}</h2><button className="link" onClick={() => setSel(null)}>✕</button></div>
            <p><Badge value={sel.paymentStatus} /> <Badge value={sel.status} /> <span className="muted">{fmtDate(sel.createdAt)}</span></p>
            <h4>Customer</h4>
            <p><b>{sel.name}</b><br />
              <a href={`https://wa.me/${sel.phone}`} target="_blank" rel="noreferrer">💬 +{sel.phone}</a><br />
              {sel.address}</p>
            <p><Badge value={sel.fulfilment} /> <b>{sel.branchName}</b>{sel.distanceKm != null && ` · ${sel.distanceKm} km`}{sel.pickupSlot && <> · 🕒 {sel.pickupSlot}</>}
              {sel.location?.lat != null && <> · <a href={`https://maps.google.com/?q=${sel.location.lat},${sel.location.lng}`} target="_blank" rel="noreferrer">📍 customer pin</a></>}</p>
            <h4>Items</h4>
            <table><tbody>
              {sel.items.map((i, k) => <tr key={k}><td>{i.name}{i.variant && ` (${i.variant})`}</td><td>× {i.qty}</td><td>{inr(i.price * i.qty)}</td></tr>)}
              {sel.deliveryFee > 0 && <tr><td colSpan="2">Delivery</td><td>{inr(sel.deliveryFee)}</td></tr>}
              <tr><td colSpan="2"><b>Total</b></td><td><b>{inr(sel.amount)}</b></td></tr>
            </tbody></table>
            {sel.paymentId && <p className="muted">Razorpay payment: {sel.paymentId}</p>}

            <h4>Update status</h4>
            <div className="status-buttons">
              {FLOW.map(s => (
                <button key={s} className={`btn small ${sel.status === s ? '' : 'secondary'}`}
                  disabled={sel.status === s || (s === 'ready' && sel.fulfilment !== 'pickup') || (s === 'dispatched' && sel.fulfilment === 'pickup')}
                  onClick={() => updateStatus(s)}>{LABEL[s] || s}</button>
              ))}
            </div>
            {sel.fulfilment === 'delivery' && (
              <>
                <h4>Delivery partner / rider (optional)</h4>
                <div className="inline">
                  <input placeholder="Rider / partner name" value={rider.name} onChange={e => setRider({ ...rider, name: e.target.value })} />
                  <input placeholder="Rider phone" value={rider.phone} onChange={e => setRider({ ...rider, phone: e.target.value })} />
                  <input placeholder="Live tracking link (Porter / Dunzo / Swiggy Genie…)" value={rider.trackingUrl} onChange={e => setRider({ ...rider, trackingUrl: e.target.value })} />
                  <button className="btn small secondary" onClick={saveRider}>Save rider</button>
                </div>
              </>
            )}
            <label className="check"><input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} /> Notify customer on WhatsApp</label>
            {msg && <div className={msg.ok ? 'success' : 'error'}>{msg.text}</div>}
          </div>
        </div>
      )}
    </>
  );
}
