const fs = require('fs');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const c = require('../config');
const { bad } = require('../utils/http');

const ROOT = path.resolve(c.UPLOAD_DIR);
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };   // WhatsApp only renders jpeg/png (webp for stickers), so no gif/svg

const storage = multer.diskStorage({
  destination: (req, _f, cb) => { const d = path.join(ROOT, String(req.admin._id)); fs.mkdirSync(d, { recursive: true }); cb(null, d); },
  filename: (_req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex') + EXT[file.mimetype]),
});
const upload = multer({
  storage, limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => (EXT[file.mimetype] ? cb(null, true) : cb(Object.assign(new Error('Only JPG, PNG or WEBP images are allowed'), { isUpload: true }))),
}).single('image');

// POST /api/uploads/image   multipart field "image"  ->  { url }   (use it as a product card / step image in the flow builder)
exports.image = (req, res, next) => {
  upload(req, res, (err) => {
    if (err) return next(Object.assign(err, { isUpload: true }));
    if (!req.file) return next(bad('No image uploaded (multipart field "image")'));
    const root = (c.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    res.status(201).json({ success: true, url: `${root}/uploads/${req.admin._id}/${req.file.filename}`, size: req.file.size });
  });
};
exports.ROOT = ROOT;
