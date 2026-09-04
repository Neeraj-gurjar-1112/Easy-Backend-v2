/**
 * Shared helpers for the seller module (migrated verbatim from legacy routes/seller.js).
 */
const mongoose = require("mongoose");

// Haversine distance calculation (in kilometers)
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Middleware placeholder: in real scenario authenticate seller and attach seller_id
function requireSeller(req, res, next) {
  // For now expect ?sellerId= in query or seller_id in body (temporary until auth).
  const sellerId =
    req.query.sellerId || req.body.seller_id || req.headers["x-seller-id"];
  if (!sellerId || !mongoose.isValidObjectId(sellerId)) {
    return res.status(400).json({ error: "valid sellerId required" });
  }
  req.sellerId = sellerId;
  next();
}

// Delivery-availability constants (legacy: declared inside the check-delivery-availability handler)
const MAX_CONCURRENT_DELIVERIES = 3; // Agent can handle max 3 active deliveries
const NEARBY_RADIUS_KM = 10; // Consider agents within 10km as "nearby"

module.exports = {
  calculateDistance,
  requireSeller,
  MAX_CONCURRENT_DELIVERIES,
  NEARBY_RADIUS_KM,
};
