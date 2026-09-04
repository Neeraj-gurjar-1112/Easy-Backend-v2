/**
 * Event bus -> Socket.IO fan-out. Whatever the SSE streams receive, sockets receive too.
 */
const bus = require("@events/bus");

const { CHANNELS } = bus;

function bridgeBus(io) {
  bus.subscribe(CHANNELS.ORDER_UPDATE, ({ orderId, payload }) => {
    io.to(`order:${orderId}`).emit("order:update", payload);
    io.to("role:admin").emit("order:update", payload);
    const clientId = payload && payload.client_id;
    if (clientId) io.to(`user:${clientId}`).emit("order:update", payload);
    const agentId = payload && payload.delivery && payload.delivery.delivery_agent_id;
    if (agentId) io.to(`user:${agentId}`).emit("order:update", payload);
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
