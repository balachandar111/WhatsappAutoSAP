import { useEffect, useState } from 'react';
import { api, TOKEN_KEY } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Loader, PageHeader } from '../components/common';
import { Badge } from '../lib/ui';

// Shared by admins ("Profile & password") and the super admin ("Change password").
export default function Account() {
  const { user, refreshUser } = useAuth();
  const isAdmin = user.role === 'ADMIN';
  const [p, setP] = useState(null);
  const [pMsg, setPMsg] = useState(null);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [pwMsg, setPwMsg] = useState(null);
  const [busy, setBusy] = useState('');

  useEffect(() => { if (isAdmin) api('/admin/profile').then((r) => setP(r.data)).catch((e) => setPMsg({ ok: false, text: e.message })); }, [isAdmin]);

  const saveProfile = async (e) => {
    e.preventDefault(); setBusy('profile'); setPMsg(null);
    try {
      const r = await api('/admin/profile', { method: 'PUT', body: { name: p.name, company: p.company, email: p.email, phone: p.phone } });
      setP(r.data); await refreshUser();
      setPMsg({ ok: true, text: 'Profile saved ✅' });
    } catch (er) { setPMsg({ ok: false, text: er.message }); }
    setBusy('');
  };

  const changePassword = async (e) => {
    e.preventDefault(); setPwMsg(null);
    if (pw.newPassword !== pw.confirm) return setPwMsg({ ok: false, text: 'The new passwords do not match.' });
    setBusy('pw');
    try {
      const r = await api('/auth/password', { method: 'PUT', body: { currentPassword: pw.currentPassword, newPassword: pw.newPassword } });
      if (r.token) localStorage.setItem(TOKEN_KEY, r.token);   // the old token is revoked server-side; keep this session alive
      setPw({ currentPassword: '', newPassword: '', confirm: '' });
      setPwMsg({ ok: true, text: 'Password updated ✅ Other devices have been signed out.' });
    } catch (er) { setPwMsg({ ok: false, text: er.message }); }
    setBusy('');
  };

  const f = (k) => (e) => setP({ ...p, [k]: e.target.value });

  return (
    <>
      <PageHeader title={isAdmin ? 'Profile & password' : 'Change password'} subtitle={isAdmin ? 'Your business contact details and sign-in password.' : 'Update the Super Admin password.'} />

      {isAdmin && (!p ? (pMsg ? <div className="error">{pMsg.text}</div> : <Loader />) : (
        <form className="card" onSubmit={saveProfile}>
          <div className="row-between">
            <h3 style={{ margin: 0 }}>Profile</h3>
            <span className="inline"><Badge value={p.adminType} /><span className="muted">set by the Super Admin</span></span>
          </div>
          <div className="grid2" style={{ marginTop: 12 }}>
            <label>Username<input value={p.username} disabled /></label>
            <label>Full name<input value={p.name || ''} onChange={f('name')} required /></label>
            <label>Company<input value={p.company || ''} onChange={f('company')} /></label>
            <label>Email<input type="email" value={p.email || ''} onChange={f('email')} /></label>
            <label>Phone<input type="tel" value={p.phone || ''} onChange={f('phone')} /></label>
          </div>
          {pMsg && <div className={pMsg.ok ? 'success' : 'error'}>{pMsg.text}</div>}
          <button className="btn" disabled={busy === 'profile'}>{busy === 'profile' ? 'Saving…' : 'Save profile'}</button>
        </form>
      ))}

      <form className="card" onSubmit={changePassword}>
        <h3>Change password</h3>
        <div className="grid2">
          <label>Current password<input type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} required /></label>
          <span />
          <label>New password (8–72 characters)<input type="password" autoComplete="new-password" minLength={8} maxLength={72} value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} required /></label>
          <label>Repeat new password<input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required /></label>
        </div>
        {pwMsg && <div className={pwMsg.ok ? 'success' : 'error'}>{pwMsg.text}</div>}
        <button className="btn" disabled={busy === 'pw'}>{busy === 'pw' ? 'Updating…' : 'Update password'}</button>
      </form>
    </>
  );
}
