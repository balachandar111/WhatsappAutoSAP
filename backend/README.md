# WhatsApp Automation SaaS — Backend (Part 1)

Multi-tenant Node/Express/MongoDB API.

| Role | What they can do |
|---|---|
| **Super Admin** | Create admins, activate / deactivate them (takes effect instantly), reset passwords, delete an admin with all their data |
| **Admin – NORMAL** | Setup, Chat Flows, Automations (chat-flow type), Form submissions, Conversations |
| **Admin – ECOMMERCE** | Everything NORMAL has **plus** Categories, Products, Branches, Orders, Bulk enquiries and the ordering-bot automation (incl. flow option hand-off to it) |

The Super Admin picks the type when creating an admin (`adminType` is required) and can change it any time with
`PATCH /api/superadmin/admins/:id/type {adminType}`. Downgrading to NORMAL locks the commerce modules (`403 ECOMMERCE_DISABLED`), switches the ordering bot off and keeps the data; upgrading restores it. `GET /api/auth/me` returns `adminType` + `features` so the UI can hide menus.

## The admin journey

1. **Setup** (`/api/setup`) – save WhatsApp credentials (access token, Phone Number ID, App Secret, WABA ID, optional Razorpay). Secrets are AES-256-GCM encrypted and never returned in full.
   Paste the shown **Webhook URL + Verify token** into Meta. Then **Test WhatsApp** (`POST /api/setup/test-whatsapp`).
2. A passed test **unlocks** `/api/chatflows` and `/api/automations` (they answer `412 SETUP_REQUIRED` before). Changing the token / phone number / app secret later requires a new test.
3. **Chat Flow** (`/api/chatflows`) – build with the same node model as your chatbot project: `message`, `products`, `form`, `steps`. Excel import/export included. Save validates; a valid flow becomes the *live* copy, an invalid one is kept as a draft (the last good version keeps running).
4. **Automation** (`/api/automations`) – "when this happens, run this": attach a saved chat flow (or the built-in ordering bot), choose keywords / default, switch it on. It is then live on the admin's number.
   `POST /api/automations/:id/simulate` previews the conversation without sending anything.

## Automation types
* `flow` – runs a saved chat flow over WhatsApp (buttons, lists, product cards with link buttons, step-by-step cards, forms with validation + conditional fields + file uploads → saved as *Form submissions*).
* `commerce` (ECOMMERCE admins only) – the wa-sweet ordering bot, now multi-tenant: categories → products/sizes → cart → delivery/pickup → nearest branch → Razorpay link → order tracking, outlets, bulk enquiries. One per admin.
* A flow option can have `handoff: "commerce"` to pass the chat to the ordering bot.

## Run

```bash
cp .env.example .env     # set MONGO_URI, JWT_SECRET, ENCRYPTION_KEY, SUPERADMIN_PASSWORD, PUBLIC_URL
npm install
npm start                # creates the Super Admin on first boot (or: npm run seed)
```
`PUBLIC_URL` must be your public HTTPS URL (domain / ngrok): Meta calls `PUBLIC_URL/webhook/<key>` and WhatsApp downloads uploaded images from `PUBLIC_URL/uploads/...`.
`ENCRYPTION_KEY` must never change after admins save credentials.

## Tests
```bash
TEST_MONGO_URI=mongodb://127.0.0.1:27017 npm test     # or omit it to use mongodb-memory-server
```
11 end-to-end tests with Meta/Razorpay mocked.

## API map (all JSON, `Authorization: Bearer <token>`)

**Auth** `POST /api/auth/login` · `GET /api/auth/me` · `PUT /api/auth/password`

**Super Admin** (`/api/superadmin`) `GET /dashboard` · `POST|GET /admins` · `GET|PUT|DELETE /admins/:id` · `PATCH /admins/:id/status {status}` · `POST /admins/:id/activate|deactivate` · `PUT /admins/:id/password`

**Admin** `GET /api/admin/dashboard` · `GET|PUT /api/admin/profile`

**Setup** `GET|PUT /api/setup` · `GET /status` · `POST /test-whatsapp|test-token|subscribe-app|send-test|test-razorpay` · `GET /templates` · `POST /templates/defaults`

**Chat flows** *(needs tested setup)* `GET|POST /api/chatflows` · `GET|PUT|DELETE /:id` · `PUT /:id/flow` · `POST /:id/validate|duplicate` · `GET /excel-template` · `GET /:id/export-excel` · `POST /:id/import-excel` · `POST /api/uploads/image`

**Automations** *(needs tested setup)* `GET|POST /api/automations` · `GET|PUT|DELETE /:id` · `PATCH /:id/status {active}` · `POST /:id/simulate`

**Commerce** *(ECOMMERCE admins only)* `/api/categories` · `/api/products` · `/api/branches` · `/api/orders` (+`/stats`, `PATCH /:id/status`, `/:id/rider`) · `/api/bulk`

**Results** `/api/submissions` (+`/export.csv`, `/:id/media/:mediaId`) · `/api/conversations`

**Public** `GET|POST /webhook/:key` (Meta) · `POST /razorpay-webhook/:key` · `GET /health`

## Notes
* Webhooks need the App Secret (signature check). `ALLOW_UNSIGNED_WEBHOOKS=true` is for local dev only.
* Owner alerts (new form / order) are plain WhatsApp messages: Meta only delivers them if the owner messaged the number in the last 24 h.
* Not ported from wa-sweet-mern: the public website OTP-login endpoints (not part of the admin product).
