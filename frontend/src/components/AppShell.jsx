import { useState } from 'react';
import { NavLink, Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const SUPER_NAV = [
  { group: 'Platform', items: [
    { to: '/super/dashboard', label: 'Dashboard', ico: '📊' },
    { to: '/super/admins', label: 'Admins & activation', ico: '🛡️' },
  ] },
  { group: 'Account', items: [
    { to: '/super/account', label: 'Change password', ico: '🔑' },
  ] },
];

// `gate: true` -> locked until WhatsApp setup is saved + tested.  `ecom: true` -> ECOMMERCE admins only.
const ADMIN_NAV = [
  { group: 'Overview', items: [
    { to: '/app/dashboard', label: 'Dashboard', ico: '📊' },
  ] },
  { group: 'WhatsApp', items: [
    { to: '/app/setup', label: 'Setup', ico: '⚙️', status: true },
    { to: '/app/flows', label: 'Chat flows', ico: '🔀', gate: true },
    { to: '/app/automations', label: 'Automations', ico: '🤖', gate: true },
    { to: '/app/submissions', label: 'Form submissions', ico: '📥' },
    { to: '/app/conversations', label: 'Conversations', ico: '💬' },
  ] },
  { group: 'Ecommerce', ecom: true, items: [
    { to: '/app/orders', label: 'Orders', ico: '🧾' },
    { to: '/app/categories', label: 'Categories', ico: '🗂️' },
    { to: '/app/products', label: 'Products', ico: '🍬' },
    { to: '/app/outlets', label: 'Outlets', ico: '📍' },
    { to: '/app/bulk', label: 'Bulk enquiries', ico: '🎁' },
  ] },
  { group: 'Account', items: [
    { to: '/app/profile', label: 'Profile & password', ico: '👤' },
    { to: '/app/guide', label: 'Setup guide', ico: '📘' },
  ] },
];

function SetupBanner() {
  const { setupLoaded, setupReady, setup } = useAuth();
  const { pathname } = useLocation();
  if (!setupLoaded || setupReady || pathname.startsWith('/app/setup')) return null;
  return (
    <div className="warn" style={{ marginTop: 0, marginBottom: 18, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ flex: 1, minWidth: 220 }}>
        <b>{setup?.whatsappConfigured ? 'Finish testing your WhatsApp connection' : 'Add your WhatsApp credentials'}</b> to unlock Chat flows and Automations.
      </span>
      <Link className="btn small" to="/app/setup">Open Setup</Link>
    </div>
  );
}

export default function AppShell() {
  const { user, logout, setupReady, isEcommerce } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const isSuper = user.role === 'SUPER_ADMIN';
  const groups = isSuper ? SUPER_NAV : ADMIN_NAV.filter((g) => !g.ecom || isEcommerce);

  return (
    <div className="app-shell">
      <aside className={'sidebar' + (open ? ' open' : '')} onClick={() => setOpen(false)}>
        <div className="brand">
          <div className="brand-mark">💬</div>
          <div className="brand-text">WA Automate<span>{isSuper ? 'Super admin' : 'Admin console'}</span></div>
        </div>
        {groups.map((g) => (
          <div key={g.group}>
            <div className="nav-group">{g.group}</div>
            {g.items.map((it) => {
              const locked = it.gate && !setupReady;
              return (
                <NavLink key={it.to} to={it.to} className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')} title={locked ? 'Complete WhatsApp setup first' : undefined}>
                  <span className="nav-ico">{it.ico}</span>{it.label}
                  {locked && <span className="nav-end">🔒</span>}
                  {it.status && <span className={'nav-end dot ' + (setupReady ? 'ok' : 'warn')} />}
                </NavLink>
              );
            })}
          </div>
        ))}
        <div className="sidebar-footer">
          <button className="nav-link" onClick={() => { logout(); nav('/login'); }}><span className="nav-ico">↩</span>Log out</button>
        </div>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <button className="btn ghost menu-btn" onClick={() => setOpen(true)} aria-label="Open menu">☰</button>
          <span className="role-pill">{isSuper ? 'Super admin' : isEcommerce ? 'Admin · Ecommerce' : 'Admin'}</span>
          <span className="spacer" />
          <span style={{ fontWeight: 600, fontSize: 13.5 }}>{user.name}{user.company ? <span className="muted"> · {user.company}</span> : null}</span>
        </header>
        <main className="content">
          {!isSuper && <SetupBanner />}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
