/**
 * APP service - everything the mobile apps talk to (client, seller, delivery agent).
 * Public prefixes: /api/* (except /api/admin) and /legal.
 * Run alone:  npm run start:app   (PORT default 8080)
 * Run all:    npm start           (server.js mounts this router next to admin + socket)
 */
require("module-alias/register");
const { load } = require("@lib/config/env");
load("app");

const { initInfra, start } = require("@lib/bootstrap");
const { createApp } = require("@lib/http/createApp");
const routes = require("./routes");

initInfra();
const app = createApp({ name: "app", routers: [routes], authLimiter: true });

module.exports = app;

if (require.main === module) {
  start(app, {
    infra: false,
    name: "app",
    port: Number(process.env.PORT || process.env.APP_PORT || 8080),
    afterListen: ({ port }) => require("./cron").startCron({ port }),
  });
}
