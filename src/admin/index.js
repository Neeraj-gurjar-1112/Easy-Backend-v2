/**
 * ADMIN service - /api/admin/* for the admin panel.
 * Run alone:  npm run start:admin  (PORT default 8081)
 */
require("module-alias/register");
const { load } = require("@lib/config/env");
load("admin");

const { initInfra, start } = require("@lib/bootstrap");
const { createApp } = require("@lib/http/createApp");
const routes = require("./routes");

initInfra();
const app = createApp({ name: "admin", routers: [routes], authLimiter: false });

module.exports = app;

if (require.main === module) {
  start(app, { infra: false, name: "admin", port: Number(process.env.PORT || process.env.ADMIN_PORT || 8081) });
}
