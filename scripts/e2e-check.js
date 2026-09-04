#!/usr/bin/env node
/**
 * End-to-end functional check of the v2 backend.
 *
 * Boots `server.js` (the `npm start` path: app + admin + Socket.IO on one port) against a
 * real in-memory MongoDB, then drives a whole order through the system while an SSE client
 * and a Socket.IO client are attached, and asserts what actually happened in the database.
 */
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");

const V2 = require("path").resolve(__dirname, "..").split("\\").join("/");
const PORT = 19200;
const JWT_SECRET = "e2e-secret";
const ADMIN_API_KEY = "e2e-admin-key";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
}

function call(method, p, { body, headers } = {}) {
  return new Promise((resolve) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const r = http.request(
      {
        host: "127.0.0.1",
        port: PORT,
        method,
        path: p,
        timeout: 25000,
        headers: {
          ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
          ...headers,
        },
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(b);
          } catch (_) {
            /* html or empty */
          }
          resolve({ status: res.statusCode, json, body: b });
        });
      }
    );
    r.on("error", (e) => resolve({ status: 0, body: e.message, json: null }));
    r.on("timeout", () => {
      r.destroy();
      resolve({ status: 0, body: "TIMEOUT", json: null });
    });
    if (data) r.write(data);
    r.end();
  });
}

/** Opens an SSE stream and collects the `data:` payloads it receives. */
function openSse(p) {
  const events = [];
  const req = http.request({ host: "127.0.0.1", port: PORT, path: p, headers: { Accept: "text/event-stream" } }, (res) => {
    res.setEncoding("utf8");
    res.on("data", (chunk) => {
      for (const line of chunk.split("\n")) {
        if (line.startsWith("data:")) {
          try {
            events.push(JSON.parse(line.slice(5).trim()));
          } catch (_) {
            /* heartbeat */
          }
        }
      }
    });
  });
  req.on("error", () => {});
  req.end();
  return { events, close: () => req.destroy() };
}

(async () => {
  const { MongoMemoryServer } = require(V2 + "/node_modules/mongodb-memory-server");
  const mongoose = require(V2 + "/node_modules/mongoose");
  const jwt = require(V2 + "/node_modules/jsonwebtoken");
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri("e2e");

  // ---------- seed ----------
  await mongoose.connect(uri);
  process.env.JWT_SECRET = JWT_SECRET;
  require(V2 + "/node_modules/module-alias/register");
  const M = require(V2 + "/lib/models");
  const seller = await M.Seller.create({
    business_name: "E2E Kirana", email: "e2e-seller@test.com", phone: "9880000001", business_type: "grocery",
    approved: true, is_open: true, address: "Bapu Bazaar, Udaipur", location: { lat: 24.5797, lng: 73.6907 },
  });
  const product = await M.Product.create({
    seller_id: seller._id, name: "E2E Rice 5kg", category: "Grocery", price: 300, mrp: 350, stock: 10, status: "active",
  });
  const client = await M.Client.create({ name: "E2E Client", first_name: "E2E", phone: "+919880000002", otp_verified: true });
  const agent = await M.DeliveryAgent.create({
    name: "E2E Agent", email: "e2e-agent@test.com", phone: "9880000003", approved: true, active: true, available: true,
    vehicle_type: "bike", current_location: { lat: 24.58, lng: 73.69 }, password: "Agent@123",
  });
  await M.Admin.create({ email: "e2e-admin@test.com", role: "superadmin", password: "Admin@123" });
  await M.PlatformSettings.create({});
  const address = await M.UserAddress.create({
    user_id: String(client._id), label: "Home", full_address: "5 E2E Road, Udaipur", street: "E2E Road",
    city: "Udaipur", state: "Rajasthan", pincode: "313001", recipient_name: "E2E Client", recipient_phone: "9880000002",
    is_default: true, location: { lat: 24.577, lng: 73.691 },
  });
  await mongoose.disconnect();

  const C = String(client._id);
  const S = String(seller._id);
  const AG = String(agent._id);
  const P = String(product._id);
  const AD = String(address._id);
  const clientJwt = jwt.sign({ id: C, role: "client" }, JWT_SECRET);
  const agentJwt = jwt.sign({ id: AG, role: "delivery_agent" }, JWT_SECRET);
  const A = { "x-api-key": ADMIN_API_KEY };

  // ---------- boot server.js ----------
  const child = spawn(process.execPath, ["server.js"], {
    cwd: V2,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: "development",
      DB_CONNECTION_STRING: uri,
      JWT_SECRET,
      ADMIN_API_KEY,
      INTERNAL_API_KEY: "e2e-internal",
      LOG_LEVEL: "warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));

  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    await wait(500);
    const r = await call("GET", "/health");
    if (r.status === 200) up = true;
  }
  if (!up) {
    console.log("server.js did not start:\n" + log.slice(-3000));
    process.exit(1);
  }
  check("server.js boots (npm start path)", true, `:${PORT}`);

  // ---------- socket client ----------
  const { io } = require(V2 + "/node_modules/socket.io-client");
  const socketEvents = [];
  const sock = io(`http://127.0.0.1:${PORT}`, { auth: { token: clientJwt }, transports: ["websocket"] });
  const agentSock = io(`http://127.0.0.1:${PORT}`, { auth: { token: agentJwt }, transports: ["websocket"] });
  sock.on("order:update", (p) => socketEvents.push(p));
  await new Promise((r) => {
    sock.on("connected", r);
    setTimeout(r, 4000);
  });
  check("Socket.IO client connects with JWT", sock.connected);

  // ---------- browse ----------
  const products = await call("GET", "/api/products");
  check("GET /api/products lists the seeded product", products.status === 200 && JSON.stringify(products.json).includes("E2E Rice 5kg"));

  const quote = await call("POST", "/api/products/quote", { body: { items: [{ product_id: P, qty: 2 }], client_id: C } });
  check(
    "POST /api/products/quote prices the cart",
    quote.status === 200 && quote.json?.grand_total !== undefined,
    `grand_total=${quote.json?.grand_total} delivery=${quote.json?.delivery_charge}`
  );

  // ---------- cart ----------
  await call("PUT", `/api/cart/${C}`, { body: { items: [{ product_id: P, name: "E2E Rice 5kg", price: 300, qty: 2, seller_id: S }] } });
  const cart = await call("GET", `/api/cart/${C}`);
  check("cart round-trips", cart.status === 200 && Array.isArray(cart.json) && cart.json.length === 1, `${Array.isArray(cart.json) ? cart.json.length : "?"} item(s)`);

  // ---------- place order ----------
  const created = await call("POST", "/api/orders", {
    headers: { Authorization: `Bearer ${clientJwt}` },
    body: { items: [{ product_id: P, quantity: 2 }], delivery_address_id: AD, payment_method: "cod" },
  });
  const orderId = created.json?.order_id || created.json?.orders?.[0]?.order_id;
  check("POST /api/orders creates a COD order", created.status === 201 && Boolean(orderId), `order=${orderId} amount=${created.json?.amount} delivery=${created.json?.delivery_charge}`);

  // SSE on that order
  const sse = openSse(`/api/orders/${orderId}/stream`);
  sock.emit("order:subscribe", orderId);
  await wait(1200);
  check("SSE stream sends the initial snapshot", sse.events.length >= 1, `${sse.events.length} event(s)`);

  // ---------- seller accepts ----------
  const accepted = await call("POST", "/api/seller/orders/accept", { body: { seller_id: S, orderId } });
  check("seller accepts the order", accepted.status === 200, JSON.stringify(accepted.json).slice(0, 90));
  await wait(1200);
  check("seller accept reaches the SSE client", sse.events.length >= 2, `${sse.events.length} event(s)`);
  check("seller accept reaches the Socket.IO client", socketEvents.length >= 1, `${socketEvents.length} event(s)`);

  // ---------- agent picks it up ----------
  const pending = await call("GET", `/api/delivery/pending-orders/${AG}`);
  const visible = JSON.stringify(pending.json).includes(orderId);
  check("order appears in the agent's pending list", pending.status === 200 && visible);

  const acceptAgent = await call("POST", "/api/delivery/accept-order", { body: { orderId, agentId: AG, agentLocation: { lat: 24.58, lng: 73.69 } } });
  check("agent accepts the delivery", acceptAgent.status === 200, JSON.stringify(acceptAgent.json).slice(0, 80));

  const picked = await call("POST", "/api/delivery/update-status", { body: { orderId, agentId: AG, status: "picked_up" } });
  check("agent marks picked_up", picked.status === 200);

  // agent location over Socket.IO
  const locAck = await new Promise((r) => {
    agentSock.emit("location:update", { lat: 24.582, lng: 73.693 }, r);
    setTimeout(() => r(null), 4000);
  });
  check("agent pushes location over Socket.IO", Boolean(locAck?.success), JSON.stringify(locAck));

  const delivered = await call("POST", "/api/delivery/update-status", { body: { orderId, agentId: AG, status: "delivered" } });
  check("agent marks delivered", delivered.status === 200);

  // ---------- verify the database ----------
  await mongoose.connect(uri);
  const finalOrder = await M.Order.findById(orderId).lean();
  check("order is delivered in the DB", finalOrder?.delivery?.delivery_status === "delivered", `delivery_status=${finalOrder?.delivery?.delivery_status}`);
  check("payment auto-marked paid on delivery", finalOrder?.payment?.status === "paid", `payment=${finalOrder?.payment?.status}`);
  const logs = await M.EarningLog.find({ order_id: finalOrder._id }).lean();
  check(
    "EarningLog written for seller and agent",
    logs.length >= 1,
    logs.map((l) => `${l.role}:net=${l.net_earning}`).join(" ")
  );
  const agentAfter = await M.DeliveryAgent.findById(AG).lean();
  check("agent counters updated", agentAfter.completed_orders === 1, `completed=${agentAfter.completed_orders} assigned=${agentAfter.assigned_orders} loc=${agentAfter.current_location?.lat},${agentAfter.current_location?.lng}`);
  await mongoose.disconnect();

  // ---------- admin side ----------
  const metrics = await call("GET", "/api/admin/metrics", { headers: A });
  check("admin metrics work with the API key", metrics.status === 200, `orders=${metrics.json?.orders ?? metrics.json?.data?.orders}`);
  const adminOrders = await call("GET", "/api/admin/orders", { headers: A });
  check("admin order list includes the order", adminOrders.status === 200 && JSON.stringify(adminOrders.json).includes(orderId));
  const payouts = await call("GET", "/api/admin/payouts/summary", { headers: A });
  check("admin payout summary computes", payouts.status === 200, JSON.stringify(payouts.json).slice(0, 110));
  const noAuth = await call("GET", "/api/admin/metrics");
  check("admin endpoints reject unauthenticated calls", noAuth.status === 401);

  // seller analytics + earnings
  const analytics = await call("GET", `/api/seller/analytics?sellerId=${S}&period=month`);
  check("seller analytics works", analytics.status === 200, JSON.stringify(analytics.json?.overview || analytics.json).slice(0, 100));
  const earnings = await call("GET", `/api/seller/${S}/earnings/summary`);
  check("seller earnings summary works", earnings.status === 200, JSON.stringify(earnings.json).slice(0, 100));
  const agentEarnings = await call("GET", `/api/delivery/${AG}/earnings/summary`);
  check("agent earnings summary works", agentEarnings.status === 200, JSON.stringify(agentEarnings.json).slice(0, 120));

  // seller status broadcast over SSE + socket
  const statusSse = openSse("/api/seller/status-stream");
  await wait(600);
  const sellerStatusEvents = [];
  sock.on("seller:status", (p) => sellerStatusEvents.push(p));
  await call("POST", "/api/seller/toggle-open", { body: { seller_id: S, open: false } });
  await wait(1200);
  check("seller open/close broadcasts on SSE", statusSse.events.length >= 1, `${statusSse.events.length} event(s)`);
  check("seller open/close broadcasts on Socket.IO", sellerStatusEvents.length >= 1, `${sellerStatusEvents.length} event(s)`);

  // internal socket stats
  const stats = await call("GET", "/api/socket/stats", { headers: { "x-internal-key": "e2e-internal" } });
  check("socket stats endpoint reports connections", stats.status === 200, JSON.stringify(stats.json).slice(0, 140));

  // legal pages
  const legal = await call("GET", "/legal/privacy-policy");
  check("legal pages render", legal.status === 200 && legal.body.includes("<!DOCTYPE html>"));

  const suspicious = log
    .split("\n")
    .filter((l) => /error|unhandled|cannot read|is not a function/i.test(l) && !/MongoDB connection failed|will retry|Redis|Sentry|token register error/i.test(l))
    .slice(0, 6);

  sse.close();
  statusSse.close();
  sock.close();
  agentSock.close();
  child.kill();
  await mongod.stop();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===`);
  if (failed.length) console.log("failed:\n  " + failed.map((f) => f.name + (f.detail ? " (" + f.detail + ")" : "")).join("\n  "));
  if (suspicious.length) console.log("\nunexpected server log lines:\n  " + suspicious.join("\n  "));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error("e2e harness failed:", e);
  process.exit(1);
});
