export const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
export const fmtDate = (d) =>
  d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
export const fmtDay = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

const COLORS = {
  paid: 'green', pending: 'orange', expired: 'gray',
  new: 'blue', packed: 'purple', ready: 'green', contacted: 'purple', quoted: 'orange', confirmed: 'green', closed: 'gray', reviewed: 'purple',
  delivery: 'blue', pickup: 'purple', dispatched: 'teal', delivered: 'green', cancelled: 'red',
  ACTIVE: 'green', INACTIVE: 'gray', draft: 'orange', verified: 'green', saved: 'orange', none: 'gray',
  NORMAL: 'blue', ECOMMERCE: 'purple', flow: 'blue', commerce: 'purple',
};
const LABELS = {
  ACTIVE: 'Active', INACTIVE: 'Inactive', verified: 'Verified', saved: 'Saved · not tested', none: 'Not configured',
  NORMAL: 'Normal', ECOMMERCE: 'Ecommerce', flow: 'Chat flow', commerce: 'Ordering bot',
};
export const Badge = ({ value }) => <span className={`badge ${COLORS[value] || 'gray'}`}>{LABELS[value] || value}</span>;
