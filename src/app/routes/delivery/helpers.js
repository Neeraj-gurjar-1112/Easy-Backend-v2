/**
 * Shared module-level helpers for the delivery module (verbatim from legacy routes/delivery.js).
 */
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { PlatformSettings, Seller } = require("@models");

// Admin authentication middleware
function requireAdmin(req, res, next) {
  try {
    const auth = req.headers.authorization || req.headers.Authorization;
    if (!auth || !/^Bearer /i.test(auth)) {
      return res.status(401).json({ error: "Admin authentication required" });
    }

    const token = auth.split(/\s+/)[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    req.admin = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid or expired admin token" });
  }
}

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

// Compute agent earning from delivery charge (based on platform settings)
// Now handles admin-paid compensation for "free" deliveries
async function _calculateAgentEarning(deliveryCharge, order = null) {
  try {
    // Check if admin is paying for this delivery (when delivery is free to customer)
    if (order?.delivery?.admin_pays_agent === true) {
      const adminPayment = Number(order.delivery.admin_agent_payment || 0);
      if (adminPayment > 0) return +adminPayment.toFixed(2);
    }

    // Standard delivery charge split
    if (!deliveryCharge || deliveryCharge <= 0) return 0;
    const ps = (await PlatformSettings.findOne().lean()) || {};
    const agentShare = Number(ps.delivery_agent_share_rate ?? 0.8);
    return +(Number(deliveryCharge) * agentShare).toFixed(2);
  } catch (_) {
    return +(Number(deliveryCharge) * 0.8).toFixed(2); // fallback to 80%
  }
}

// Compute effective delivery charge when not persisted on the order
async function _effectiveDeliveryCharge(order) {
  try {
    const persisted = Number(order?.delivery?.delivery_charge || 0);
    if (persisted > 0) return +persisted.toFixed(2);

    // Subtotal from order item snapshots
    const items = Array.isArray(order?.order_items) ? order.order_items : [];
    const subtotal = items.reduce(
      (s, it) => s + Number(it.price_snapshot || 0) * Number(it.qty || 0),
      0,
    );

    // Check seller's custom delivery_fee
    let sellerId = order?.seller_id;
    if (!sellerId && items.length > 0) {
      sellerId = items[0].seller_id;
    }
    let customSellerFee = null;
    if (sellerId && mongoose.isValidObjectId(sellerId)) {
      const seller = await Seller.findById(sellerId).lean();
      if (seller && seller.delivery_fee != null && Number(seller.delivery_fee) > 0) {
        customSellerFee = Number(seller.delivery_fee);
      }
    }

    // Platform base charges and threshold
    const ps = (await PlatformSettings.findOne().lean()) || {};
    const baseGrocery = customSellerFee ?? (Number(ps.delivery_charge_grocery ?? 30) || 0);
    const baseFood = customSellerFee ?? (Number(ps.delivery_charge_food ?? 40) || 0);
    const threshold = Number(ps.min_total_for_delivery_charge ?? 100);

    const applyCharge =
      !(Number.isFinite(threshold) && threshold > 0) || subtotal <= threshold;
    if (!applyCharge) return 0; // waived above threshold

    // Decide bucket based on product categories (from populated product or snapshot)
    let isFood = false;
    for (const it of items) {
      const cat = (it?.product_id?.category || it?.category || "")
        .toString()
        .toLowerCase();
      if (cat.includes("restaurant") || cat.includes("food")) {
        isFood = true;
        break;
      }
    }
    const eff = customSellerFee ?? (isFood ? baseFood : baseGrocery);
    return +Number(eff || 0).toFixed(2);
  } catch (_) {
    return 0;
  }
}

// Helper: Calculate distance in KM between two {lat, lng} objects
function calcDistanceKM(a, b) {
  if (
    !a ||
    !b ||
    typeof a.lat !== "number" ||
    typeof a.lng !== "number" ||
    typeof b.lat !== "number" ||
    typeof b.lng !== "number"
  )
    return null;
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371; // Earth radius in KM
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const aVal =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(aVal), Math.sqrt(1 - aVal));
  return +(R * c).toFixed(2);
}

module.exports = {
  requireAdmin,
  calculateDistance,
  calcDistanceKM,
  _calculateAgentEarning,
  _effectiveDeliveryCharge,
};
