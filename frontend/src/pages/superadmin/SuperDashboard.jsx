import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { Loader, PageHeader, StatCard } from '../../components/common';
import { Badge, fmtDay } from '../../lib/ui';

export default function SuperDashboard() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api('/superadmin/dashboard').then((r) => setD(r.data)).catch((e) => setErr(e.message)); }, []);

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Platform-wide overview" actions={<Link className="btn" to="/super/admins">Manage admins →</Link>} />
      {err && <div className="error">{err}</div>}
      {!d ? !err && <Loader /> : (
        <>
          <div className="stat-grid">
            <StatCard label="Total admins" value={d.totalAdmins} />
            <StatCard label="Active admins" value={d.activeAdmins} tone="accent" />
            <StatCard label="Inactive admins" value={d.inactiveAdmins} />
            <StatCard label="Normal admins" value={d.normalAdmins} />
            <StatCard label="Ecommerce admins" value={d.ecommerceAdmins} />
            <StatCard label="WhatsApp connected" value={d.adminsWithVerifiedWhatsapp} tone="accent" />
            <StatCard label="Chat flows" value={d.totalChatflows} />
            <StatCard label="Automations" value={`${d.activeAutomations} / ${d.totalAutomations} live`} tone="amber" />
            <StatCard label="Form submissions" value={d.totalSubmissions} />
            <StatCard label="Orders" value={d.totalOrders} />
          </div>

          <div className="card" style={{ marginTop: 18 }}>
            <h3>Recently added admins</h3>
            {d.recentAdmins?.length ? (
              <div className="table-wrap"><table>
                <thead><tr><th>Admin</th><th>Type</th><th>Status</th><th>Created</th></tr></thead>
                <tbody>{d.recentAdmins.map((a) => (
                  <tr key={a.id}><td><b>{a.name}</b><div className="muted">{a.company || a.username}</div></td><td><Badge value={a.adminType} /></td><td><Badge value={a.status} /></td><td>{fmtDay(a.createdAt)}</td></tr>
                ))}</tbody>
              </table></div>
            ) : <p className="muted">No admins yet.</p>}
          </div>
        </>
      )}
    </>
  );
}
