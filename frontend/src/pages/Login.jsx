import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const REASONS = {
  inactive: 'Your account has been deactivated. Please contact the super admin.',
  expired: 'Your session expired. Please sign in again.',
};

export default function Login() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={user.role === 'SUPER_ADMIN' ? '/super/dashboard' : '/app/dashboard'} replace />;

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const u = await login(username.trim(), password);
      nav(u.role === 'SUPER_ADMIN' ? '/super/dashboard' : '/app/dashboard', { replace: true });
    } catch (er) { setErr(er.message); }
    setBusy(false);
  };

  const reason = REASONS[params.get('reason')];
  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <div className="login-brand">
          <div className="brand-mark" style={{ width: 44, height: 44, fontSize: 22 }}>💬</div>
          <div><h2>WA Automate</h2><p className="muted">WhatsApp automation platform</p></div>
        </div>
        {reason && !err && <div className="warn" style={{ marginTop: 0 }}>{reason}</div>}
        <label>Username<input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required autoComplete="username" /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" /></label>
        {err && <div className="error" style={{ marginTop: 0 }}>{err}</div>}
        <button className="btn block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
