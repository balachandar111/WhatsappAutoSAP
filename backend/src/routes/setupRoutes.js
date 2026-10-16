const router = require('express').Router();
const { protect, adminOnly } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const s = require('../controllers/setupController');

router.use(protect, adminOnly);
router.get('/', s.get);
router.get('/status', s.status);
router.put('/', s.save);
router.post('/test-whatsapp', rateLimit(20, 10 * 60 * 1000, (r) => r.user.id), s.testWhatsapp);
router.post('/test-token', rateLimit(20, 10 * 60 * 1000, (r) => r.user.id), s.testToken);
router.post('/subscribe-app', s.subscribeApp);
router.post('/send-test', rateLimit(10, 10 * 60 * 1000, (r) => r.user.id), s.sendTest);
router.post('/test-razorpay', s.testRazorpay);
router.get('/templates', s.templates);
router.post('/templates/defaults', s.createDefaultTemplates);
module.exports = router;
