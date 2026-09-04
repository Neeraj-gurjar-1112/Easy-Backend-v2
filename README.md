# Easy Backend v2

Backend for the Easy App (grocery + food delivery). Three services share one `lib/`:

| service | prefix                     | default port | start                  |
|---------|----------------------------|--------------|------------------------|
| app     | `/api/*`, `/legal`         | 8080         | `npm run start:app`    |
| admin   | `/api/admin/*`             | 8081         | `npm run start:admin`  |
| socket  | Socket.IO, `/api/socket/*` | 8082         | `npm run start:socket` |
| all     | everything above           | 8080         | `npm start`            |

See [CLAUDE.md](CLAUDE.md) for the layout, conventions and the legacy-to-v2 mapping.

## Quick start

```bash
cp .env.example .env   # then edit
npm install
npm run dev            # single process, hot reload
npm test
```

## Realtime

- SSE streams (unchanged URLs): `GET /api/orders/:id/stream`, `GET /api/seller/stream`,
  `GET /api/seller/status-stream`, `GET /api/seller/analytics/stream`, `GET /api/admin/stream`.
- Socket.IO: connect with `io(BASE_URL, { auth: { token } })`, then `socket.emit("order:subscribe", orderId)`.
  Events: `order:update`, `seller:status`, `agent:location`. Delivery agents may push `location:update`.
- With `REDIS_URL` set, events cross process boundaries (needed when services are deployed separately).
