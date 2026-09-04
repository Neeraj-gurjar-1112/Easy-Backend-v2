/**
 * Combined application (app + admin + socket HTTP routes in ONE express app).
 * Used by:
 *   - server.js  -> `npm start` single-process deploy (identical URL surface to the legacy backend)
 *   - tests      -> require("../app") with supertest
 * For separately deployed services see src/app, src/admin, src/socket.
 */
require("module-alias/register");
const { load } = require("@lib/config/env");
load("all");

const { initInfra } = require("@lib/bootstrap");
const { createApp } = require("@lib/http/createApp");

initInfra();

const app = createApp({
  name: "all",
  routers: [require("./src/app/routes"), require("./src/admin/routes"), require("./src/socket/routes")],
  authLimiter: true,
});

module.exports = app;
