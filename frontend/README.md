# WA Automate — Frontend

React 18 + Vite + React Router. No UI library (styles in `src/styles.css`). Talks to the Express backend in `../backend`.

```bash
npm install
npm run dev      # http://localhost:5173, proxies /api -> http://localhost:5000
npm run build    # static build in dist/ (vercel.json included for SPA routing)
```
Separate hosting: set `VITE_API_URL=https://backend.example.com/api` at build time and put the site origin in the backend's `CLIENT_ORIGIN`.

## Roles & menus
| Role | Sees |
|---|---|
| Super admin | Dashboard, Admins (create with type, edit, activate/deactivate, change type, reset password, delete), Change password |
| Admin · Normal | Dashboard, Setup, Chat flows, Automations, Form submissions, Conversations, Profile & password, Guide |
| Admin · Ecommerce | everything above + Orders, Categories, Products, Outlets, Bulk enquiries, Razorpay/delivery settings, ordering-bot automation, flow → ordering-bot hand-off |

Menus come from `user.features` (`/api/auth/me`), refreshed on every page load, so a type change by the Super Admin applies on the next reload.
Chat flows and Automations stay locked (backend answers `412 SETUP_REQUIRED`) until **Setup → Test WhatsApp** passes.

## Source map
```
src/api/client.js            fetch wrapper: JWT, error mapping, uploads, blob downloads
src/context/AuthContext.jsx  user, features, setup status (drives the locks)
src/components/              AppShell, ProtectedRoute (+RequireSetup/RequireEcommerce), AutomationModal, SimulatorModal
src/pages/superadmin/        SuperDashboard, Admins
src/pages/admin/             Dashboard Setup Automations Submissions Conversations Orders Categories Products Outlets Bulk Guide
src/pages/admin/flows/       FlowList, FlowBuilder (languages, Excel import/export), NodeEditors, FlowMap, WhatsAppPreview, flowUtils (model + validator mirroring the backend)
src/pages/Account.jsx        profile + change password
```
The server is the authority on flow validation: every save is re-checked and only a valid flow goes live; its messages are shown under the builder's checks.
