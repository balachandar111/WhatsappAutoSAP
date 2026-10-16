const { HttpError } = require('../utils/http');

const notFoundHandler = (req, res) => res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.path}` });

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) return res.status(err.status).json({ success: false, message: err.message, ...(err.code ? { code: err.code } : {}), ...(err.details ? { details: err.details } : {}) });
  if (err.name === 'ValidationError') return res.status(400).json({ success: false, message: Object.values(err.errors).map((e) => e.message).join(', ') });
  if (err.name === 'CastError') return res.status(400).json({ success: false, message: `Invalid ${err.path}` });
  if (err.code === 11000) return res.status(409).json({ success: false, message: 'Already exists: ' + Object.keys(err.keyPattern || {}).filter((k) => k !== 'admin').join(', ') });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ success: false, message: 'Invalid JSON body' });
  if (err.type === 'entity.too.large') return res.status(413).json({ success: false, message: 'Request body too large' });
  if (err.name === 'MulterError' || err.isUpload) return res.status(400).json({ success: false, message: err.message });
  console.error(`[${req.method} ${req.originalUrl}]`, err);
  res.status(500).json({ success: false, message: 'Server error' });
}
module.exports = { notFoundHandler, errorHandler };
