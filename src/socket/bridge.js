/**
 * Event bus -> Socket.IO fan-out. Whatever the SSE streams receive, sockets receive too.
 * A single emit with multiple rooms is used so a socket that is in several of the
 * target rooms (e.g. the customer who also subscribed to the order) gets the event once.
 */
const bus = require("@events/bus");

const { CHANNELS } = bus;

function bridgeBus(io) {
  bus.subscribe(CHANNELS.ORDER_UPDATE, ({ orderId, payload }) => {
    const rooms = [`order:${orderId}`, "role:admin"];
    const clientId = payload && payload.client_id;
    if (clientId) rooms.push(`user:${clientId}`);
    const agentId = payload && payload.delivery && payload.delivery.delivery_agent_id;
    if (agentId) rooms.push(`user:${agentId}`);
    io.to(rooms).emit("order:update", payload);
  });

  bus.subscribe(CHANNELS.SELLER_ORDER, ({ sellerId, payload }) => {
    io.to(`user:${sellerId}`).emit("order:update", payload);
  });

  bus.subscribe(CHANNELS.ADMIN_UPDATE, ({ payload }) => {
    io.to("role:admin").emit("order:update", payload);
  });

  bus.subscribe(CHANNELS.SELLER_STATUS, (payload) => {
    io.emit("seller:status", payload);
  });

  bus.subscribe(CHANNELS.AGENT_LOCATION, (payload) => {
    io.to("role:admin").emit("agent:location", payload);
  });
}

module.exports = { bridgeBus };
