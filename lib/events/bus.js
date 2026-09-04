/**
 * Realtime event bus.
 *
 * All realtime publishers (order updates, seller open/close, agent location)
 * go through here. Subscribers are the SSE managers (orderEvents, sellerEvents)
 * and the Socket.IO bridge (src/socket/bridge.js).
 *
 * Modes:
 *   - Redis pub/sub  when REDIS_URL / UPSTASH_REDIS_URL is set -> events reach
 *                    every process (app, admin, socket deployed separately).
 *   - In-memory      otherwise -> events only reach listeners in this process
 *                    (enough for `npm start`, which runs everything together).
 */
const EventEmitter = require("events");
const logger = require("@util/logger");

const PREFIX = "easy:";
const CHANNELS = Object.freeze({
  ORDER_UPDATE: "order.update", // { orderId, payload }
  SELLER_ORDER: "seller.order", // { sellerId, payload }
  ADMIN_UPDATE: "admin.update", // { payload }
  SELLER_STATUS: "seller.status", // { type:"seller_status", seller_id, is_open, timestamp }
  AGENT_LOCATION: "agent.location", // { agentId, lat, lng, orderIds, updated_at }
});

const local = new EventEmitter();
local.setMaxListeners(0);

let pub = null;
let sub = null;
let ready = false;
let initPromise = null;

function getRedisUrl() {
  return process.env.UPSTASH_REDIS_URL || process.env.REDIS_URL || null;
}

async function init() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const url = getRedisUrl();
    if (!url) {
      logger.info("Event bus: in-memory mode (set REDIS_URL for cross-process realtime)");
      return false;
    }
    try {
      const redis = require("redis");
      const isTls = url.includes("upstash.io");
      const make = () =>
        redis.createClient({
          url,
          socket: {
            ...(isTls ? { tls: true, rejectUnauthorized: false } : {}),
            connectTimeout: 10000,
            reconnectStrategy: (retries) => (retries > 10 ? new Error("Event bus: max reconnects") : Math.min(retries * 50, 1000)),
          },
        });
      pub = make();
      sub = make();
      for (const c of [pub, sub]) {
        c.on("error", (err) => {
          if (err && err.code !== "ECONNREFUSED") logger.warn("Event bus redis error:", err.message || err);
          ready = false;
        });
        c.on("ready", () => {
          ready = Boolean(pub && sub && pub.isReady && sub.isReady);
        });
      }
      await pub.connect();
      await sub.connect();
      await sub.pSubscribe(`${PREFIX}*`, (message, channel) => {
        try {
          local.emit(channel.slice(PREFIX.length), JSON.parse(message));
        } catch (err) {
          logger.warn("Event bus: dropped malformed message:", err.message);
        }
      });
      ready = true;
      logger.info("Event bus: Redis pub/sub enabled (cross-process realtime)");
      return true;
    } catch (err) {
      logger.warn(`Event bus: Redis unavailable, using in-memory mode (${err.message})`);
      ready = false;
      return false;
    }
  })();
  return initPromise;
}

function publish(channel, payload) {
  if (ready && pub) {
    pub.publish(PREFIX + channel, JSON.stringify(payload)).catch((err) => {
      logger.warn("Event bus publish failed, delivering locally:", err.message);
      local.emit(channel, payload);
    });
    return;
  }
  local.emit(channel, payload);
}

/** @returns {() => void} unsubscribe */
function subscribe(channel, handler) {
  local.on(channel, handler);
  return () => local.off(channel, handler);
}

function isDistributed() {
  return ready;
}

async function close() {
  try {
    if (sub) await sub.quit();
    if (pub) await pub.quit();
  } catch (_) {
    // ignore
  }
  pub = null;
  sub = null;
  ready = false;
  initPromise = null;
}

module.exports = { init, publish, subscribe, isDistributed, close, CHANNELS };
