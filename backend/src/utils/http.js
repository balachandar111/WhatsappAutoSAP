// Small helpers shared by routes.
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);
const notFound = (msg = 'Not found') => new HttpError(404, msg);
const forbidden = (msg = 'Forbidden') => new HttpError(403, msg);

const isId = (v) => /^[a-f0-9]{24}$/i.test(String(v || ''));
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const digits = (v) => String(v || '').replace(/\D/g, '');
const page = (req, dflt = 20, max = 100) => {
  const p = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || dflt, 1), max);
  return { page: p, limit, skip: (p - 1) * limit };
};
// route param guard: 404 instead of a CastError 500 for malformed ids
const idParam = (req, _res, next, v) => (isId(v) ? next() : next(notFound()));

module.exports = { HttpError, bad, notFound, forbidden, isId, escRe, digits, page, idParam };
