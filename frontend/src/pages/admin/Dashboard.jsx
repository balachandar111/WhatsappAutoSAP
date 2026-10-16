import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Loader, PageHeader, StatCard } from '../../components/common';
import { Badge, inr, fmtDate } from '../../lib/ui';

export default function Dashboard() {
  const { user, isEcommerce, setupReady, setup } = useAuth();
  const [d, setD] = useState(null);
  const [orders, setOrders] = useState([]);
  const [stats, setStats] = useState(null);
  const [err, setErr] = useState('');

  const load = async () => {
    try {
      const r = await api('/admin/dashboard');
      setD(r.data); setErr('');
      if (r.data.features?.ecommerce) {
        const [s, o] = await Promise.all([api('/orders/stats'), api('/orders?paymentStatus=paid&status=new&limit=8')]);
        setStats(s.data); setOrders(o.data);
      }
    } catch (e) { setErr(e.message); }
  };
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, []); // eslint-disable-line

  return (
    <>
      <PageHeader title={`Welcome${user?.name ? `, ${user.name.split(' ')[0]}` : ''}`} subtitle={user?.company || 'Your WhatsApp automation overview'} />
      {err && <div className="error">{err}</div>}
      {!d ? !err && <Loader /> : (
        <>
          {!setupReady && (
            <div className="warn" style={{ marginTop: 0 }}>
              <b>{setup?.whatsappConfigured ? 'Run the WhatsApp test' : 'Connect WhatsApp'}</b> to unlock Chat flows and Automations. <Link to="/app/setup">Open Setup →</Link>
            </div>
          )}

          <div className="stat-grid">
            <StatCard label="Chat flows ready" value={`${d.chatflows.ready} / ${d.chatflows.total}`} />
            <StatCard label="Automations live" value={`${d.automations.active} / ${d.automations.total}`} tone="accent" />
            <StatCard label="Active chats (24 h)" value={d.conversations.activeLast24h} />
            <StatCard label="Messages today" value={d.conversations.messagesToday} />
            <StatCard label="Form submissions" value={d.formSubmissions.total} />
            <StatCard label="New submissions" value={d.formSubmissions.new} tone="amber" />
          </div>

          {d.formSubmissions.new > 0 && (
            <div className="card" style={{ marginTop: 18 }}>
              <div className="row-between">
                <span><b>{d.formSubmissions.new}</b> new form submission{d.formSubmissions.new === 1 ? '' : 's'} waiting for review</span>
                <Link className="btn small" to="/app/submissions?status=new">Review →</Link>
              </div>
            </div>
          )}

          {isEcommerce && d.commerce && (
            <>
              <h2 style={{ margin: '26px 0 12px' }}>Ecommerce</h2>
              <div className="stat-grid">
                <StatCard label="Orders today" value={stats?.todayOrders ?? d.commerce.ordersToday} />
                <StatCard label="Revenue today" value={inr(stats?.todayRevenue)} tone="accent" />
                <StatCard label="To pack (paid)" value={stats?.toPack ?? '—'} tone="amber" />
                <StatCard label="Awaiting payment" value={stats?.pendingPayments ?? '—'} />
                <StatCard label="New bulk enquiries" value={d.commerce.newBulkEnquiries} />
                <StatCard label="Products" value={d.commerce.products} />
                <StatCard label="Total orders" value={stats?.totalOrders ?? '—'} />
                <StatCard label="Total revenue" value={inr(d.commerce.totalRevenue)} />
              </div>

              {stats?.byBranch?.length > 0 && (
                <div className="card" style={{ marginTop: 18 }}>
                  <h3>Today by outlet (paid)</h3>
                  <table><thead><tr><th>Outlet</th><th>Orders</th><th>Revenue</th></tr></thead>
                    <tbody>{stats.byBranch.map((b) => <tr key={b.branch}><td>{b.branch}</td><td>{b.orders}</td><td>{inr(b.revenue)}</td></tr>)}</tbody></table>
                </div>
              )}

              <div className="card" style={{ marginTop: 18 }}>
                <div className="row-between">
                  <h3>Paid orders waiting to be packed</h3>
                  <Link to="/app/orders?status=new&paymentStatus=paid">View all →</Link>
                </div>
                {orders.length === 0 ? <p className="muted">Nothing to pack 🎉</p> : (
                  <div className="table-wrap"><table>
                    <thead><tr><th>Order</th><th>Time</th><th>Customer</th><th>Outlet</th><th>Items</th><th>Amount</th><th>Status</th></tr></thead>
                    <tbody>
                      {orders.map((o) => (
                        <tr key={o._id}>
                          <td><b>{o.orderId}</b></td><td>{fmtDate(o.createdAt)}</td>
                          <td>{o.name}<div className="muted">+{o.phone}</div></td>
                          <td>{o.branchName || '—'} <Badge value={o.fulfilment} /></td>
                          <td>{o.items.map((i) => `${i.name}${i.variant ? ' ' + i.variant : ''}×${i.qty}`).join(', ')}</td>
                          <td>{inr(o.amount)}</td><td><Badge value={o.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table></div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
