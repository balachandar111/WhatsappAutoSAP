const router = require('express').Router();
const { protect, adminOnly } = require('../middleware/auth');
const a = require('../controllers/adminController');

router.use(protect, adminOnly);
router.get('/dashboard', a.dashboard);
router.get('/profile', a.getProfile);
router.put('/profile', a.updateProfile);
module.exports = router;
