import { Navigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Loader } from './common';

export function ProtectedRoute({ role, children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) return <Navigate to={user.role === 'SUPER_ADMIN' ? '/super/dashboard' : '/app/dashboard'} replace />;
  return children;
}

// Orders, products, categories, outlets, bulk enquiries: only for ECOMMERCE admins (set by the Super Admin).
export function RequireEcommerce({ children, feature }) {
  const { isEcommerce } = useAuth();
  if (isEcommerce) return children;
  return (
    <div className="card gate">
      <div className="big">🛍️</div>
      <h2 style={{ margin: '8px 0' }}>{feature} is not enabled for your account</h2>
      <p className="muted" style={{ fontSize: 14, marginBottom: 14 }}>
        Your account is a <b>Normal</b> admin (chat flows + automations). Ask the Super Admin to switch it to <b>Ecommerce</b> to use ordering, products, outlets and bulk enquiries.
      </p>
      <Link className="btn" to="/app/dashboard">Back to dashboard</Link>
    </div>
  );
}

// Chat flows + Automations are locked until the admin has saved AND tested their WhatsApp credentials.
export function RequireSetup({ children, feature }) {
  const { setupLoaded, setupReady, setup } = useAuth();
  if (!setupLoaded) return <Loader />;
  if (setupReady) return children;
  const saved = !!setup?.whatsappConfigured;
  return (
    <div className="card gate">
      <div className="big">🔒</div>
      <h2 style={{ margin: '8px 0' }}>{feature} unlock after WhatsApp setup</h2>
      <p className="muted" style={{ fontSize: 14, marginBottom: 14 }}>
        Save your Meta WhatsApp credentials on the Setup page, then run <b>Test WhatsApp</b>. Once it passes, you can build chat flows and attach them to automations.
      </p>
      <div className="steps-row" style={{ textAlign: 'left' }}>
        <div className={`step-pill ${saved ? 'done' : ''}`}><span className="ico">{saved ? '✓' : '1'}</span>Credentials saved</div>
        <div className={`step-pill ${setupReady ? 'done' : ''}`}><span className="ico">{setupReady ? '✓' : '2'}</span>WhatsApp test passed</div>
      </div>
      <Link className="btn" to="/app/setup">Go to Setup →</Link>
    </div>
  );
}
