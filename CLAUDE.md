# Easy Backend v2 - project guide

Hyperlocal grocery + food delivery backend (Flutter apps: client, seller, delivery agent; admin panel).
Node 20+, Express 4, Mongoose 8, MongoDB Atlas, Socket.IO 4, optional Redis, FCM push, Message Central OTP.
Deployed on Google Cloud Run (asia-south1). Payment is **COD only**.

## Layout (Truckier-style: shared `lib/`, one folder per service in `src/`)

```
lib/                      shared by every service - import via aliases
  models/                 @models    -> lib/models/index.js  (one schema per file in schema/)
  util/                   @util      logger, geocode, pricing, sentry, upi (no-op)
  middleware/             @middleware auth (JWT), cache (Redis), cdn, couponValidation, imageOptimization, pagination, validation (Joi)
  events/                 @events    bus (Redis pub/sub or in-memory), orderEvents (SSE), sellerEvents (SSE)
  push/                   @push      FCM sender (index.js) + firebaseAdmin.js bootstrap
  sms/                    @sms       messageCentral.js (OTP)
  orders/                 @lib/orders snapshot.js (buildSnapshot, buildEnrichedSnapshot), handlers.js (verifyPayment, updateDelivery), assignment.js
  http/                   createApp() express factory, response helpers (res.success / res.badRequest / ...)
  config/env.js           loads .env then .env.<service>
  db/mongoose.js          connect with retry
  bootstrap.js            initInfra() / start()
src/
  app/                    mobile-app API  -> /api/* and /legal          (port 8080)
    routes/<module>/      XxxRoutes.js + XxxController.js [+ XxxValidations.js] + index.js
    routes/index.js       ordered mount table (public prefixes live HERE, not inside modules)
    cron.js               5-min delivery timeout/retry loop + daily GCS backup
  admin/                  admin API       -> /api/admin/*               (port 8081)
    routes/<module>/      same convention; every module router is mounted at the /api/admin root
    util/                 auth.js (requireAdmin), middleware.js (adminLimiter, logRequest), helpers.js
  socket/                 Socket.IO + internal emit API                 (port 8082)
app.js                    combined express app (app + admin + socket routes) - used by tests and server.js
server.js                 `npm start`: everything in one process on PORT (drop-in for the legacy deploy)
scripts/                  ops scripts (seed, backups, backfills). Each starts with require("module-alias/register")
tests/                    Jest + supertest + mongodb-memory-server. require("../app") gives the combined app
```

## Conventions

- **Aliases**: `@models`, `@util/x`, `@middleware/x`, `@events/x`, `@push`, `@sms/x`, `@lib/x`, `@root/x`.
  Defined in package.json `_moduleAliases` and mirrored in jest.config.js `moduleNameMapper`.
  Every entry point / script calls `require("module-alias/register")` first. Never use `../../lib/...` from src.
- **Module folder** = one feature: `FooRoutes.js` (express.Router, paths relative to the module mount),
  `FooController.js` (class instance or plain object of `async (req, res, next)` handlers, no routing, no `this`),
  optional `FooValidations.js` (Joi schemas), `index.js` = `module.exports = require("./FooRoutes")`.
  Helpers used by several modules of the same service go in `src/<service>/util/`; helpers used across
  services go in `lib/`.
- **Public URL surface is frozen** - the Flutter apps depend on it. New endpoints are fine; renaming or
  moving existing ones is not. Mount prefixes are only declared in `src/<service>/routes/index.js`.
- **Auth**: custom JWT (`Authorization: Bearer`). Roles in the token: `client`, `seller`, `admin`,
  `delivery_agent`. Client login is OTP-only (Message Central); other roles email + bcrypt password.
  Admin uses `src/admin/util/auth.js` `requireAdmin` (JWT role admin, `x-api-key` = ADMIN_API_KEY, or the
  legacy `x-admin: 1` dev header - remove that before hardening).
- **Realtime**: publish ONLY via `@events/orderEvents` / `@events/sellerEvents` (they use `@events/bus`).
  SSE endpoints stay where they are; Socket.IO mirrors every event (`order:update`, `seller:status`,
  `agent:location`). Set REDIS_URL when app/admin/socket run as separate processes, otherwise events
  stay inside one process.
- **Push**: `notifyOrderUpdate(order, snapshot, { excludeRoles, isAdminAction, isPaymentUpdate })` from `@push`.
- **Money**: amounts are INR numbers rounded to 2 dp; `payment.amount` = item subtotal only,
  `delivery.delivery_charge` and `applied_discount_amount` are stored separately.
- **Responses**: legacy handlers use `res.json(...)` with ad-hoc shapes; keep them unchanged. New handlers
  should use `res.success(data, message)` / `res.badRequest(...)` from lib/http/response.js.
- Logging: `const logger = require("@util/logger")` (winston). No bare console.log in new code.

## Run

```
cp .env.example .env            # fill DB_CONNECTION_STRING, JWT_SECRET, ADMIN_API_KEY, MESSAGE_CENTRAL_*
npm install
npm run dev                     # everything on :8080 (API + admin + socket), nodemon
npm run dev:split               # app :8080, admin :8081, socket :8082 as separate processes
npm test                        # jest (uses mongodb-memory-server, no real DB needed)
```
Docker: one image; `SERVICE=all|app|admin|socket` picks what the container runs.

## Legacy mapping (from the old single-folder backend)

| old                                | new                                                                 |
|------------------------------------|---------------------------------------------------------------------|
| app.js                             | lib/http/createApp.js + lib/bootstrap.js + app.js + server.js       |
| models/models.js                   | lib/models/schema/*.js + lib/models/index.js                        |
| config/logger.js                   | lib/util/logger.js                                                  |
| services/push.js                   | lib/push/index.js                                                   |
| services/messageCentral.js         | lib/sms/messageCentral.js                                           |
| services/orderEvents.js            | lib/events/orderEvents.js (now bus-backed)                          |
| services/sellerEvents.js           | lib/events/sellerEvents.js (now bus-backed)                         |
| services/geocode.js, pricing.js    | lib/util/                                                           |
| middleware/*                       | lib/middleware/*                                                    |
| controllers/ordersController.js    | lib/orders/* (shared) + src/app/routes/orders/OrdersController.js   |
| controllers/clientsController.js   | src/app/routes/clients/ClientsController.js                         |
| routes/<name>.js                   | src/app/routes/<name>/                                              |
| routes/admin.js                    | src/admin/routes/<module>/ (17 modules)                             |
