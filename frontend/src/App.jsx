import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { ProtectedRoute, RequireSetup, RequireEcommerce } from './components/ProtectedRoute';
import AppShell from './components/AppShell';
import Login from './pages/Login';
import Account from './pages/Account';

import SuperDashboard from './pages/superadmin/SuperDashboard';
import Admins from './pages/superadmin/Admins';

import Dashboard from './pages/admin/Dashboard';
import Setup from './pages/admin/Setup';
import Guide from './pages/admin/Guide';
import FlowList from './pages/admin/flows/FlowList';
import FlowBuilder from './pages/admin/flows/FlowBuilder';
import Automations from './pages/admin/Automations';
import Submissions from './pages/admin/Submissions';
import Conversations from './pages/admin/Conversations';
import Orders from './pages/admin/Orders';
import Categories from './pages/admin/Categories';
import Products from './pages/admin/Products';
import Outlets from './pages/admin/Outlets';
import Bulk from './pages/admin/Bulk';

function Home() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === 'SUPER_ADMIN' ? '/super/dashboard' : '/app/dashboard'} replace />;
}

const eco = (feature, el) => <RequireEcommerce feature={feature}>{el}</RequireEcommerce>;

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />

      <Route path="/super" element={<ProtectedRoute role="SUPER_ADMIN"><AppShell /></ProtectedRoute>}>
        <Route path="dashboard" element={<SuperDashboard />} />
        <Route path="admins" element={<Admins />} />
        <Route path="account" element={<Account />} />
        <Route index element={<Navigate to="dashboard" replace />} />
      </Route>

      <Route path="/app" element={<ProtectedRoute role="ADMIN"><AppShell /></ProtectedRoute>}>
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="setup" element={<Setup />} />
        <Route path="guide" element={<Guide />} />
        <Route path="profile" element={<Account />} />
        <Route path="flows" element={<RequireSetup feature="Chat flows"><FlowList /></RequireSetup>} />
        <Route path="flows/:id" element={<RequireSetup feature="Chat flows"><FlowBuilder /></RequireSetup>} />
        <Route path="automations" element={<RequireSetup feature="Automations"><Automations /></RequireSetup>} />
        <Route path="submissions" element={<Submissions />} />
        <Route path="conversations" element={<Conversations />} />
        <Route path="orders" element={eco('Orders', <Orders />)} />
        <Route path="categories" element={eco('Categories', <Categories />)} />
        <Route path="products" element={eco('Products', <Products />)} />
        <Route path="outlets" element={eco('Outlets', <Outlets />)} />
        <Route path="bulk" element={eco('Bulk enquiries', <Bulk />)} />
        <Route index element={<Navigate to="dashboard" replace />} />
      </Route>

      <Route path="*" element={<Home />} />
    </Routes>
  );
}
