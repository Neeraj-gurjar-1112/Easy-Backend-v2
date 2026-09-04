/**
 * HTTP handlers shared by the app orders routes (POST /api/orders/:id/verify,
 * PATCH /api/orders/:id/delivery) and the admin orders routes.
 * Extracted verbatim from the legacy controllers/ordersController.js.
 */
const { Order, Product } = require("@models");
const { publish, publishToSeller } = require("@events/orderEvents");
const { buildEnrichedSnapshot } = require("./snapshot");
const { assignNearestDeliveryAgent } = require("./assignment");

async function verifyPayment(req, res) {
  try {
    const { id } = req.params;
    const { status, note, verified_by } = req.body || {};
    const allowed = ["paid", "failed", "canceled"];
    if (!allowed.includes(status))
      return res.status(400).json({ message: "Invalid status" });

    const order = await Order.findById(id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    // Fix legacy invalid enum 'accepted' to 'processing' to allow successful save
    if (order.status === "accepted") {
      order.status = "processing";
    }

    order.payment.status = status;
    if (status === "paid") order.payment.payment_date = new Date();
    order.payment.verified = {
      by: verified_by || "admin",
      note,
      at: new Date(),
    };
    await order.save();

    // If paid, attempt initial assignment to nearest available delivery agent.
    // Pass isAdminAction so the inner push notification doesn't fire the looping
    // alarm on agent devices as if this were a spontaneous new order.
    if (status === "paid") {
      try {
        await assignNearestDeliveryAgent(order, { isAdminAction: !!req.admin });
      } catch (e) {
        console.warn("initial assignment failed", e?.message || e);
      }
    }
    const snapshot = await buildEnrichedSnapshot(order);
    publish(String(order._id), snapshot);
    // Publish to all sellers who own items in this order
    try {
      const pids = (order.order_items || [])
        .map((oi) => oi.product_id)
        .filter(Boolean);
      if (pids.length > 0) {
        const prods = await Product.find(
          { _id: { $in: pids } },
          { seller_id: 1 },
        ).lean();
        const sellerIds = [...new Set(prods.map((p) => String(p.seller_id)))];
        for (const sid of sellerIds) publishToSeller(sid, snapshot);
      }
    } catch (_) {}
    // Removed notifyOrderUpdate as per user request to avoid sending push notifications on payment updates

    // Return the updated order for admin verification
    const updated = await Order.findById(id).lean();
    res.json(updated);
  } catch (err) {
    res
      .status(400)
      .json({ message: err.message || "Failed to verify payment" });
  }
}

// Update delivery status & optional ETA. Simple unauthenticated endpoint for now (secure later).
async function updateDelivery(req, res) {
  try {
    const { id } = req.params;
    const { status, eta_minutes } = req.body || {};
    const allowed = ["pending", "dispatched", "delivered"];
    if (status && !allowed.includes(status)) {
      return res.status(400).json({ message: "Invalid delivery status" });
    }
    const order = await Order.findById(id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    // Fix legacy invalid enum 'accepted' to 'processing' to allow successful save
    if (order.status === "accepted") {
      order.status = "processing";
    }

    // Set status transitions
    if (status) {
      order.delivery = order.delivery || {};
      const prev = order.delivery.delivery_status;
      order.delivery.delivery_status = status;
      if (!order.delivery.delivery_start_time && status === "dispatched") {
        order.delivery.delivery_start_time = new Date();
        // If no delivery charge persisted for this order, compute it now using PlatformSettings
        try {
          const hasCharge = Number(order.delivery?.delivery_charge || 0) > 0;
          if (!hasCharge) {
            const { PlatformSettings, Product } = require("@models");
            const ps = (await PlatformSettings.findOne().lean()) || {};
            const baseGrocery = Number(ps.delivery_charge_grocery ?? 30);
            const baseFood = Number(ps.delivery_charge_food ?? 40);
            const threshold = Number(ps.min_total_for_delivery_charge ?? 100);
            // Compute subtotal from snapshot order items
            const items = Array.isArray(order.order_items)
              ? order.order_items.map((oi) => ({
                  qty: Number(oi.qty || 0),
                  price: Number(oi.price_snapshot || 0),
                  product_id: oi.product_id,
                }))
              : [];
            const subtotal = items.reduce(
              (s, it) => s + Number(it.price || 0) * Number(it.qty || 0),
              0,
            );
            let computed = 0;
            const applyCharge =
              !(Number.isFinite(threshold) && threshold > 0) ||
              subtotal <= threshold;
            if (applyCharge) {
              // Determine category mix to pick base charge
              let isFood = false;
              try {
                const pids = items.map((it) => it.product_id).filter(Boolean);
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
              computed = isFood ? baseFood : baseGrocery;
            } else {
              computed = 0; // waived above threshold
            }
            order.delivery.delivery_charge = Number(computed || 0);
          }
        } catch (_) {}
      }
      if (status === "delivered") {
        order.delivery.delivery_end_time = new Date();
        // Clear ETA once final
        order.delivery.eta_at = undefined;
        // Increment delivery agent completed counter if present
        try {
          const agentId = order.delivery?.delivery_agent_id;
          if (agentId) {
            const { DeliveryAgent } = require("@models");
            await DeliveryAgent.findByIdAndUpdate(agentId, {
              $inc: { completed_orders: 1 },
              $set: { available: true },
            });
          }
        } catch (_) {}

        // Persist earning logs for seller(s) and delivery agent
        try {
          const {
            Product,
            PlatformSettings,
            EarningLog,
          } = require("@models");
          const settings = (await PlatformSettings.findOne().lean()) || {};
          const commissionRate = Number(
            settings.platform_commission_rate ?? 0.1,
          );
          const agentShare = Number(settings.delivery_agent_share_rate ?? 0.8);

          // Map items by seller via product lookup
          const pids = (order.order_items || [])
            .map((oi) => oi.product_id)
            .filter(Boolean);
          let prodMap = new Map();
          if (pids.length) {
            const prods = await Product.find(
              { _id: { $in: pids } },
              { _id: 1, seller_id: 1 },
            ).lean();
            for (const p of prods)
              prodMap.set(String(p._id), String(p.seller_id));
          }
          const sellerTotals = new Map(); // sellerId -> item_total
          for (const oi of order.order_items || []) {
            const sid = prodMap.get(String(oi.product_id));
            if (!sid) continue;
            const line = Number(oi.price_snapshot || 0) * Number(oi.qty || 0);
            sellerTotals.set(sid, (sellerTotals.get(sid) || 0) + line);
          }

          for (const [sid, itemTotal] of sellerTotals.entries()) {
            const commission = +(itemTotal * commissionRate).toFixed(2);
            const net = +(itemTotal - commission).toFixed(2);
            try {
              await EarningLog.updateOne(
                { role: "seller", order_id: order._id, seller_id: sid },
                {
                  $setOnInsert: {
                    created_at: new Date(),
                  },
                  $set: {
                    role: "seller",
                    order_id: order._id,
                    seller_id: sid,
                    item_total: +itemTotal.toFixed(2),
                    platform_commission: commission,
                    net_earning: net,
                  },
                },
                { upsert: true },
              );
            } catch (_) {}
          }

          // Delivery agent earning: share of delivery charge
          const agentId = order.delivery?.delivery_agent_id;
          const delCharge = Number(order.delivery?.delivery_charge || 0);
          if (agentId && delCharge > 0) {
            const agentNet = +(delCharge * agentShare).toFixed(2);
            try {
              await EarningLog.updateOne(
                { role: "delivery", order_id: order._id, agent_id: agentId },
                {
                  $setOnInsert: { created_at: new Date() },
                  $set: {
                    role: "delivery",
                    order_id: order._id,
                    agent_id: agentId,
                    delivery_charge: delCharge,
                    net_earning: agentNet,
                  },
                },
                { upsert: true },
              );
            } catch (_) {}
          }
        } catch (ee) {
          console.error("earning log persist error", ee?.message || ee);
        }
      }
    }

    if (typeof eta_minutes === "number" && eta_minutes > 0) {
      const etaAt = new Date(Date.now() + eta_minutes * 60000);
      order.delivery = order.delivery || {};
      order.delivery.eta_at = etaAt;
    }

    await order.save();
    const snapshot = await buildEnrichedSnapshot(order);
    publish(String(order._id), snapshot);
    // Publish to all sellers who own items in this order
    try {
      const pids = (order.order_items || [])
        .map((oi) => oi.product_id)
        .filter(Boolean);
      if (pids.length > 0) {
        const prods = await Product.find(
          { _id: { $in: pids } },
          { seller_id: 1 },
        ).lean();
        const sellerIds = [...new Set(prods.map((p) => String(p.seller_id)))];
        for (const sid of sellerIds) {
          publishToSeller(sid, snapshot);
        }
      }
    } catch (_) {}
    try {
      // Removed notifyOrderUpdate as per user request to avoid sending push notifications on delivery status updates
    } catch (_) {}

    // Return the updated order for admin verification
    const updated = await Order.findById(id).lean();
    res.json(updated);
  } catch (err) {
    console.error("updateDelivery error:", err);
    res
      .status(400)
      .json({ message: err.message || "Failed to update delivery" });
  }
}

module.exports = { verifyPayment, updateDelivery };
