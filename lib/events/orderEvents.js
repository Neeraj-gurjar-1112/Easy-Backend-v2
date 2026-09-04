/**
 * Order realtime events (SSE) - same public API as the legacy services/orderEvents.js.
 *
 *   addClient(orderId, res)        customer order-tracking stream (GET /api/orders/:id/stream)
 *   addSellerClient(sellerId, res) seller order stream            (GET /api/seller/stream)
 *   addAdminClient(res)            admin firehose                 (GET /api/admin/stream)
 *   publish(orderId, payload)      -> order stream + admin stream + Socket.IO
 *   publishToSeller(sellerId, p)   -> seller stream + Socket.IO
 *   publishToAdmin(payload)        -> admin stream + Socket.IO
 *
 * Publishing goes through the event bus so it works across processes when Redis is configured.
 */
const bus = require("./bus");

const { CHANNELS } = bus;

const clients = new Map(); // orderId -> Set(res)
const sellerClients = new Map(); // sellerId -> Set(res)
const adminClients = new Set();

function sse(payload) {
  return `event: update\ndata: ${JSON.stringify(payload)}\n\n`;
}

function track(map, key, res) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(res);
  const cleanup = () => {
    const set = map.get(key);
    if (set) {
      set.delete(res);
      if (set.size === 0) map.delete(key);
    }
  };
  res.on("close", cleanup);
  res.on("error", cleanup);
}

function writeAll(set, data, onFail) {
  if (!set || set.size === 0) return;
  for (const res of Array.from(set)) {
    try {
      res.write(data);
    } catch (_) {
      onFail(res);
    }
  }
}

// ---- connection registration ------------------------------------------------
function addClient(orderId, res) {
  track(clients, String(orderId), res);
}
function addSellerClient(sellerId, res) {
  track(sellerClients, String(sellerId), res);
}
function addAdminClient(res) {
  adminClients.add(res);
  const cleanup = () => adminClients.delete(res);
  res.on("close", cleanup);
  res.on("error", cleanup);
}

// ---- local writers (called from bus subscriptions) --------------------------
function writeToOrder(orderId, payload) {
  const key = String(orderId);
  writeAll(clients.get(key), sse(payload), (res) => clients.get(key) && clients.get(key).delete(res));
}
function writeToSeller(sellerId, payload) {
  const key = String(sellerId);
  writeAll(sellerClients.get(key), sse(payload), (res) => sellerClients.get(key) && sellerClients.get(key).delete(res));
}
function writeToAdmin(payload) {
  writeAll(adminClients, sse(payload), (res) => adminClients.delete(res));
}

// ---- publishers (bus) -------------------------------------------------------
function publish(orderId, payload) {
  bus.publish(CHANNELS.ORDER_UPDATE, { orderId: String(orderId), payload });
}
function publishToSeller(sellerId, payload) {
  bus.publish(CHANNELS.SELLER_ORDER, { sellerId: String(sellerId), payload });
}
function publishToAdmin(payload) {
  bus.publish(CHANNELS.ADMIN_UPDATE, { payload });
}

bus.subscribe(CHANNELS.ORDER_UPDATE, ({ orderId, payload }) => {
  writeToOrder(orderId, payload);
  writeToAdmin(payload); // admins see every order update
});
bus.subscribe(CHANNELS.SELLER_ORDER, ({ sellerId, payload }) => writeToSeller(sellerId, payload));
bus.subscribe(CHANNELS.ADMIN_UPDATE, ({ payload }) => writeToAdmin(payload));

// ---- heartbeat --------------------------------------------------------------
function heartbeat() {
  for (const [key, set] of clients.entries()) writeAll(set, ":hb\n\n", (res) => clients.get(key) && clients.get(key).delete(res));
  for (const [key, set] of sellerClients.entries()) writeAll(set, ":hb\n\n", (res) => sellerClients.get(key) && sellerClients.get(key).delete(res));
  writeAll(adminClients, ":hb\n\n", (res) => adminClients.delete(res));
}
setInterval(heartbeat, 25000).unref();

function getStats() {
  let orderConnections = 0;
  for (const s of clients.values()) orderConnections += s.size;
  let sellerConnections = 0;
  for (const s of sellerClients.values()) sellerConnections += s.size;
  return {
    orders: clients.size,
    orderConnections,
    sellers: sellerClients.size,
    sellerConnections,
    admins: adminClients.size,
  };
}

module.exports = {
  addClient,
  publish,
  addSellerClient,
  publishToSeller,
  addAdminClient,
  publishToAdmin,
  getStats,
};
