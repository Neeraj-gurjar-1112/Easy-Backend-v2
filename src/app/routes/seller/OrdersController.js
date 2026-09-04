const { Order, Product } = require("@models");
const mongoose = require("mongoose");
const {
  publish,
  addSellerClient,
  publishToSeller,
} = require("@events/orderEvents");
const { notifyOrderUpdate } = require("@push");
const { buildSnapshot } = require("@lib/orders/snapshot");

class OrdersController {
  // Seller orders listing (parity): list any order that contains at least one product owned by this seller
  // GET /orders
  async listOrders(req, res) {
    try {
      const sellerObjectId = new mongoose.Types.ObjectId(req.sellerId);
      const page = Math.max(parseInt(req.query.page) || 1, 1);
      const pageSize = Math.min(
        Math.max(parseInt(req.query.pageSize) || 50, 1),
        200,
      );
      const skip = (page - 1) * pageSize;

      const pipeline = [
        {
          $lookup: {
            from: "products",
            let: { itemProductIds: "$order_items.product_id" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $in: ["$_id", "$$itemProductIds"] },
                      { $eq: ["$seller_id", sellerObjectId] },
                    ],
                  },
                },
              },
              { $limit: 1 },
            ],
            as: "matchingProducts",
          },
        },
        { $match: { matchingProducts: { $ne: [] } } },
        {
          $facet: {
            data: [
              { $sort: { _id: -1 } },
              { $skip: skip },
              { $limit: pageSize },
              { $project: { matchingProducts: 0 } },
            ],
            totalCount: [{ $count: "count" }],
          },
        },
        {
          $project: {
            data: 1,
            total: { $ifNull: [{ $arrayElemAt: ["$totalCount.count", 0] }, 0] },
          },
        },
      ];

      const agg = await Order.aggregate(pipeline);
      const { data: orders = [], total = 0 } = agg[0] || {};
      // Ensure consistent order_id field for frontend compatibility
      const formatted = orders.map((o) => ({ ...o, order_id: o._id }));
      const wantMeta =
        req.query.meta === "1" ||
        req.query.meta === "true" ||
        typeof req.query.page !== "undefined" ||
        typeof req.query.pageSize !== "undefined";
      if (wantMeta) return res.json({ page, pageSize, total, orders: formatted });
      return res.json(formatted);
    } catch (e) {
      console.error("Error listing seller orders", e);
      res.status(500).json({ error: "failed to list seller orders" });
    }
  }

  // Get pending orders for seller approval
  // GET /orders/pending
  async listPendingOrders(req, res) {
    try {
      const sellerObjectId = new mongoose.Types.ObjectId(req.sellerId);
      const pipeline = [
        { $match: { "payment.status": "pending" } },
        {
          $lookup: {
            from: "products",
            let: { itemProductIds: "$order_items.product_id" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $in: ["$_id", "$$itemProductIds"] },
                      { $eq: ["$seller_id", sellerObjectId] },
                    ],
                  },
                },
              },
              { $limit: 1 },
            ],
            as: "matchingProducts",
          },
        },
        { $match: { matchingProducts: { $ne: [] } } },
        { $sort: { created_at: -1 } },
        { $project: { matchingProducts: 0 } },
      ];

      const pendingOrders = await Order.aggregate(pipeline);

      const formattedOrders = pendingOrders.map((order) => ({
        order_id: order._id,
        order_number: `ORD${order._id
          .toString()
          .slice(-3)
          .toUpperCase()}${Math.floor(Math.random() * 100)}`,
        customer_name: order.client_id?.name || "Customer",
        customer_phone: order.client_id?.phone || "N/A",
        delivery_to: (() => {
          const da = order.delivery?.delivery_address;
          if (!da) return "Address not available";
          const street = da.street?.trim();
          const fullAddr = da.full_address?.trim();
          return [street, fullAddr].filter(Boolean).join(", ") || "Address not available";
        })(),
        total_amount: order.payment?.amount || 0,
        items: order.order_items || [],
        created_at: order.created_at,
      }));

      res.json(formattedOrders);
    } catch (error) {
      console.error("Error fetching pending orders:", error);
      res.status(500).json({ error: "Failed to fetch pending orders" });
    }
  }

  // Get a single order details (validated for this seller)
  // GET /orders/:id
  async getOrder(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ error: "Invalid order ID" });
      }
      const order = await Order.findById(id)
        .populate({
          path: "order_items.product_id",
          select: "name price category seller_id",
        })
        .lean();
      if (!order) return res.status(404).json({ error: "Order not found" });

      // Validate this order includes at least one item for this seller
      const itemProductIds = (order.order_items || [])
        .map((i) => i && i.product_id && i.product_id._id)
        .filter(Boolean);
      if (!itemProductIds.length) {
        return res
          .status(403)
          .json({ error: "Order has no items to validate for seller" });
      }
      const sellerHasItems = await Product.exists({
        _id: { $in: itemProductIds },
        seller_id: req.sellerId,
      });
      if (!sellerHasItems) {
        return res
          .status(403)
          .json({ error: "Order does not include any items from this seller" });
      }

      // Build a concise payload
      const items = (order.order_items || []).map((it) => ({
        product_id: it.product_id?._id || it.product_id,
        name: it.product_id?.name || it.name_snapshot || "Item",
        price:
          typeof it.price_snapshot === "number"
            ? it.price_snapshot
            : it.product_id?.price || null,
        qty: it.qty,
        category: it.product_id?.category,
      }));
      const resp = {
        _id: order._id,
        order_id: order._id,
        status:
          order.status ||
          order.payment?.status ||
          order.delivery?.delivery_status ||
          "pending",
        payment: order.payment || {},
        delivery: order.delivery || {},
        items,
        created_at: order.created_at,
      };
      return res.json(resp);
    } catch (e) {
      console.error("Error fetching seller order by id", e);
      res.status(500).json({ error: "Failed to fetch order" });
    }
  }

  // SSE stream for all seller-related order updates (subscribe once per seller)
  // GET /stream
  async stream(req, res) {
    try {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();
      res.write(": connected\n\n");
      addSellerClient(String(req.sellerId), res);
    } catch (e) {
      console.error("seller stream error", e);
      try {
        res.status(500).end();
      } catch (_) {}
    }
  }

  // Accept order
  // POST /orders/accept
  async acceptOrder(req, res) {
    try {
      const { orderId } = req.body;

      if (!mongoose.isValidObjectId(orderId)) {
        return res.status(400).json({ error: "Invalid order ID" });
      }

      // Load order, then verify it contains at least one item owned by this seller
      const order = await Order.findById(orderId);
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      const itemProductIds = (order.order_items || [])
        .map((i) => i && i.product_id)
        .filter(Boolean);
      if (!itemProductIds.length) {
        return res
          .status(403)
          .json({ error: "Order has no items to validate for seller" });
      }
      const sellerHasItems = await Product.exists({
        _id: { $in: itemProductIds },
        seller_id: req.sellerId,
      });
      if (!sellerHasItems) {
        return res
          .status(403)
          .json({ error: "Order does not include any items from this seller" });
      }

      // REMOVED: Manual payment status update - payment is now auto-set to 'paid' when order is delivered
      // Update order to move to delivery pending status
      let updatedOrder = await Order.findByIdAndUpdate(
        orderId,
        {
          $set: {
            status: "processing",
            "delivery.delivery_status": "pending",
          },
        },
        { new: true },
      );

      // Get store location from seller (for distance calculation)
      let storeLat, storeLng;
      if (itemProductIds.length) {
        const firstProduct = await Product.findById(itemProductIds[0]).populate(
          "seller_id",
        );
        if (
          firstProduct?.seller_id?.location?.lat &&
          firstProduct?.seller_id?.location?.lng
        ) {
          storeLat = firstProduct.seller_id.location.lat;
          storeLng = firstProduct.seller_id.location.lng;
        }
      }

      // If we don't have store location, fallback to pickup_address or delivery address
      if (!storeLat || !storeLng) {
        storeLat =
          order.pickup_address?.location?.lat ||
          order.delivery_address?.location?.lat;
        storeLng =
          order.pickup_address?.location?.lng ||
          order.delivery_address?.location?.lng;
      }

      // Disabled auto-assignment of delivery agents here
      // Orders will remain unassigned (pending) and broadcasted to all delivery agents
      // so they can accept them as per their convenience.
      let selectedAgent = null;

      // Publish SSE + push
      try {
        const freshOrder = updatedOrder || order;
        const snapshot = buildSnapshot(freshOrder);
        publish(String(freshOrder._id), snapshot);
        if (snapshot.seller_id)
          publishToSeller(String(snapshot.seller_id), snapshot); // sanitized in publisher
        await notifyOrderUpdate(
          freshOrder.toObject ? freshOrder.toObject() : freshOrder,
          snapshot,
          { excludeRoles: ["seller"] },
        );
      } catch (_) {}

      res.json({
        message: "Order accepted successfully",
        order: updatedOrder,
        delivery_agent: selectedAgent ? selectedAgent.name : "No agent available",
      });
    } catch (error) {
      console.error("Error accepting order:", error);
      res.status(500).json({ error: "Failed to accept order" });
    }
  }

  // Reject order
  // POST /orders/reject
  async rejectOrder(req, res) {
    try {
      const { orderId, reason } = req.body || {};

      if (!mongoose.isValidObjectId(orderId)) {
        return res.status(400).json({ error: "Invalid order ID" });
      }
      const reasonStr = (reason ?? "").toString().trim();
      if (!reasonStr || reasonStr.length < 3) {
        return res
          .status(400)
          .json({ error: "rejection reason is required (min 3 chars)" });
      }

      // Load order, then verify it contains at least one item owned by this seller
      const order = await Order.findById(orderId);
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }
      const itemProductIds = (order.order_items || [])
        .map((i) => i && i.product_id)
        .filter(Boolean);
      if (!itemProductIds.length) {
        return res
          .status(403)
          .json({ error: "Order has no items to validate for seller" });
      }
      const sellerHasItems = await Product.exists({
        _id: { $in: itemProductIds },
        seller_id: req.sellerId,
      });
      if (!sellerHasItems) {
        return res
          .status(403)
          .json({ error: "Order does not include any items from this seller" });
      }

      // Update order status to cancelled and store reason
      const updatedOrder = await Order.findByIdAndUpdate(
        orderId,
        {
          $set: {
            "payment.status": "canceled",
            "delivery.delivery_status": "cancelled",
            "delivery.cancellation_reason": reasonStr,
            "delivery.cancelled_by": "seller",
            "delivery.cancelled_at": new Date(),
          },
        },
        { new: true },
      );

      // Publish SSE + push
      try {
        const snapshot = buildSnapshot(updatedOrder);
        publish(String(updatedOrder._id), snapshot);
        if (snapshot.seller_id)
          publishToSeller(String(snapshot.seller_id), snapshot); // sanitized in publisher
        await notifyOrderUpdate(
          updatedOrder.toObject ? updatedOrder.toObject() : updatedOrder,
          snapshot,
          { excludeRoles: ["seller"] },
        );
      } catch (_) {}

      res.json({ message: "Order rejected successfully", order: updatedOrder });
    } catch (error) {
      console.error("Error rejecting order:", error);
      res.status(500).json({ error: "Failed to reject order" });
    }
  }
}

module.exports = new OrdersController();
