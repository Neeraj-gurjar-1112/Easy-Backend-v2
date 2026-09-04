/**
 * Seller open/close realtime status (SSE) - same API as legacy services/sellerEvents.js.
 *   addClient(res)                        GET /api/seller/status-stream subscribers (all clients)
 *   broadcastSellerStatus(sellerId, bool) -> every subscriber + Socket.IO (via the event bus)
 */
const bus = require("./bus");

const { CHANNELS } = bus;

const clients = new Set();

function addClient(res) {
  clients.add(res);
  res.on("close", () => removeClient(res));
  res.on("error", () => removeClient(res));
}

function removeClient(res) {
  clients.delete(res);
}

function broadcastSellerStatus(sellerId, isOpen) {
  bus.publish(CHANNELS.SELLER_STATUS, {
    type: "seller_status",
    seller_id: sellerId.toString(),
    is_open: isOpen,
    timestamp: new Date().toISOString(),
  });
}

bus.subscribe(CHANNELS.SELLER_STATUS, (payload) => {
  if (clients.size === 0) return;
  const data = `event: seller_status\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of Array.from(clients)) {
    try {
      res.write(data);
    } catch (err) {
      console.error("SSE write error:", err);
      removeClient(res);
    }
  }
});

function getStats() {
  return { connectedClients: clients.size };
}

module.exports = { addClient, removeClient, broadcastSellerStatus, getStats };
