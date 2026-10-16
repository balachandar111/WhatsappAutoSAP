const express = require('express');
const multer = require('multer');
const { protect, adminOnly } = require('../middleware/auth');
const requireSetup = require('../middleware/setupGate');
const { requireEcommerce } = require('../middleware/features');
const { idParam } = require('../utils/http');
const chatflow = require('../controllers/chatflowController');
const automation = require('../controllers/automationController');
const commerce = require('../controllers/commerceController');
const sub = require('../controllers/submissionController');
const upload = require('../controllers/uploadController');

const guard = [protect, adminOnly];
const withId = (r) => { r.param('id', idParam); return r; };

/* ---- Chat flows (locked until Setup is saved + tested) ---- */
const xls = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 }, fileFilter: (_q, f, cb) => (/\.(xlsx|xls)$/i.test(f.originalname) ? cb(null, true) : cb(Object.assign(new Error('Only .xlsx or .xls files are allowed'), { isUpload: true }))) }).single('file');
const chatflows = withId(express.Router());
chatflows.use(...guard, requireSetup);
chatflows.get('/', chatflow.list);
chatflows.post('/', chatflow.create);
chatflows.get('/excel-template', chatflow.template);
chatflows.get('/:id', chatflow.get);
chatflows.put('/:id', chatflow.update);
chatflows.put('/:id/flow', chatflow.saveFlow);
chatflows.post('/:id/validate', chatflow.validate);
chatflows.post('/:id/duplicate', chatflow.duplicate);
chatflows.get('/:id/export-excel', chatflow.exportExcel);
chatflows.post('/:id/import-excel', (req, res, next) => xls(req, res, (e) => (e ? next(Object.assign(e, { isUpload: true })) : next())), chatflow.importExcel);
chatflows.delete('/:id', chatflow.remove);

/* ---- Automations (locked until Setup is saved + tested) ---- */
const automations = withId(express.Router());
automations.use(...guard, requireSetup);
automations.get('/', automation.list);
automations.post('/', automation.create);
automations.get('/:id', automation.get);
automations.put('/:id', automation.update);
automations.patch('/:id/status', automation.setStatus);
automations.post('/:id/simulate', automation.simulate);
automations.delete('/:id', automation.remove);

/* ---- Commerce modules ---- */
const categories = withId(express.Router());
categories.use(...guard, requireEcommerce);
categories.get('/', commerce.listCategories);
categories.post('/', commerce.createCategory);
categories.put('/:id', commerce.updateCategory);
categories.delete('/:id', commerce.deleteCategory);

const products = withId(express.Router());
products.use(...guard, requireEcommerce);
products.get('/', commerce.listProducts);
products.post('/', commerce.createProduct);
products.put('/:id', commerce.updateProduct);
products.delete('/:id', commerce.deleteProduct);

const branches = withId(express.Router());
branches.use(...guard, requireEcommerce);
branches.get('/', commerce.listBranches);
branches.post('/', commerce.createBranch);
branches.put('/:id', commerce.updateBranch);
branches.delete('/:id', commerce.deleteBranch);

const orders = withId(express.Router());
orders.use(...guard, requireEcommerce);
orders.get('/stats', commerce.orderStats);
orders.get('/', commerce.listOrders);
orders.get('/:id', commerce.getOrder);
orders.patch('/:id/status', commerce.setOrderStatus);
orders.patch('/:id/rider', commerce.setRider);

const bulk = withId(express.Router());
bulk.use(...guard, requireEcommerce);
bulk.get('/', commerce.listBulk);
bulk.patch('/:id', commerce.updateBulk);

/* ---- Flow form answers, conversations, uploads ---- */
const submissions = withId(express.Router());
submissions.use(...guard);
submissions.get('/', sub.list);
submissions.get('/export.csv', sub.exportCsv);
submissions.get('/:id', sub.get);
submissions.get('/:id/media/:mediaId', sub.media);
submissions.patch('/:id', sub.update);
submissions.delete('/:id', sub.remove);

const conversations = express.Router();
conversations.use(...guard);
conversations.get('/', sub.conversations);

const uploads = express.Router();
uploads.use(...guard);
uploads.post('/image', upload.image);

module.exports = { chatflows, automations, categories, products, branches, orders, bulk, submissions, conversations, uploads };
