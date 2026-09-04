/**
 * Per-connection Socket.IO handlers.
 * Rooms:  user:<id>  role:<role>  order:<orderId>
 * Events (client -> server):
 *   order:subscribe(orderId, ack)     join an order's live updates
 *   order:unsubscribe(orderId, ack)
 *   location:update({lat,lng}, ack)   delivery agents only - stores location and fans out to active orders
 * Events (server -> client): connected, order:update, seller:status, agent:location
 */
const mongoose = require("mongoose");
const logger = require("@util/logger");
const bus = require("@events/bus");

const { CHANNELS } = bus;
const ACTIVE_DELIVERY = ["assigned", "accepted", "picked_up", "in_transit"];
const AGENT_ROLES = new Set(["delivery_agent", "agent", "delivery"]);

const ack = (fn, payload) => typeof fn === "function" && fn(payload);

module.exports = function registerHandlers(io, socket) {
  const { id, role } = socket.user;
  socket.join(`user:${id}`);
  socket.join(`role:${role}`);
  logger.debug(`socket connected ${socket.id} user=${id} role=${role}`);
  socket.emit("connected", { id, role, socketId: socket.id });

  socket.on("order:subscribe", (orderId, cb) => {
    if (!mongoose.isValidObjectId(orderId)) return ack(cb, { success: false, message: "Invalid orderId" });
    socket.join(`order:${orderId}`);
    return ack(cb, { success: true, orderId: String(orderId) });
  });

  socket.on("order:unsubscribe", (orderId, cb) => {
    socket.leave(`order:${orderId}`);
    ack(cb, { success: true });
  });

  socket.on("location:update", async (data, cb) => {
    try {
      if (!AGENT_ROLES.has(role)) return ack(cb, { success: false, message: "Only delivery agents can send location" });
      const lat = Number(data?.lat ?? data?.latitude);
      const lng = Number(data?.lng ?? data?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return ack(cb, { success: false, message: "Invalid location" });

      const { DeliveryAgent, Order } = require("@models");
      const now = new Date();
      await DeliveryAgent.updateOne({ _id: id }, { $set: { current_location: { lat, lng, updated_at: now } } });
      const active = await Order.find({
        "delivery.delivery_agent_id": id,
        "delivery.delivery_status": { $in: ACTIVE_DELIVERY },
      })
        .select("_id")
        .lean();

      const orderIds = active.map((o) => String(o._id));
      for (const orderId of orderIds) {
        bus.publish(CHANNELS.ORDER_UPDATE, {
          orderId,
          payload: {
            order_id: orderId,
            agent_location: { lat, lng, updated_at: now.toISOString() },
            delivery: { agent: { location: { lat, lng } } },
          },
        });
      }
      bus.publish(CHANNELS.AGENT_LOCATION, { agentId: id, lat, lng, orderIds, updated_at: now.toISOString() });
      return ack(cb, { success: true, orders: orderIds.length });
    } catch (err) {
      logger.warn(`socket location:update failed: ${err.message}`);
      return ack(cb, { success: false, message: "Failed to update location" });
    }
  });

  socket.on("disconnect", (reason) => {
    logger.debug(`socket disconnected ${socket.id} user=${id} (${reason})`);
  });
};
