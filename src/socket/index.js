/**
 * SOCKET service - Socket.IO realtime + small internal HTTP API.
 * Run alone:  npm run start:socket  (PORT default 8082)
 * Clients connect with: io(url, { auth: { token: "<jwt>" } })
 */
require("module-alias/register");
const { load } = require("@lib/config/env");
load("socket");

const http = require("http");
const { initInfra, start } = require("@lib/bootstrap");
const { createApp } = require("@lib/http/createApp");
const { attach } = require("./io");
const routes = require("./routes");

initInfra({ firebase: false });
const app = createApp({ name: "socket", routers: [routes], authLimiter: false });

module.exports = app;

if (require.main === module) {
  const server = http.createServer(app);
  attach(server);
  start(app, { server, infra: false, name: "socket", port: Number(process.env.PORT || process.env.SOCKET_PORT || 8082) });
}
