// Fetch wrapper for the WA Automation backend.
//  - adds the JWT, JSON-encodes bodies
//  - throws Error(message) on failure (error.status / error.code / error.details are attached)
//  - 401 -> session expired, deactivated account -> forced logout
// Dev: Vite proxies /api -> :5000.  Separate hosting: VITE_API_URL=https://backend.example.com/api
const BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/+$/, '');

export const TOKEN_KEY = 'wa_token';
export const USER_KEY = 'wa_user';
export const API_BASE = BASE;

function forceLogout(reason) {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  window.location.href = `/login?reason=${reason}`;
}

const authHeader = () => {
  const t = localStorage.getItem(TOKEN_KEY);
  return t ? { Authorization: `Bearer ${t}` } : {};
};

async function send(path, init) {
  let res;
  try {
    res = await fetch(BASE + path, init);
  } catch {
    throw new Error('Cannot reach the server. Check that the backend is running and that VITE_API_URL / CORS are set correctly.');
  }
  return res;
}

async function fail(res, path, data) {
  const msg = data?.message || `Request failed (${res.status})`;
  const isLogin = path === '/auth/login';
  if (!isLogin && res.status === 401) { forceLogout('expired'); }
  // the backend answers 403 (no code) with "...deactivated..." when the Super Admin switched the account off
  if (!isLogin && res.status === 403 && !data?.code && /deactivated/i.test(msg)) { forceLogout('inactive'); }
  const e = new Error(res.status === 401 && !isLogin ? 'Session expired. Please log in again.' : msg);
  e.status = res.status; e.code = data?.code; e.details = data?.details;
  throw e;
}

// JSON request -> parsed JSON body (`{ success, data, ... }`)
export async function api(path, { method = 'GET', body } = {}) {
  const res = await send(path, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...authHeader() },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) await fail(res, path, data);
  return data;
}

// multipart upload (image / excel). `field` is the multipart field name.
export async function upload(path, field, file) {
  const form = new FormData();
  form.append(field, file);
  const res = await send(path, { method: 'POST', headers: authHeader(), body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) await fail(res, path, data);
  return data;
}

// POST /uploads/image -> { url }  (public https URL that WhatsApp can fetch)
export const uploadImage = (file) => upload('/uploads/image', 'image', file);

// authenticated GET returning a Blob (excel / csv downloads, submission media)
export async function apiBlob(path) {
  const res = await send(path, { headers: authHeader() });
  if (!res.ok) { const data = await res.json().catch(() => ({})); await fail(res, path, data); }
  const cd = res.headers.get('Content-Disposition') || '';
  const m = /filename="?([^";]+)"?/i.exec(cd);
  return { blob: await res.blob(), filename: m ? m[1] : '' };
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function download(path, fallbackName) {
  const { blob, filename } = await apiBlob(path);
  saveBlob(blob, filename || fallbackName);
}

export const qs = (obj) => {
  const p = new URLSearchParams();
  Object.entries(obj).forEach(([k, v]) => { if (v !== '' && v != null) p.set(k, v); });
  const s = p.toString();
  return s ? `?${s}` : '';
};
