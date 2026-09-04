/**
 * Process bootstrap shared by every service:
 *   initInfra()  -> Sentry, Firebase Admin (FCM), Redis cache, realtime event bus
 *   listen()     -> bind HTTP server with EADDRINUSE fallback + LAN banner
 *   start()      -> initInfra + MongoDB connect + listen
 */
const os = require("os");
const http = require("http");
const logger = require("@util/logger");
const { initSentry } = require("@util/sentry");
const { initFirebaseAdmin } = require("@push/firebaseAdmin");
const { initRedis, isRedisAvailable } = require("@middleware/cache");
const bus = require("@events/bus");
const { connectWithRetry } = require("@lib/db/mongoose");

let infraDone = false;

function initInfra(opts = {}) {
  if (infraDone) return;
  infraDone = true;
  const { sentry = true, firebase = true, redis = true, eventBus = true } = opts;
  if (sentry) initSentry(logger);
  if (firebase) initFirebaseAdmin();
  if (redis) {
    initRedis()
      .then(() => {
        if (isRedisAvailable()) logger.info("Redis caching enabled");
        else logger.warn("Redis not available - caching disabled");
      })
      .catch((err) => logger.warn("Redis initialization failed - caching disabled:", err.message));
  }
  if (eventBus) bus.init().catch((err) => logger.warn("Event bus init failed:", err.message));
}

function lanAddress() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return null;
}

function listen(app, { port = Number(process.env.PORT || 8080), name = process.env.SERVICE_NAME || "server", server = null } = {}) {
  const httpServer = server || http.createServer(app);
  return new Promise((resolve) => {
    let current = port;
    const tryListen = () => {
      httpServer.once("error", (err) => {
        if (err && err.code === "EADDRINUSE") {
          const old = current;
          current += 1;
          logger.warn(`Port ${old} in use. Retrying on port ${current}...`);
          setTimeout(tryListen, 250);
        } else {
          logger.error("Failed to bind server:", err);
          process.exit(1);
        }
      });
      httpServer.listen(current, () => {
        const lan = lanAddress();
        logger.info(`[${name}] Server running`);
        logger.info(`   - Local:   http://localhost:${current}`);
        logger.info(lan ? `   - Network: http://${lan}:${current}` : "   - Network: (no active IPv4 adapter detected)");
        resolve({ server: httpServer, port: current });
      });
    };
    tryListen();
  });
}

/**
 * @param {import("express").Express} app
 * @param {{port?:number,name?:string,server?:http.Server,infra?:object|false,afterListen?:Function}} opts
 */
async function start(app, opts = {}) {
  if (opts.infra !== false) initInfra(opts.infra || {});
  connectWithRetry().catch((err) => logger.error("MongoDB background connection error:", err));
  const result = await listen(app, opts);
  if (typeof opts.afterListen === "function") {
    try {
      await opts.afterListen(result);
    } catch (err) {
      logger.error("afterListen hook failed:", err);
    }
  }
  return result;
}

module.exports = { initInfra, listen, start, connectMongo: connectWithRetry };
