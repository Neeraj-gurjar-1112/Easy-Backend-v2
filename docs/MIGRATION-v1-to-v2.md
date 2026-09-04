# Migration: single-folder backend → v2 (app / admin / socket)

The old backend (`d:\Easy-Backend-backend`) was one Express app with 17 route files, two
controllers and a 1000-line `models.js`. v2 keeps **exactly the same public URL surface**
but organises the code the way the Truckier project does: one shared `lib/`, one folder per
service under `src/`, and one folder per feature inside each service.

The old folder is untouched and remains the backup. v2 is a git repository.

## What did NOT change

- **Every route.** 194 endpoints, same methods, same paths, same handlers.
  Verified mechanically: `node scripts/list-routes.js` on both trees produces identical output
  (v2 adds only `POST /api/socket/emit` and `GET /api/socket/stats`).
- **Every schema.** All 18 Mongoose models are identical field-for-field: paths, types,
  `required` / `unique` / `enum` options, indexes, pre-save hooks, instance methods and
  collection names.
- **All handler bodies.** Moved verbatim; only `require(...)` paths were rewritten to aliases.
- **The single-process deployment.** `npm start` serves everything on one port, exactly like
  the old `node app.js`.

## Where things moved

| old | new |
|---|---|
| `app.js` (middleware chain, boot, cron) | `lib/http/createApp.js` + `lib/bootstrap.js` + `app.js` + `server.js` + `src/app/cron.js` |
| `models/models.js` | `lib/models/schema/<Model>.js` (18 files) + `lib/models/index.js` |
| `config/logger.js` | `lib/util/logger.js` |
| `services/push.js` | `lib/push/index.js` |
| `services/messageCentral.js` | `lib/sms/messageCentral.js` |
| `services/orderEvents.js` | `lib/events/orderEvents.js` (now publishes through the event bus) |
| `services/sellerEvents.js` | `lib/events/sellerEvents.js` (same) |
| `services/geocode.js`, `services/pricing.js`, `services/upi.js` | `lib/util/` |
| `middleware/*` | `lib/middleware/*` |
| `controllers/ordersController.js` | `lib/orders/{snapshot,handlers,assignment}.js` + `src/app/routes/orders/OrdersController.js` |
| `controllers/clientsController.js` | `src/app/routes/clients/ClientsController.js` |
| `routes/<name>.js` | `src/app/routes/<name>/` (Routes + Controller + index) |
| `routes/admin.js` (3968 lines) | `src/admin/routes/<module>/` — 17 modules + `src/admin/util/` |
| `routes/seller.js` (2047 lines) | `src/app/routes/seller/` — 6 controllers + helpers |
| `routes/delivery.js` (2917 lines) | `src/app/routes/delivery/` — 5 controllers + helpers |
| `seed.js`, `check_admin.js`, `set_admin_password.js`, `approve_restaurants.js` | `scripts/` |
| `deploy*.sh`, `setup-secrets.sh` | `scripts/deploy/` |
| 40+ status/report markdown files at the root | `docs/legacy/` (only the useful ones) |
| test output `.txt` dumps, `backups/`, `coverage/` | not carried over (git-ignored) |

## New things

- **`src/socket/`** — a Socket.IO server. JWT handshake auth, rooms `user:<id>`,
  `role:<role>`, `order:<orderId>`; events `order:update`, `seller:status`, `agent:location`;
  delivery agents can push `location:update`. It mirrors every SSE event, so the existing
  SSE endpoints keep working unchanged for the current apps.
- **`lib/events/bus.js`** — one publish path for all realtime events. Uses Redis pub/sub when
  `REDIS_URL` / `UPSTASH_REDIS_URL` is set, otherwise an in-process emitter.
  **This matters when the services are deployed separately:** without Redis, an event published
  by the app service will not reach a socket/SSE client attached to the admin service.
- **Path aliases** (`@models`, `@util/x`, `@middleware/x`, `@events/x`, `@push`, `@sms/x`,
  `@lib/x`, `@root/x`) via `module-alias`, mirrored in `jest.config.js` for tests.
- **Response helpers** on `res` (`res.success`, `res.badRequest`, …) for new endpoints.
  Existing handlers still use `res.json` with their original shapes.
- **`scripts/list-routes.js`** — prints the route table of any app/router, so URL-surface
  changes are easy to diff.

## Running

```bash
cp .env.example .env      # DB_CONNECTION_STRING, JWT_SECRET, ADMIN_API_KEY, MESSAGE_CENTRAL_*
npm install
npm start                 # everything on PORT (default 8080) - same as the old deploy
npm run dev               # same, with nodemon
npm run dev:split         # app :8080, admin :8081, socket :8082 in three processes
```

Per-service env overrides go in `.env.app`, `.env.admin`, `.env.socket` (loaded after `.env`).

## Deploying

The Docker image is unchanged in spirit; pick the service with an env var:

```bash
gcloud run deploy easy-backend --image "$IMAGE" --set-env-vars "SERVICE=all,NODE_ENV=production"
```

`SERVICE` accepts `all` (default), `app`, `admin`, `socket`. Keeping `SERVICE=all` reproduces
the current single-service Cloud Run setup. To split later, deploy the same image three times
with different `SERVICE` values **and set `REDIS_URL`** so realtime events cross processes.

## Cron ownership

The 5-minute delivery timeout/retry loop and the 02:00 UTC GCS backup live in
`src/app/cron.js` and start only when the app service (or `server.js`) is the running process.
Do not enable them in more than one replica.
