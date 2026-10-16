const Product = require('../models/Product');

// A product always has >= 1 sellable size: its variants, or (legacy) its single price/unit
const variantsOf = (p) => (p.variants?.length ? p.variants : [{ label: p.unit || 'pack', price: p.price, sku: '' }]);

// Meta catalog retailer_id -> { product, variant }. Matches a variant SKU first, then the product code.
async function resolveSku(adminId, id) {
  const key = String(id || '').trim().toUpperCase();
  if (!key) return null;
  let p = await Product.findOne({ admin: adminId, 'variants.sku': key, available: true });
  if (p) return { product: p, variant: p.variants.find((v) => v.sku === key) };
  p = await Product.findOne({ admin: adminId, code: key, available: true });
  return p ? { product: p, variant: variantsOf(p)[0] } : null;
}

// Re-price a cart from the database (never trust prices stored in a session).
async function refreshCart(adminId, cart) {
  const out = [];
  for (const it of cart) {
    const p = await Product.findOne({ admin: adminId, code: it.code, available: true });
    if (!p) continue;
    const v = variantsOf(p).find((x) => x.label === it.variant) || variantsOf(p)[0];
    out.push({ code: p.code, name: p.name, variant: v.label, sku: v.sku || '', price: v.price, qty: it.qty });
  }
  return out;
}

module.exports = { variantsOf, resolveSku, refreshCart };
