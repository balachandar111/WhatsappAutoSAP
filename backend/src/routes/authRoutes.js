const router = require('express').Router();
const rateLimit = require('../middleware/rateLimit');
const { protect } = require('../middleware/auth');
const a = require('../controllers/authController');

router.post('/login', rateLimit(10, 15 * 60 * 1000, (req) => `${req.ip}:${String(req.body?.username || '').toLowerCase()}`), a.login);
router.get('/me', protect, a.me);
router.put('/password', protect, a.changePassword);
module.exports = router;
