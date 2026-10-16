// Distance + pickup-slot helpers. All slot maths are done in IST (Asia/Kolkata, UTC+5:30).
const R = 6371;
const rad = (d) => (d * Math.PI) / 180;

function km(aLat, aLng, bLat, bLng) {
  const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// branches sorted nearest-first: [{ b, d }]
const rank = (branches, lat, lng) =>
  branches.map(b => ({ b, d: km(lat, lng, b.lat, b.lng) })).sort((x, y) => x.d - y.d);

const IST = 330 * 60000;
const pad = (n) => String(n).padStart(2, '0');
const hm = (t, dflt) => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : dflt; };
const h12 = (mins) => { const h = Math.floor(mins / 60), m = mins % 60; return `${((h + 11) % 12) + 1}${m ? ':' + pad(m) : ''} ${h >= 12 ? 'PM' : 'AM'}`; };

// 1-hour pickup windows: rest of today (starting >= 60 min from now) + tomorrow. Max 9 (WhatsApp lists allow 10 rows).
function pickupSlots(branch, now = new Date(), max = 9) {
  const open = hm(branch?.openTime, 9 * 60), close = hm(branch?.closeTime, 21 * 60);
  const ist = new Date(now.getTime() + IST);
  const nowMin = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const out = [];
  const day = (offset, label) => {
    const from = offset === 0 ? Math.max(open, Math.ceil((nowMin + 60) / 60) * 60) : open;
    for (let t = from; t + 60 <= close && out.length < max; t += 60) {
      const d = new Date(ist.getTime() + offset * 86400000);
      out.push({ label: `${label} ${h12(t)}-${h12(t + 60)}`, date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, start: h12(t) });
    }
  };
  day(0, 'Today');
  day(1, 'Tomorrow');
  return out.slice(0, max);
}

module.exports = { km, rank, pickupSlots };
