const router = require('express').Router();
const { protect, superAdminOnly } = require('../middleware/auth');
const { idParam } = require('../utils/http');
const s = require('../controllers/superAdminController');

router.use(protect, superAdminOnly);
router.param('id', idParam);

router.get('/dashboard', s.dashboard);

// Admin creation
router.post('/admins', s.createAdmin);
// Activation section: list, activate / deactivate
router.get('/admins', s.listAdmins);
router.get('/admins/:id', s.getAdmin);
router.put('/admins/:id', s.updateAdmin);
router.patch('/admins/:id/status', s.setStatus);       // { status: "ACTIVE" | "INACTIVE" }
router.patch('/admins/:id/type', s.setType);          // { adminType: "NORMAL" | "ECOMMERCE" }
router.post('/admins/:id/activate', s.activate);
router.post('/admins/:id/deactivate', s.deactivate);
router.put('/admins/:id/password', s.resetPassword);
router.delete('/admins/:id', s.deleteAdmin);
module.exports = router;
