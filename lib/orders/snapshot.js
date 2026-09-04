/**
 * Order snapshot helpers shared by the app and admin services.
 * Extracted verbatim from the legacy controllers/ordersController.js.
 *
 *   buildSnapshot(order, etaMinutesOverride, updatedAtOverride)        plain snapshot
 *   buildEnrichedSnapshot(order, etaMinutesOverride, updatedAtOverride) + seller/client/agent/map enrichment
 *   genRef(prefix)                                                    ORD_YYYYMMDD_NNNNN style refs
 *   haversineKm(a, b)                                                 great-circle distance in km
 */
const {
  Seller,
  Product,
  Client, // include client for admin enrichment
  DeliveryAgent, // unify import (remove separate require later)
} = require("@models");

function haversineKm(a, b) {
  try {
    const toRad = (x) => (x * Math.PI) / 180;
    const R = 6371; // km
    const dLat = toRad((b.lat || 0) - (a.lat || 0));
    const dLon = toRad((b.lng || 0) - (a.lng || 0));
    const lat1 = toRad(a.lat || 0);
    const lat2 = toRad(b.lat || 0);
    const sinDLat = Math.sin(dLat / 2);
    const sinDLon = Math.sin(dLon / 2);
    const h =
      sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
    const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    return R * c;
  } catch (_) {
    return Number.POSITIVE_INFINITY;
  }
}

function genRef(prefix = "ORD") {
  const ts = new Date();
  const y = ts.getFullYear();
  const m = String(ts.getMonth() + 1).padStart(2, "0");
  const d = String(ts.getDate()).padStart(2, "0");
  const n = Math.floor(Math.random() * 100000)
    .toString()
    .padStart(5, "0");
  return `${prefix}_${y}${m}${d}_${n}`;
}

// Compose buildSnapshot + map enrichment (store_location, client_location, pickup_address, store)
async function buildEnrichedSnapshot(
  order,
  etaMinutesOverride = null,
  updatedAtOverride = null,
) {
  const base = buildSnapshot(order, etaMinutesOverride, updatedAtOverride);

  // Resolve seller object by id or via first product's seller
  let sellerObj = null;
  try {
    if (order.seller_id) {
      sellerObj = await Seller.findById(order.seller_id)
        .select("business_name address location place_id business_type phone")
        .lean();
    }
    if (
      !sellerObj &&
      Array.isArray(order.order_items) &&
      order.order_items.length > 0
    ) {
      const firstPid = order.order_items[0]?.product_id;
      if (firstPid) {
        try {
          const prod = await Product.findById(firstPid)
            .select("seller_id")
            .lean();
          if (prod?.seller_id) {
            sellerObj = await Seller.findById(prod.seller_id)
              .select(
                "business_name address location place_id business_type phone",
              )
              .lean();
          }
        } catch (_) {}
      }
    }
  } catch (_) {}

  const sellerLoc = sellerObj?.location || order.seller_id?.location || null;
  const clientLoc = order.delivery?.delivery_address?.location || null;

  // delivery agent live location (if available)
  let agentLoc = null;
  let agentObj = null;
  try {
    const agentId = order.delivery?.delivery_agent_id;
    if (agentId) {
      const ag = await DeliveryAgent.findById(agentId)
        .select("current_location name phone email")
        .lean();
      if (
        ag?.current_location &&
        ag.current_location.lat != null &&
        ag.current_location.lng != null
      ) {
        agentLoc = {
          lat: Number(ag.current_location.lat),
          lng: Number(ag.current_location.lng),
          updated_at: ag.current_location.updated_at || new Date(),
        };
      }
      if (ag) {
        agentObj = {
          id: String(agentId),
          name: ag.name,
          phone: ag.phone,
          email: ag.email,
        };
      }
    }
  } catch (_) {}

  // pickup address (prefer address text; else place details; else reverse geocode; else lat,lng string; else placeholder)
  let pickupAddr = (
    sellerObj?.address ||
    order.seller_id?.address ||
    ""
  ).toString();
  pickupAddr = pickupAddr && pickupAddr.trim() ? pickupAddr : null;
  if (!pickupAddr) {
    try {
      const {
        reverseGeocode,
        placeDetails,
        ENABLED,
      } = require("@util/geocode");
      if (ENABLED) {
        const placeId = sellerObj?.place_id || order.seller_id?.place_id;
        if (placeId) {
          try {
            const pd = await placeDetails(placeId);
            if (pd) pickupAddr = pd;
          } catch (_) {}
        }
        if (
          !pickupAddr &&
          sellerLoc &&
          sellerLoc.lat != null &&
          sellerLoc.lng != null
        ) {
          try {
            const rg = await reverseGeocode(
              Number(sellerLoc.lat),
              Number(sellerLoc.lng),
            );
            if (rg) pickupAddr = rg;
          } catch (_) {}
        }
      }
    } catch (_) {}
    if (!pickupAddr) {
      pickupAddr =
        sellerLoc && sellerLoc.lat != null && sellerLoc.lng != null
          ? `${Number(sellerLoc.lat).toFixed(5)}, ${Number(
              sellerLoc.lng,
            ).toFixed(5)}`
          : "Store address";
    }
  }

  const storeName =
    sellerObj?.business_name || order.seller_id?.business_name || null;

  // Attempt to resolve client object (best-effort; may be guest)
  let clientObj = null;
  try {
    const cid = order.client_id;
    if (cid) {
      let query = [{ firebase_uid: cid }];
      const mongoose = require("mongoose");
      if (cid.length === 24 && /^[0-9a-fA-F]{24}$/.test(cid)) {
        try {
          query.push({ _id: mongoose.Types.ObjectId(cid) });
        } catch (_) {}
      }
      // If phone numbers are stored separate - skip; email equality not reliable here
      clientObj = await Client.findOne({ $or: query })
        .select("name phone email firebase_uid")
        .lean();
      if (clientObj) {
        clientObj = {
          id: cid,
          name: clientObj.name,
          phone: clientObj.phone,
          email: clientObj.email,
        };
      } else {
        clientObj = { id: cid };
      }
    }
  } catch (_) {}

  // Build items array from order snapshot lines
  const items = Array.isArray(order.order_items)
    ? order.order_items.map((oi) => ({
        product_id: oi.product_id,
        qty: Number(oi.qty || 0),
        price: Number(oi.price_snapshot || 0),
        name: oi.name_snapshot || "Item",
      }))
    : [];
  const subtotal = items.reduce(
    (s, it) => s + Number(it.price || 0) * Number(it.qty || 0),
    0,
  );
  // Resolve delivery charge from persisted fields. If absent (legacy orders),
  // compute a best-effort fallback from PlatformSettings and item categories
  // while respecting the minimum subtotal threshold.
  let deliveryCharge = Number(
    order.delivery?.delivery_charge ?? order.delivery_charge ?? 0,
  );
  if (!(deliveryCharge > 0)) {
    try {
      const { PlatformSettings, Product } = require("@models");
      const ps = await PlatformSettings.findOne().lean();
      const rawG = Number(ps?.delivery_charge_grocery);
      const rawF = Number(ps?.delivery_charge_food);
      const baseGrocery = rawG > 0 ? rawG : 30;
      const baseFood = rawF > 0 ? rawF : 40;
      const threshold = Number(ps?.min_total_for_delivery_charge ?? 100);
      // Compute a non-zero charge when:
      // - threshold is not set or invalid (<= 0) → always apply base charge
      // - subtotal is at or below threshold → apply base charge
      // Otherwise (subtotal above threshold) → waive (0)
      const applyCharge =
        !(Number.isFinite(threshold) && threshold > 0) || subtotal <= threshold;
      if (applyCharge) {
        let isFood = false;
        try {
          const pids = (order.order_items || [])
            .map((oi) => oi.product_id)
            .filter(Boolean);
          if (pids.length) {
            const prods = await Product.find(
              { _id: { $in: pids } },
              { category: 1 },
            ).lean();
            for (const p of prods) {
              const c = (p.category || "").toString().toLowerCase();
              if (c.includes("restaurant") || c.includes("food")) {
                isFood = true;
                break;
              }
            }
          }
        } catch (_) {}
        deliveryCharge = isFood ? baseFood : baseGrocery;
      } else {
        deliveryCharge = 0; // waived above threshold
      }
    } catch (_) {
      // keep as 0 if settings lookup fails
    }
  }

  // Build adjustments using persisted applied_discount_amount if available; fallback to recompute if not persisted.
  let adjustments = [];
  // If we have a persisted discount amount, always expose it as an adjustment
  const persisted = Number(order.applied_discount_amount || 0);
  if (persisted > 0) {
    adjustments.push({
      type: "coupon",
      code: order.coupon_code || "DISCOUNT",
      amount: -persisted,
    });
  } else if (order.coupon_code && items.length) {
    // Legacy orders (before persistence) – best-effort recompute
    try {
      const { PlatformSettings } = require("@models");
      const settings = await PlatformSettings.findOne(
        {},
        { coupons: 1 },
      ).lean();
      const allCoupons = settings?.coupons || [];
      const code = order.coupon_code.toUpperCase().trim();
      const now = new Date();
      const subtotalForDiscount = subtotal;
      const pids = order.order_items.map((oi) => oi.product_id).filter(Boolean);
      const prods = pids.length
        ? await Product.find({ _id: { $in: pids } }, { category: 1 }).lean()
        : [];
      const presentCats = new Set();
      for (const p of prods) {
        const c = (p.category || "").toString().toLowerCase();
        if (c.includes("grocery")) presentCats.add("grocery");
        if (c.includes("vegetable")) presentCats.add("vegetable");
        if (c.includes("restaurant") || c.includes("food"))
          presentCats.add("food");
      }
      const found = allCoupons.find((c) => {
        const codeOk = String(c.code).toUpperCase().trim() === code;
        const activeOk = c.active !== false;
        const timeOk =
          (!c.validFrom || new Date(c.validFrom) <= now) &&
          (!c.validTo || new Date(c.validTo) >= now);
        const minOk = subtotalForDiscount >= (Number(c.minSubtotal) || 0);
        let catOk = true;
        if (Array.isArray(c.categories) && c.categories.length) {
          catOk = c.categories.some((x) => presentCats.has(String(x)));
        }
        return codeOk && activeOk && timeOk && minOk && catOk;
      });
      if (found && found.percent > 0) {
        const discount =
          Math.round(
            ((subtotalForDiscount * Number(found.percent || 0)) / 100) * 100,
          ) / 100;
        if (discount > 0) {
          adjustments.push({
            type: "coupon",
            code: found.code,
            amount: -discount,
            percent: found.percent,
          });
        }
      }
    } catch (_) {}
  }

  // Extract delivery address details
  const deliveryAddr = order.delivery?.delivery_address || null;
  const deliveryAddressInfo = deliveryAddr
    ? {
        delivery_address: {
          full_address: deliveryAddr.full_address || null,
          recipient_name: deliveryAddr.recipient_name || null,
          recipient_phone: deliveryAddr.recipient_phone || null,
          location: deliveryAddr.location || null,
        },
      }
    : {};

  return {
    ...base,
    ...(storeName ? { store: storeName } : {}),
    ...(pickupAddr ? { pickup_address: pickupAddr } : {}),
    store_location: sellerLoc || null,
    client_location: clientLoc || null,
    ...(agentLoc ? { agent_location: agentLoc } : {}),
    ...(sellerObj
      ? {
          seller: {
            id: String(order.seller_id || sellerObj._id || ""),
            name: sellerObj.business_name,
            phone: sellerObj.phone || null,
            address: sellerObj.address || null,
            business_type: sellerObj.business_type || null,
          },
        }
      : {}),
    ...(clientObj ? { client: clientObj } : {}),
    ...(agentObj ? { delivery_agent: agentObj } : {}),
    ...deliveryAddressInfo,
    items,
    subtotal,
    delivery_charge: deliveryCharge,
    adjustments,
  };
}

function buildSnapshot(
  order,
  etaMinutesOverride = null,
  updatedAtOverride = null,
) {
  const updatedAt =
    updatedAtOverride || order.payment?.verified?.at || new Date();
  let etaMinutes = etaMinutesOverride;
  if (etaMinutes == null && order.delivery && order.delivery.eta_at) {
    const etaMs = new Date(order.delivery.eta_at).getTime() - Date.now();
    etaMinutes = etaMs > 0 ? Math.ceil(etaMs / 60000) : 0;
  }
  return {
    order_id: order._id,
    seller_id: order.seller_id || null,
    client_id: order.client_id || null,
    created_at: order.created_at || order._id.getTimestamp(),
    status: order.payment?.status || "pending",
    payment: {
      amount: order.payment?.amount,
      method: order.payment?.method,
      updated_at: updatedAt,
      verified_by: order.payment?.verified?.by || null,
      verified_note: order.payment?.verified?.note || null,
      verified_at: order.payment?.verified?.at || null,
    },
    delivery: {
      status: order.delivery?.delivery_status || "pending",
      eta_at: order.delivery?.eta_at || null,
      eta_minutes: etaMinutes,
      started_at: order.delivery?.delivery_start_time || null,
      ended_at: order.delivery?.delivery_end_time || null,
      delivery_agent_id: order.delivery?.delivery_agent_id || null,
      delivery_agent_response: order.delivery?.delivery_agent_response || null,
      delivery_charge: order.delivery?.delivery_charge || 0,

      // Cancellation metadata (if cancelled)
      cancellation_reason: order.delivery?.cancellation_reason || null,
      cancelled_by: order.delivery?.cancelled_by || null,
      cancelled_at: order.delivery?.cancelled_at || null,
      assignment_history: Array.isArray(order.delivery?.assignment_history)
        ? order.delivery.assignment_history.map((h) => ({
            agent_id: h.agent_id || null,
            assigned_at: h.assigned_at || null,
            response: h.response || null,
            response_at: h.response_at || null,
          }))
        : [],
    },
  };
}

module.exports = { haversineKm, genRef, buildSnapshot, buildEnrichedSnapshot };
