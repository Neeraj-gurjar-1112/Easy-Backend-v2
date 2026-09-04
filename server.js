/**
 * `npm start` - runs app + admin + Socket.IO together on one port (PORT, default 8080).
 * This is the drop-in replacement for the legacy single app.js deployment.
 */
const http = require("http");
const app = require("./app"); // registers module-alias, loads .env, runs initInfra()
const { start } = require("@lib/bootstrap");
const { attach } = require("./src/socket/io");
const { startCron } = require("./src/app/cron");

const server = http.createServer(app);
attach(server);

start(app, {
  server,
  infra: false,
  name: "all",
  port: Number(process.env.PORT || 8080),
  afterListen: ({ port }) => startCron({ port }),
});
