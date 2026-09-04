/**
 * Internal HTTP API of the socket service.
 *   POST /api/socket/emit  { channel, payload }   header x-internal-key: INTERNAL_API_KEY
 *   GET  /api/socket/stats                        header x-internal-key
 * Other services normally publish through @events/bus (Redis); this endpoint is the
 * fallback / manual trigger when Redis is not configured.
 */
const express = require("express");
const bus = require("@events/bus");
const orderEvents = require("@events/orderEvents");
const sellerEvents = require("@events/sellerEvents");
const { getIO } = require("./io");

const router = express.Router();

function requireInternalKey(req, res, next) {
  const key = req.headers["x-internal-key"];
  if (!process.env.INTERNAL_API_KEY || key !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ success: false, message: "internal key required" });
  }
  return next();
}

router.post("/api/socket/emit", requireInternalKey, (req, res) => {
  const { channel, payload } = req.body || {};
  if (!channel || !Object.values(bus.CHANNELS).includes(channel)) {
    return res.status(400).json({ success: false, message: "unknown channel", channels: Object.values(bus.CHANNELS) });
  }
  bus.publish(channel, payload === undefined ? {} : payload);
  return res.json({ success: true });
});

router.get("/api/socket/stats", requireInternalKey, (req, res) => {
  const io = getIO();
  res.json({
    success: true,
    eventBus: bus.isDistributed() ? "redis" : "memory",
    sockets: io ? io.engine.clientsCount : 0,
    sse: { ...orderEvents.getStats(), sellerStatus: sellerEvents.getStats().connectedClients },
  });
});

module.exports = router;
