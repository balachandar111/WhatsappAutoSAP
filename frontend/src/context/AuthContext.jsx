import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, TOKEN_KEY, USER_KEY } from '../api/client';

const AuthContext = createContext(null);
const EMPTY_SETUP = { whatsappConfigured: false, whatsappVerified: false, missing: [], webhookSubscribedAt: null, razorpayConfigured: false };
const NO_FEATURES = { flows: true, automations: true, ecommerce: false };

const readUser = () => { try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; } };
const storeUser = (u) => localStorage.setItem(USER_KEY, JSON.stringify(u));

export function AuthProvider({ children }) {
  const [user, setUser] = useState(readUser);
  // Setup status drives the lock on "Chat flows" and "Automations" (admins only).
  const [setup, setSetup] = useState(null);

  const refreshSetup = useCallback(async () => {
    try { setSetup((await api('/setup/status')).data); } catch { setSetup(EMPTY_SETUP); }
  }, []);

  // The Super Admin can change an admin's type / status any time: re-read the account on load so menus stay right.
  const refreshUser = useCallback(async () => {
    try { const { user: u } = await api('/auth/me'); storeUser(u); setUser(u); return u; } catch { return null; }
  }, []);

  useEffect(() => {
    if (user?.role === 'ADMIN') refreshSetup(); else setSetup(null);
  }, [user?.id, user?.role, refreshSetup]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (localStorage.getItem(TOKEN_KEY)) refreshUser(); }, [refreshUser]);

  const login = async (username, password) => {
    const { token, user: u } = await api('/auth/login', { method: 'POST', body: { username, password } });
    localStorage.setItem(TOKEN_KEY, token);
    storeUser(u);
    setUser(u);
    return u;
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null); setSetup(null);
  };

  const features = user?.features || NO_FEATURES;

  return (
    <AuthContext.Provider value={{
      user, features, isEcommerce: !!features.ecommerce,
      setup, setupLoaded: setup !== null, setupReady: !!setup?.whatsappVerified,
      refreshSetup, refreshUser, login, logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
