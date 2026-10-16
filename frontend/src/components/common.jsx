import { useState } from 'react';

export const Loader = ({ label = 'Loading…' }) => <div className="loader">{label}</div>;

export const StatCard = ({ label, value, tone }) => (
  <div className={'stat-card' + (tone ? ` ${tone}` : '')}>
    <div className="stat-label">{label}</div>
    <div className="stat-value">{value}</div>
  </div>
);

export const PageHeader = ({ title, subtitle, actions }) => (
  <div className="page-header">
    <div><h1>{title}</h1>{subtitle && <p className="subtitle">{subtitle}</p>}</div>
    {actions && <div className="page-actions">{actions}</div>}
  </div>
);

export function Copy({ text, label = 'Copy' }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className="btn small secondary" onClick={() => { navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); }}>
      {ok ? 'Copied ✓' : label}
    </button>
  );
}

export const Switch = ({ checked, onChange, disabled, label }) => (
  <label className="switch" aria-label={label}>
    <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    <span className="track" />
  </label>
);
