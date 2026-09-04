/**
 * Helpers shared by more than one admin module. Copied verbatim from legacy routes/admin.js.
 * Single-module helpers (backfillJob/_appendLog, _parseLatLngText) live in their controller.
 */
const https = require("https");
const {
  Admin,
  Client,
  Seller,
  Product,
  Order,
  DeviceToken,
  DeliveryAgent,
  EarningLog,
} = require("@models");

// Common filters used by backfill preview/start for detecting missing coordinates
const missingSeller = {
  $or: [
    { "location.lat": { $exists: false } },
    { "location.lng": { $exists: false } },
    { "location.lat": null },
    { "location.lng": null },
    { "location.lat": { $not: { $type: "number" } } },
    { "location.lng": { $not: { $type: "number" } } },
  ],
};
const missingAddr = {
  $or: [
    { "location.lat": { $exists: false } },
    { "location.lng": { $exists: false } },
    { "location.lat": null },
    { "location.lng": null },
    { "location.lat": { $not: { $type: "number" } } },
    { "location.lng": { $not: { $type: "number" } } },
  ],
};
const missingOrderAddr = {
  $or: [
    { "delivery.delivery_address.location.lat": { $exists: false } },
    { "delivery.delivery_address.location.lng": { $exists: false } },
    { "delivery.delivery_address.location.lat": null },
    { "delivery.delivery_address.location.lng": null },
    { "delivery.delivery_address.location.lat": { $not: { $type: "number" } } },
    { "delivery.delivery_address.location.lng": { $not: { $type: "number" } } },
  ],
};

// Generic pagination helper (page & limit)
function parsePagination(req) {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

// Date range helper (defaults to last N days)
function parseDateRange(req, { defaultDays = 30 } = {}) {
  let { from, to } = req.query;
  let fromDate = from
    ? new Date(from)
    : new Date(Date.now() - defaultDays * 86400000);
  let toDate = to ? new Date(to) : new Date();
  if (isNaN(fromDate.getTime()))
    fromDate = new Date(Date.now() - defaultDays * 86400000);
  if (isNaN(toDate.getTime())) toDate = new Date();
  return { from: fromDate, to: toDate };
}

// -------- Full deletion helpers (cascade) --------
async function _deleteSellerCascade(sellerDoc, cascade, full) {
  const sellerId = String(sellerDoc._id);
  // delete products
  const productsDel = await Product.deleteMany({ seller_id: sellerId });
  cascade.productsDeleted = productsDel?.deletedCount || 0;
  // optionally delete orders referencing this seller (logical cleanup)
  const ordersDel = await Order.deleteMany({ seller_id: sellerId });
  cascade.ordersDeleted = ordersDel?.deletedCount || 0;
  // device tokens & earnings logs keyed by _id
  const tokensDel = await DeviceToken.deleteMany({ user_id: sellerId });
  cascade.deviceTokensDeleted = tokensDel?.deletedCount || 0;
  const earningsDel = await EarningLog.deleteMany({ seller_id: sellerId });
  cascade.earningsDeleted = earningsDel?.deletedCount || 0;
  return cascade;
}

async function _deleteDeliveryAgentCascade(agentDoc, cascade, full) {
  const agentId = String(agentDoc._id);
  // remove device tokens by id
  const tokensDel = await DeviceToken.deleteMany({ user_id: agentId });
  cascade.deviceTokensDeleted = tokensDel?.deletedCount || 0;
  // Null out delivery assignments on orders referencing this agent
  const ordersUpd = await Order.updateMany(
    { "delivery.delivery_agent_id": agentId },
    {
      $unset: {
        "delivery.delivery_agent_id": "",
        "delivery.delivery_agent_response": "",
      },
    },
  );
  cascade.ordersUpdated = ordersUpd?.modifiedCount || 0;
  return cascade;
}

// Helper: resolve candidate user ids by email (checks Admin/Client/Seller/DeliveryAgent)
async function _resolveUserIdsByEmail(email) {
  const e = String(email || "")
    .toLowerCase()
    .trim();
  if (!e) return [];
  const [admins, clients, sellers, agents] = await Promise.all([
    Admin.find({ email: e }).select("_id").lean(),
    Client.find({ email: e }).select("_id").lean(),
    Seller.find({ email: e }).select("_id").lean(),
    DeliveryAgent.find({ email: e }).select("_id").lean(),
  ]);
  const ids = [];
  for (const col of [admins, clients, sellers, agents]) {
    for (const doc of col) {
      if (doc._id) ids.push(String(doc._id));
    }
  }
  return Array.from(new Set(ids));
}

// -------- Google geocoding helpers (used by order fix-address) --------
async function _httpGetJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (resp) => {
        let data = "";
        resp.on("data", (chunk) => (data += chunk));
        resp.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
}

async function _geocodeAddress(address, key) {
  if (!address || !address.trim()) return null;
  let base = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
    address,
  )}`;
  // Optional bias by components, e.g., country:IN (set GOOGLE_GEOCODE_COMPONENTS or GEO_COUNTRY)
  const comp = process.env.GOOGLE_GEOCODE_COMPONENTS || process.env.GEO_COUNTRY;
  if (comp) {
    const val = comp.includes("=") ? comp : `country:${comp}`;
    base += `&components=${encodeURIComponent(val)}`;
  }
  const url = `${base}&key=${key}`;
  const data = await _httpGetJson(url);
  if (data.status !== "OK") return null;
  const first = data.results?.[0];
  const loc = first?.geometry?.location;
  const formatted = first?.formatted_address;
  return loc ? { lat: loc.lat, lng: loc.lng, formatted } : null;
}

async function _placeDetails(placeId, key) {
  if (!placeId) return null;
  const fields = "geometry,formatted_address"; // include formatted address
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(
    placeId,
  )}&fields=${fields}&key=${key}`;
  const data = await _httpGetJson(url);
  if (data.status !== "OK") return null;
  const result = data.result;
  const loc = result?.geometry?.location;
  const formatted = result?.formatted_address;
  return loc ? { lat: loc.lat, lng: loc.lng, formatted } : null;
}

module.exports = {
  missingSeller,
  missingAddr,
  missingOrderAddr,
  parsePagination,
  parseDateRange,
  _deleteSellerCascade,
  _deleteDeliveryAgentCascade,
  _resolveUserIdsByEmail,
  _httpGetJson,
  _geocodeAddress,
  _placeDetails,
};
