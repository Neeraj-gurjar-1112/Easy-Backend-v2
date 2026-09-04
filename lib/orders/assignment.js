/**
 * Nearest-delivery-agent assignment. Extracted verbatim from the legacy
 * controllers/ordersController.js.
 *
 * NOTE: auto-assignment is intentionally disabled (the function returns null
 * immediately) so orders stay visible to every delivery partner in the Pending
 * Orders list. The remaining body is kept as-is for when it is re-enabled.
 */
const { Order, Seller, DeliveryAgent } = require("@models");
const { publish, publishToSeller } = require("@events/orderEvents");
const { notifyOrderUpdate } = require("@push");
const { haversineKm, buildEnrichedSnapshot } = require("./snapshot");

async function assignNearestDeliveryAgent(order, opts = {}) {
  try {
    // Disabled auto-assignment to make orders available to all delivery partners
    // They will pick it up from the Pending Orders list.
    return null;

    // Determine pickup reference location: prefer seller location, fallback to client location
    let refLoc = null;
    if (order.seller_id) {
      try {
        const s = await Seller.findById(order.seller_id, {
          location: 1,
        }).lean();
        if (s?.location?.lat != null && s?.location?.lng != null) {
          refLoc = { lat: Number(s.location.lat), lng: Number(s.location.lng) };
        }
      } catch (_) {}
    }
    if (!refLoc && order.delivery?.delivery_address?.location) {
      const l = order.delivery.delivery_address.location;
      if (l && l.lat != null && l.lng != null) {
        refLoc = { lat: Number(l.lat), lng: Number(l.lng) };
      }
    }

    // Gather tried agents to avoid re-offering
    const tried = new Set(
      (del.assignment_history || []).map((h) => String(h.agent_id)),
    );

    // Find candidate agents
    const candidates = await DeliveryAgent.find({
      approved: true,
      active: true,
      available: true,
    }).lean();
    if (!candidates.length) return null;

    // Filter out tried and compute distance
    const scored = candidates
      .filter((a) => !tried.has(String(a._id)))
      .map((a) => {
        const aLoc = a.current_location || {};
        const hasLoc = aLoc && aLoc.lat != null && aLoc.lng != null;
        const dist =
          refLoc && hasLoc
            ? haversineKm(refLoc, {
                lat: Number(aLoc.lat),
                lng: Number(aLoc.lng),
              })
            : Number.POSITIVE_INFINITY;
        return { a, dist };
      });

    if (scored.length === 0) return null;

    // Choose nearest; if distances all INF, fallback to load (assigned_orders)
    scored.sort((x, y) => {
      const dx = isFinite(x.dist) ? x.dist : Number.MAX_VALUE;
      const dy = isFinite(y.dist) ? y.dist : Number.MAX_VALUE;
      if (dx !== dy) return dx - dy;
      return (x.a.assigned_orders || 0) - (y.a.assigned_orders || 0);
    });
    const chosen = scored[0]?.a;
    if (!chosen) return null;

    const updated = await Order.findByIdAndUpdate(
      order._id,
      {
        $set: {
          "delivery.delivery_agent_id": chosen._id,
          "delivery.delivery_agent_response": "pending",
          "delivery.delivery_status": "assigned",
        },
        $push: {
          "delivery.assignment_history": {
            agent_id: chosen._id,
            assigned_at: new Date(),
            response: "pending",
          },
        },
      },
      { new: true },
    );

    // Publish SSE + push for assigned agent.
    // Pass through isAdminAction so admin-triggered assignments don't fire
    // the looping alarm on agent devices as if it were a brand-new order offer.
    try {
      const snapshot = await buildEnrichedSnapshot(updated);
      publish(String(updated._id), snapshot);
      if (snapshot.seller_id)
        publishToSeller(String(snapshot.seller_id), snapshot);
      await notifyOrderUpdate(
        updated.toObject ? updated.toObject() : updated,
        snapshot,
        { isAdminAction: !!opts.isAdminAction },
      );
    } catch (_) {}

    return updated;
  } catch (e) {
    console.error("assignNearestDeliveryAgent error", e?.message || e);
    return null;
  }
}

module.exports = { assignNearestDeliveryAgent };
