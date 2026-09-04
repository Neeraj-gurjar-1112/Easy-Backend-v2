#!/usr/bin/env node
/**
 * Behavioural parity harness (legacy vs v2).
 *
 * Boots the OLD backend and this one against separate, identically seeded in-memory
 * databases, replays the same 174 requests against both and diffs status + normalised body.
 * Used to prove the restructure preserved behaviour; keep it for future big refactors.
 *
 *   LEGACY_DIR=<path to old backend> SCRATCH=<tmp dir> node scripts/parity-check.js
 *
 * Differences from v1: each app gets its OWN database, both seeded with the SAME
 * fixed ObjectIds, so mutating requests are compared fairly. Newly generated ids,
 * timestamps, JWTs and the port number are normalised before diffing.
 */
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");

const V2 = "d:/Easy-Backend-v2";
const LEGACY = process.env.LEGACY_DIR;
const SCRATCH = process.env.SCRATCH;
const JWT_SECRET = "parity-secret";
const ADMIN_API_KEY = "parity-admin-key";
const PORTS = { legacy: 19090, v2: 19091 };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- fixed ids so both databases are byte-identical after seeding ----
const ID = {
  seller: "aaaaaaaaaaaaaaaaaaaa0001",
  restaurant: "aaaaaaaaaaaaaaaaaaaa0002",
  product: "aaaaaaaaaaaaaaaaaaaa0003",
  foodItem: "aaaaaaaaaaaaaaaaaaaa0004",
  client: "aaaaaaaaaaaaaaaaaaaa0005",
  agent: "aaaaaaaaaaaaaaaaaaaa0006",
  admin: "aaaaaaaaaaaaaaaaaaaa0007",
  address: "aaaaaaaaaaaaaaaaaaaa0008",
  order: "aaaaaaaaaaaaaaaaaaaa0009",
  order2: "aaaaaaaaaaaaaaaaaaaa000a",
  settings: "aaaaaaaaaaaaaaaaaaaa000b",
  review: "aaaaaaaaaaaaaaaaaaaa000c",
  feedback: "aaaaaaaaaaaaaaaaaaaa000d",
  earning: "aaaaaaaaaaaaaaaaaaaa000e",
};
const KNOWN = new Set(Object.values(ID));

function bootScript(appPath) {
  return `
    const mongoose = require("mongoose");
    process.on("unhandledRejection", () => {});
    (async () => {
      await mongoose.connect(process.env.DB_CONNECTION_STRING);
      const app = require(${JSON.stringify(appPath)});
      app.listen(Number(process.env.PORT), () => console.log("READY"));
    })();
  `;
}

function start(label, cwd, appPath, port, uri) {
  const file = path.join(cwd, `__parity_boot_${label}.js`);
  fs.writeFileSync(file, bootScript(appPath));
  const child = spawn(process.execPath, [file], {
    cwd,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: "test",
      DB_CONNECTION_STRING: uri,
      JWT_SECRET,
      ADMIN_API_KEY,
      INTERNAL_API_KEY: "parity-internal",
      LOG_LEVEL: "error",
      ALLOWED_ORIGINS: "http://localhost:3000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  child.getOut = () => out;
  return child;
}

function req(port, method, p, { body, headers } = {}) {
  return new Promise((resolve) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const r = http.request(
      {
        host: "127.0.0.1",
        port,
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
        res.on("end", () => resolve({ status: res.statusCode, body: b }));
      }
    );
    r.on("error", (e) => resolve({ status: 0, body: "ERR " + e.message }));
    r.on("timeout", () => {
      r.destroy();
      resolve({ status: 0, body: "TIMEOUT" });
    });
    if (data) r.write(data);
    r.end();
  });
}

function normalise(s) {
  return String(s)
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "<ts>")
    .replace(/"(created_at|updated_at|last_seen|expires_at|payment_date|added_at|responded_at|assigned_at|response_at|cancelled_at|delivered_at|estimated_delivery_time|pickup_time|eta_at|acknowledged_at|escalated_at|delivery_start_time|delivery_end_time|dob)":\s*"?[^",}\]]*"?/g, '"$1":"<ts>"')
    .replace(/"(?:iat|exp|dateTime|timestamp|updated_at_ms)":\s*\d+/g, '"$&":<num>')
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "<jwt>")
    .replace(/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g, "<bcrypt>")
    .replace(/[0-9a-f]{24}/g, (m) => (KNOWN.has(m) ? m : "<newid>"))
    .replace(/1909\d{1}/g, "<port>")
    .replace(/"order_number":\s*"[^"]*"/g, '"order_number":"<rand>"')
    .replace(/ORD-\d+-\w+/g, "<ref>")
    .replace(/guest_G_\d+_\d+/g, "<guest>")
    .replace(/\d{13,}/g, "<epoch>");
}

async function seed(uri) {
  const mongoose = require(V2 + "/node_modules/mongoose");
  await mongoose.connect(uri);
  const M = require(V2 + "/lib/models");
  const oid = (h) => new mongoose.Types.ObjectId(h);
  const fixedDate = new Date("2026-01-01T00:00:00.000Z");

  await M.Seller.create({
    _id: oid(ID.seller), business_name: "Parity Grocery", email: "parity-seller@test.com", phone: "9990000001",
    business_type: "grocery", approved: true, is_open: true, address: "Bapu Bazaar, Udaipur",
    location: { lat: 24.5797, lng: 73.6907 }, password: "Seller@123", delivery_fee: 0, created_at: fixedDate,
  });
  await M.Seller.create({
    _id: oid(ID.restaurant), business_name: "Parity Restaurant", email: "parity-rest@test.com", phone: "9990000002",
    business_type: "restaurant", approved: true, is_open: true, address: "Fatehsagar, Udaipur",
    location: { lat: 24.59, lng: 73.68 }, cuisine: "Indian", created_at: fixedDate,
  });
  await M.Product.create({
    _id: oid(ID.product), seller_id: oid(ID.seller), name: "Parity Atta 5kg", category: "Grocery",
    sub_category: "Atta", price: 250, mrp: 300, stock: 20, status: "active", created_at: fixedDate,
  });
  await M.Product.create({
    _id: oid(ID.foodItem), seller_id: oid(ID.restaurant), name: "Parity Thali", category: "Restaurants",
    price: 180, stock: 100000, status: "active", created_at: fixedDate,
  });
  await M.Client.create({
    _id: oid(ID.client), name: "Parity Client", first_name: "Parity", phone: "+919990000003",
    otp_verified: true, profile_completed: true, created_at: fixedDate,
  });
  await M.DeliveryAgent.create({
    _id: oid(ID.agent), name: "Parity Agent", email: "parity-agent@test.com", phone: "9990000004",
    approved: true, active: true, available: true, vehicle_type: "bike",
    current_location: { lat: 24.58, lng: 73.69, updated_at: fixedDate }, password: "Agent@123", created_at: fixedDate,
  });
  await M.Admin.create({ _id: oid(ID.admin), email: "parity-admin@test.com", role: "superadmin", password: "Admin@123", created_at: fixedDate });
  await M.PlatformSettings.create({ _id: oid(ID.settings), updated_at: fixedDate });
  await M.UserAddress.create({
    _id: oid(ID.address), user_id: ID.client, label: "Home", full_address: "12 Parity Lane, Udaipur",
    street: "Parity Lane", city: "Udaipur", state: "Rajasthan", pincode: "313001",
    recipient_name: "Parity Client", recipient_phone: "9990000003", is_default: true,
    location: { lat: 24.577, lng: 73.691 }, created_at: fixedDate,
  });
  const deliveryAddress = {
    address_id: oid(ID.address), full_address: "12 Parity Lane, Udaipur", street: "Parity Lane",
    recipient_name: "Parity Client", recipient_phone: "9990000003", location: { lat: 24.577, lng: 73.691 },
  };
  await M.Order.create({
    _id: oid(ID.order), client_id: ID.client, seller_id: oid(ID.seller), status: "processing",
    order_items: [{ product_id: oid(ID.product), qty: 2, price_snapshot: 250, name_snapshot: "Parity Atta 5kg" }],
    payment: { amount: 500, method: "COD", status: "pending" },
    delivery: { delivery_status: "pending", delivery_charge: 30, delivery_address: deliveryAddress },
    created_at: fixedDate,
  });
  await M.Order.create({
    _id: oid(ID.order2), client_id: ID.client, seller_id: oid(ID.restaurant), status: "delivered",
    order_items: [{ product_id: oid(ID.foodItem), qty: 1, price_snapshot: 180, name_snapshot: "Parity Thali" }],
    payment: { amount: 180, method: "COD", status: "paid", payment_date: fixedDate },
    delivery: {
      delivery_status: "delivered", delivery_charge: 40, delivery_agent_id: oid(ID.agent),
      delivery_agent_response: "accepted", delivery_end_time: fixedDate, delivery_address: deliveryAddress,
    },
    created_at: fixedDate,
  });
  await M.Cart.create({
    user_id: ID.client,
    items: [{ product_id: ID.product, name: "Parity Atta 5kg", price: 250, qty: 1, seller_id: ID.seller }],
    updated_at: fixedDate,
  });
  await M.DeviceToken.create({ user_id: ID.client, token: "parity-device-token", platform: "android", last_seen: fixedDate });
  await M.Review.create({ _id: oid(ID.review), product_id: oid(ID.product), client_id: ID.client, rating: 5, comment: "Parity review", created_at: fixedDate });
  await M.Feedback.create({ _id: oid(ID.feedback), user_id: ID.client, message: "Parity feedback", type: "other", created_at: fixedDate });
  await M.EarningLog.create({
    _id: oid(ID.earning), role: "seller", order_id: oid(ID.order2), seller_id: oid(ID.restaurant),
    item_total: 180, platform_commission: 18, net_earning: 162, created_at: fixedDate,
  });
  await mongoose.disconnect();
}

(async () => {
  const { MongoMemoryServer } = require(V2 + "/node_modules/mongodb-memory-server");
  const mongod = await MongoMemoryServer.create();
  const base = mongod.getUri();
  const uriLegacy = mongod.getUri("parity_legacy");
  const uriV2 = mongod.getUri("parity_v2");
  void base;

  process.env.JWT_SECRET = JWT_SECRET;
  await seed(uriLegacy);
  await seed(uriV2);
  console.log("seeded both databases with identical fixed ids");

  const jwt = require(V2 + "/node_modules/jsonwebtoken");
  const clientJwt = jwt.sign({ id: ID.client, role: "client" }, JWT_SECRET);
  const adminJwt = jwt.sign({ id: ID.admin, role: "admin", email: "parity-admin@test.com" }, JWT_SECRET);
  const A = { "x-api-key": ADMIN_API_KEY };
  const CJ = { Authorization: `Bearer ${clientJwt}` };
  const AJ = { Authorization: `Bearer ${adminJwt}` };

  const { seller: S, restaurant: R, product: P, foodItem: F, client: C, agent: AG, order: O, order2: O2, address: AD, review: RV } = ID;

  const cases = [
    ["GET", "/api/app-version"],
    ["GET", "/api/products"],
    ["GET", "/api/products?q=Atta&category=Grocery&page=1&limit=5"],
    ["GET", `/api/products/${P}`],
    ["GET", "/api/products/not-an-id"],
    ["POST", "/api/products/prices", { body: { ids: [P, F] } }],
    ["POST", "/api/products/stock", { body: { items: [{ product_id: P, qty: 3 }, { product_id: F, qty: 50 }] } }],
    ["POST", "/api/products/quote", { body: { items: [{ product_id: P, qty: 1 }], client_id: C } }],
    ["POST", "/api/products/quote", { body: { items: [{ product_id: F, qty: 2 }], coupon_code: "NOPE" } }],
    ["POST", "/api/products/quote", { body: { items: [{ product_id: P, qty: 40 }] } }],
    ["GET", "/api/restaurants"],
    ["GET", "/api/restaurants?q=Parity"],
    ["GET", "/api/restaurant-manage/me", { headers: { "x-seller-id": R } }],
    ["PUT", "/api/restaurant-manage/me", { headers: { "x-seller-id": R }, body: { description: "Parity desc", cuisine: "Rajasthani" } }],
    ["GET", `/api/cart/${C}`],
    ["PUT", `/api/cart/${C}`, { body: { items: [{ product_id: P, name: "Parity Atta 5kg", price: 250, qty: 3, seller_id: S }] } }],
    ["GET", `/api/cart/${C}`],
    ["GET", `/api/users/${C}/addresses`],
    ["POST", `/api/users/${C}/addresses`, { body: { label: "Office", full_address: "9 Work Rd", street: "Work Rd", city: "Udaipur", state: "RJ", pincode: "313002" } }],
    ["GET", `/api/users/${C}/addresses`],
    ["PUT", `/api/users/${C}/addresses/${AD}`, { body: { label: "Home2", is_default: true } }],
    ["DELETE", `/api/users/${C}/addresses/${AD}`],
    ["GET", `/api/users/${C}/orders`],
    ["GET", `/api/users/${C}/orders?status=paid&page=1&limit=5`],
    ["POST", `/api/users/${C}/feedback`, { body: { message: "parity feedback two", type: "bug" } }],
    ["GET", "/api/auth/role-by-email?email=parity-seller@test.com"],
    ["GET", "/api/auth/role-by-email?email=parity-agent@test.com"],
    ["GET", "/api/auth/role-by-email?email=nobody@test.com"],
    ["POST", "/api/auth/role-by-email", { body: { email: "parity-admin@test.com", password: "Admin@123" } }],
    ["POST", "/api/auth/role-by-email", { body: { email: "parity-seller@test.com", password: "wrong" } }],
    ["POST", "/api/auth/login/seller", { body: { email: "parity-seller@test.com", password: "Seller@123" } }],
    ["POST", "/api/auth/login/seller", { body: { email: "parity-seller@test.com", password: "bad" } }],
    ["POST", "/api/auth/login/delivery-agent", { body: { email: "parity-agent@test.com", password: "Agent@123" } }],
    ["POST", "/api/auth/signup/client", { body: { name: "New Parity", phone: "+919990000099" } }],
    ["POST", "/api/auth/signup/seller", { body: { business_name: "No Token Store", email: "x@y.com", phone: "9990000077" } }],
    ["GET", "/api/auth/user/me", { headers: CJ }],
    ["GET", "/api/auth/user/me"],
    ["POST", "/api/auth/forgot-password", { body: { email: "nobody@test.com", role: "seller" } }],
    ["POST", "/api/auth/reset-password", { body: { token: "bogus", newPassword: "Abcdef1!" } }],
    ["POST", "/api/auth/logout", { body: { user_id: C } }],
    ["GET", "/api/auth/debug/verify-token"],
    ["POST", "/api/auth/otp/send", { body: { phone: "+919990000003", purpose: "client_login" } }],
    ["POST", "/api/auth/otp/send", { body: { phone: "bad", purpose: "client_login" } }],
    ["POST", "/api/auth/otp/verify", { body: { phone: "+919990000003", purpose: "client_login", code: "1234" } }],
    ["GET", "/api/clients/me", { headers: CJ }],
    ["GET", "/api/clients/me"],
    ["POST", "/api/clients/upsert", { headers: CJ, body: { first_name: "Parity", last_name: "Client", phone: "+919990000003" } }],
    ["POST", "/api/clients/complete-profile", { headers: CJ, body: { first_name: "Parity", phone: "+919990000003", dob: "1995-05-05" } }],
    ["PUT", "/api/clients/me", { headers: CJ, body: { name: "Parity Renamed" } }],
    ["GET", `/api/orders/${O}/status`],
    ["GET", `/api/orders/${O2}/status`],
    ["GET", `/api/orders/history/${C}`],
    ["GET", `/api/orders/${O}/admin-detail`],
    ["GET", `/api/orders/${O2}/admin-detail`],
    ["POST", "/api/orders", { body: { client_id: C, items: [{ product_id: P, quantity: 1 }], delivery_address_id: AD, payment_method: "cod" } }],
    ["POST", "/api/orders", { body: { client_id: C, items: [{ product_id: P, quantity: 1 }, { product_id: F, quantity: 2 }], delivery_address_id: AD } }],
    ["POST", "/api/orders", { body: { items: [] } }],
    ["PATCH", `/api/orders/${O}/delivery`, { body: { status: "dispatched", eta_minutes: 30 } }],
    ["POST", `/api/orders/${O}/verify`, { body: { status: "paid", verified_by: "parity" } }],
    ["POST", `/api/orders/${O}/cancel`, { body: { cancelled_by: "customer", cancellation_reason: "parity" } }],
    ["POST", `/api/orders/${O2}/cancel`, { body: { cancelled_by: "customer" } }],
    ["GET", `/api/reviews/product/${P}`],
    ["GET", "/api/reviews/user", { headers: CJ }],
    ["POST", "/api/reviews", { headers: CJ, body: { product_id: F, rating: 4, comment: "parity new review" } }],
    ["PUT", `/api/reviews/${RV}`, { headers: CJ, body: { rating: 3, comment: "edited" } }],
    ["POST", `/api/reviews/${RV}/helpful`, { headers: CJ }],
    ["DELETE", `/api/reviews/${RV}`, { headers: CJ }],
    ["POST", "/api/wishlist", { headers: CJ, body: { product_id: P } }],
    ["GET", "/api/wishlist", { headers: CJ }],
    ["GET", `/api/wishlist/check/${P}`, { headers: CJ }],
    ["DELETE", `/api/wishlist/${P}`, { headers: CJ }],
    ["POST", "/api/tokens/register", { body: { user_id: C, token: "parity-token-2", platform: "ios" } }],
    ["GET", `/api/seller/${S}/status`],
    ["GET", `/api/seller/products?sellerId=${S}`],
    ["POST", "/api/seller/products", { body: { seller_id: S, name: "Parity New Product", price: 99, mrp: 120, category: "Grocery" } }],
    ["GET", `/api/seller/orders?sellerId=${S}`],
    ["GET", `/api/seller/orders?sellerId=${S}&meta=1&page=1&pageSize=5`],
    ["GET", `/api/seller/orders/pending?sellerId=${S}`],
    ["GET", `/api/seller/orders/${O}?sellerId=${S}`],
    ["GET", `/api/seller/inventory?sellerId=${S}`],
    ["GET", `/api/seller/inventory?sellerId=${S}&lowStockOnly=true&threshold=50`],
    ["PUT", `/api/seller/inventory/${P}/stock`, { body: { seller_id: S, stock: 15 } }],
    ["POST", "/api/seller/inventory/bulk-update", { body: { seller_id: S, updates: [{ product_id: P, stock: 12 }] } }],
    ["GET", `/api/seller/analytics?sellerId=${S}&period=month`],
    ["GET", `/api/seller/analytics?sellerId=${S}&period=all`],
    ["GET", `/api/seller/products/reviews?sellerId=${S}`],
    ["POST", `/api/seller/reviews/${RV}/respond`, { body: { seller_id: S, message: "thanks" } }],
    ["GET", `/api/seller/${S}/earnings/summary`],
    ["GET", `/api/seller/${S}/earnings/logs`],
    ["GET", `/api/seller/${S}/feedback`],
    ["POST", `/api/seller/${S}/feedback`, { body: { message: "seller parity feedback" } }],
    ["POST", "/api/seller/check-delivery-availability", { body: { seller_id: S } }],
    ["POST", "/api/seller/toggle-open", { body: { seller_id: S, open: false } }],
    ["GET", `/api/seller/${S}/status`],
    ["POST", "/api/seller/orders/accept", { body: { seller_id: S, order_id: O } }],
    ["POST", "/api/seller/orders/reject", { body: { seller_id: S, order_id: O, reason: "parity reject" } }],
    ["GET", "/api/delivery/check-availability"],
    ["GET", `/api/delivery/profile/${AG}`],
    ["GET", `/api/delivery/pending-orders/${AG}`],
    ["GET", `/api/delivery/offers/${AG}`],
    ["GET", `/api/delivery/assigned-orders/${AG}`],
    ["GET", `/api/delivery/history/${AG}`],
    ["GET", `/api/delivery/${AG}/earnings/summary`],
    ["GET", `/api/delivery/${AG}/earnings/breakdown`],
    ["GET", `/api/delivery/${AG}/earnings/logs`],
    ["POST", "/api/delivery/update-location", { body: { agentId: AG, latitude: 24.581, longitude: 73.692 } }],
    ["POST", "/api/delivery/toggle-availability", { body: { agentId: AG, available: false } }],
    ["POST", "/api/delivery/toggle-availability", { body: { agentId: AG, available: true } }],
    ["POST", "/api/delivery/accept-order", { body: { orderId: O, agentId: AG } }],
    ["POST", "/api/delivery/update-status", { body: { orderId: O, agentId: AG, status: "picked_up" } }],
    ["POST", "/api/delivery/reject-order", { body: { orderId: O, agentId: AG } }],
    ["POST", "/api/delivery/check-timeouts"],
    ["POST", "/api/delivery/retry-pending-orders"],
    ["POST", `/api/delivery/${AG}/route/optimize`, { body: { order_ids: [O] } }],
    ["POST", "/api/delivery/logout", { body: { agentId: AG } }],
    ["POST", "/api/admin/login", { body: { email: "parity-admin@test.com", password: "Admin@123" } }],
    ["POST", "/api/admin/login", { body: { email: "parity-admin@test.com", password: "nope" } }],
    ["GET", "/api/admin/settings", { headers: A }],
    ["PUT", "/api/admin/settings", { headers: A, body: { delivery_charge_grocery: 35, low_stock_threshold: 7 } }],
    ["GET", "/api/admin/settings", { headers: A }],
    ["GET", "/api/admin/metrics", { headers: A }],
    ["GET", "/api/admin/reporting/overview", { headers: A }],
    ["GET", "/api/admin/orders", { headers: A }],
    ["GET", "/api/admin/orders?page=1&pageSize=5&paymentStatus=paid", { headers: A }],
    ["GET", "/api/admin/sellers", { headers: A }],
    ["GET", "/api/admin/sellers?pending=1", { headers: A }],
    ["GET", `/api/admin/sellers/${S}`, { headers: A }],
    ["GET", `/api/admin/sellers/${S}/test-pickup`, { headers: A }],
    ["PATCH", `/api/admin/sellers/${S}`, { headers: A, body: { admin_sort_order: 3 } }],
    ["PATCH", `/api/admin/sellers/${S}/approve`, { headers: A }],
    ["GET", "/api/admin/clients", { headers: A }],
    ["POST", "/api/admin/clients", { headers: A, body: { name: "Admin Made Client", phone: "+919990000088" } }],
    ["GET", "/api/admin/products", { headers: A }],
    ["GET", "/api/admin/product-categories", { headers: A }],
    ["POST", "/api/admin/products", { headers: A, body: { seller_id: S, name: "Admin Product", price: 55, category: "Grocery" } }],
    ["POST", `/api/admin/products/${P}/deactivate`, { headers: A }],
    ["POST", `/api/admin/products/${P}/activate`, { headers: A }],
    ["GET", "/api/admin/delivery-agents", { headers: A }],
    ["GET", "/api/admin/delivery-agents/pending", { headers: A }],
    ["GET", `/api/admin/delivery-agents/${AG}`, { headers: A }],
    ["PATCH", `/api/admin/delivery-agents/${AG}/approve`, { headers: A }],
    ["GET", "/api/admin/payouts", { headers: A }],
    ["GET", "/api/admin/payouts/summary", { headers: A }],
    ["GET", "/api/admin/payouts/logs", { headers: A }],
    ["GET", "/api/admin/earning-logs", { headers: A }],
    ["GET", "/api/admin/coupons", { headers: A }],
    ["POST", "/api/admin/coupons", { headers: A, body: { code: "PARITY10", percent: 10, minSubtotal: 100 } }],
    ["GET", "/api/admin/coupons", { headers: A }],
    ["GET", "/api/admin/coupons/PARITY10/usage", { headers: A }],
    ["PUT", "/api/admin/coupons/PARITY10", { headers: A, body: { percent: 15 } }],
    ["DELETE", "/api/admin/coupons/PARITY10", { headers: A }],
    ["GET", "/api/admin/roles", { headers: AJ }],
    ["POST", "/api/admin/roles", { headers: AJ, body: { email: "mod@parity.com", role: "moderator", password: "Mod@1234" } }],
    ["GET", "/api/admin/feedback", { headers: A }],
    ["POST", "/api/admin/feedback", { headers: A, body: { user_id: C, message: "admin parity feedback" } }],
    ["GET", "/api/admin/campaigns", { headers: A }],
    ["POST", "/api/admin/campaigns", { headers: A, body: { title: "Parity", message: "Hello", segment: "all" } }],
    ["GET", "/api/admin/alerts", { headers: A }],
    ["POST", "/api/admin/alerts/evaluate", { headers: A, body: {} }],
    ["GET", "/api/admin/fraud/signals", { headers: A }],
    ["GET", "/api/admin/device-tokens", { headers: A }],
    ["GET", `/api/admin/device-tokens?userId=${C}`, { headers: A }],
    ["GET", `/api/admin/device-tokens/by-client?uid=${C}`, { headers: A }],
    ["GET", "/api/admin/migrations/backfill-locations/preview-count", { headers: A }],
    ["GET", "/api/admin/migrations/backfill-locations/progress", { headers: A }],
    ["GET", `/api/admin/orders/${O2}/available-agents`, { headers: A }],
    ["POST", `/api/admin/orders/${O2}/assign-delivery-agent`, { headers: A, body: { agent_id: AG, force: true } }],
    ["PATCH", `/api/admin/orders/${O}/payment`, { headers: A, body: { status: "paid" } }],
    ["POST", `/api/admin/orders/${O}/cancel`, { headers: A, body: { reason: "admin parity" } }],
    ["GET", "/api/admin/settings"],
    ["GET", "/api/admin/ui/sellers"],
    ["GET", "/api/admin/nope", { headers: A }],
    ["GET", "/legal/privacy-policy"],
    ["GET", "/legal/delete-account"],
  ];

  const legacyChild = start("legacy", LEGACY, path.join(LEGACY, "app.js").replace(/\\/g, "/"), PORTS.legacy, uriLegacy);
  const v2Child = start("v2", V2, V2 + "/app.js", PORTS.v2, uriV2);

  for (const [label, child, port] of [["legacy", legacyChild, PORTS.legacy], ["v2", v2Child, PORTS.v2]]) {
    let up = false;
    for (let i = 0; i < 60 && !up; i++) {
      await wait(500);
      const r = await req(port, "GET", "/health");
      if (r.status === 200) up = true;
    }
    if (!up) {
      console.log(`### ${label} DID NOT BOOT:\n` + child.getOut().slice(-3000));
      process.exit(1);
    }
    console.log(`${label} app up on :${port}`);
  }

  const rows = [];
  for (const [method, p, opts] of cases) {
    const a = await req(PORTS.legacy, method, p, opts);
    const b = await req(PORTS.v2, method, p, opts);
    const na = normalise(a.body);
    const nb = normalise(b.body);
    rows.push({ method, p, legacy: a.status, v2: b.status, same: a.status === b.status && na === nb, na, nb });
  }

  const diffs = rows.filter((r) => !r.same);
  console.log(`\n=== PARITY: ${rows.length - diffs.length}/${rows.length} identical (status + normalised body) ===`);
  for (const d of diffs) {
    console.log(`\n--- DIFF ${d.method} ${d.p}`);
    console.log(`  legacy ${d.legacy}: ${d.na.slice(0, 400)}`);
    console.log(`  v2     ${d.v2}: ${d.nb.slice(0, 400)}`);
  }
  fs.writeFileSync(path.join(SCRATCH, "parity2-report.json"), JSON.stringify(rows, null, 1));

  legacyChild.kill();
  v2Child.kill();
  for (const f of [path.join(LEGACY, "__parity_boot_legacy.js"), path.join(V2, "__parity_boot_v2.js")]) {
    try {
      fs.unlinkSync(f);
    } catch (_) {
      /* ignore */
    }
  }
  await mongod.stop();
  process.exit(0);
})().catch((e) => {
  console.error("parity harness failed:", e);
  process.exit(1);
});
