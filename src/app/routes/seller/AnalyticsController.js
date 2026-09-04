const { Order } = require("@models");
const mongoose = require("mongoose");

// ========================================
// REAL-TIME ANALYTICS SSE
// ========================================

const sellerAnalyticsClients = new Map();

/**
 * Helper function to broadcast analytics updates to all connected sellers
 * Call this when an order is created/updated
 */
function broadcastAnalyticsUpdate(sellerId, data) {
  const clients = sellerAnalyticsClients.get(String(sellerId));
  if (clients && clients.size > 0) {
    const message = `data: ${JSON.stringify({
      type: "order_update",
      data,
    })}\n\n`;
    clients.forEach((client) => {
      try {
        client.write(message);
      } catch (error) {
        console.error("Failed to send SSE update:", error);
      }
    });
  }
}

class AnalyticsController {
  // ========================================
  // SALES ANALYTICS DASHBOARD
  // ========================================

  /**
   * GET /api/seller/analytics
   * Sales analytics for seller dashboard
   * Query params:
   *   - period: 'today' | 'week' | 'month' | 'year' | 'all' (default: 'month')
   */
  async getAnalytics(req, res) {
    try {
      const sellerId = req.sellerId;
      const period = req.query.period || "month";

      // Calculate date range
      const now = new Date();
      let startDate;
      switch (period) {
        case "today":
          startDate = new Date(now.setHours(0, 0, 0, 0));
          break;
        case "week":
          startDate = new Date(now.setDate(now.getDate() - 7));
          break;
        case "month":
          startDate = new Date(now.setMonth(now.getMonth() - 1));
          break;
        case "year":
          startDate = new Date(now.setFullYear(now.getFullYear() - 1));
          break;
        case "all":
          startDate = new Date(0); // Beginning of time
          break;
        default:
          startDate = new Date(now.setMonth(now.getMonth() - 1));
      }

      // Aggregation pipeline for analytics
      // Use item-level price snapshots to compute revenue (more accurate than payment.amount for potential adjustments/discounts)
      const analytics = await Order.aggregate([
        {
          $match: {
            created_at: { $gte: startDate },
            $or: [
              { seller_id: new mongoose.Types.ObjectId(sellerId) },
              { "items.seller_id": new mongoose.Types.ObjectId(sellerId) }, // legacy orders
            ],
          },
        },
        // Normalize items array across legacy/new schemas and keep seller ObjectId for filtering
        {
          $addFields: {
            itemsNormalized: {
              $cond: [
                { $gt: [{ $size: { $ifNull: ["$order_items", []] } }, 0] },
                "$order_items",
                { $ifNull: ["$items", []] },
              ],
            },
            _sellerOid: { $toObjectId: sellerId },
          },
        },
        {
          $facet: {
            overview: [
              {
                $addFields: {
                  // Fallback to price if price_snapshot missing (older orders)
                  computedItemTotal: {
                    $sum: {
                      $map: {
                        input: { $ifNull: ["$itemsNormalized", []] },
                        as: "it",
                        in: {
                          $cond: [
                            // If legacy item has seller_id, include only matching this seller; for new items (no seller_id), include all
                            { $ifNull: ["$$it.seller_id", false] },
                            {
                              $cond: [
                                { $eq: ["$$it.seller_id", "$_sellerOid"] },
                                {
                                  $multiply: [
                                    {
                                      $ifNull: [
                                        "$$it.qty",
                                        { $ifNull: ["$$it.quantity", 0] },
                                      ],
                                    },
                                    {
                                      $ifNull: [
                                        "$$it.price_snapshot",
                                        { $ifNull: ["$$it.price", 0] },
                                      ],
                                    },
                                  ],
                                },
                                0,
                              ],
                            },
                            {
                              $multiply: [
                                {
                                  $ifNull: [
                                    "$$it.qty",
                                    { $ifNull: ["$$it.quantity", 0] },
                                  ],
                                },
                                {
                                  $ifNull: [
                                    "$$it.price_snapshot",
                                    { $ifNull: ["$$it.price", 0] },
                                  ],
                                },
                              ],
                            },
                          ],
                        },
                      },
                    },
                  },
                },
              },
              {
                $group: {
                  _id: null,
                  totalRevenue: { $sum: "$computedItemTotal" },
                  totalOrders: { $sum: 1 },
                  completedOrders: {
                    $sum: {
                      $cond: [
                        { $eq: ["$delivery.delivery_status", "delivered"] },
                        1,
                        0,
                      ],
                    },
                  },
                  cancelledOrders: {
                    $sum: {
                      $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0],
                    },
                  },
                  pendingOrders: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            { $ne: ["$status", "cancelled"] },
                            { $ne: ["$delivery.delivery_status", "delivered"] },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                },
              },
            ],
            topProducts: [
              {
                $unwind: {
                  path: "$itemsNormalized",
                  preserveNullAndEmptyArrays: false,
                },
              },
              {
                $group: {
                  _id: "$itemsNormalized.product_id",
                  productName: {
                    $first: {
                      $ifNull: [
                        "$itemsNormalized.name_snapshot",
                        "$itemsNormalized.name",
                      ],
                    },
                  },
                  totalQuantity: {
                    $sum: {
                      $ifNull: [
                        "$itemsNormalized.qty",
                        { $ifNull: ["$itemsNormalized.quantity", 0] },
                      ],
                    },
                  },
                  totalRevenue: {
                    $sum: {
                      $cond: [
                        { $ifNull: ["$itemsNormalized.seller_id", false] },
                        {
                          $cond: [
                            {
                              $eq: ["$itemsNormalized.seller_id", "$_sellerOid"],
                            },
                            {
                              $multiply: [
                                {
                                  $ifNull: [
                                    "$itemsNormalized.qty",
                                    { $ifNull: ["$itemsNormalized.quantity", 0] },
                                  ],
                                },
                                {
                                  $ifNull: [
                                    "$itemsNormalized.price_snapshot",
                                    { $ifNull: ["$itemsNormalized.price", 0] },
                                  ],
                                },
                              ],
                            },
                            0,
                          ],
                        },
                        {
                          $multiply: [
                            {
                              $ifNull: [
                                "$itemsNormalized.qty",
                                { $ifNull: ["$itemsNormalized.quantity", 0] },
                              ],
                            },
                            {
                              $ifNull: [
                                "$itemsNormalized.price_snapshot",
                                { $ifNull: ["$itemsNormalized.price", 0] },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  },
                  orderCount: { $sum: 1 },
                },
              },
              { $sort: { totalRevenue: -1 } },
              { $limit: 10 },
            ],
            revenueByDay: [
              {
                $addFields: {
                  dayItemTotal: {
                    $sum: {
                      $map: {
                        input: { $ifNull: ["$itemsNormalized", []] },
                        as: "it",
                        in: {
                          $cond: [
                            { $ifNull: ["$$it.seller_id", false] },
                            {
                              $cond: [
                                { $eq: ["$$it.seller_id", "$_sellerOid"] },
                                {
                                  $multiply: [
                                    {
                                      $ifNull: [
                                        "$$it.qty",
                                        { $ifNull: ["$$it.quantity", 0] },
                                      ],
                                    },
                                    {
                                      $ifNull: [
                                        "$$it.price_snapshot",
                                        { $ifNull: ["$$it.price", 0] },
                                      ],
                                    },
                                  ],
                                },
                                0,
                              ],
                            },
                            {
                              $multiply: [
                                {
                                  $ifNull: [
                                    "$$it.qty",
                                    { $ifNull: ["$$it.quantity", 0] },
                                  ],
                                },
                                {
                                  $ifNull: [
                                    "$$it.price_snapshot",
                                    { $ifNull: ["$$it.price", 0] },
                                  ],
                                },
                              ],
                            },
                          ],
                        },
                      },
                    },
                  },
                },
              },
              {
                $group: {
                  _id: {
                    $dateToString: { format: "%Y-%m-%d", date: "$created_at" },
                  },
                  revenue: { $sum: "$dayItemTotal" },
                  orders: { $sum: 1 },
                },
              },
              { $sort: { _id: 1 } },
              { $limit: 30 },
            ],
            paymentMethods: [
              {
                $addFields: {
                  methodItemTotal: {
                    $sum: {
                      $map: {
                        input: { $ifNull: ["$itemsNormalized", []] },
                        as: "it",
                        in: {
                          $cond: [
                            { $ifNull: ["$$it.seller_id", false] },
                            {
                              $cond: [
                                { $eq: ["$$it.seller_id", "$_sellerOid"] },
                                {
                                  $multiply: [
                                    {
                                      $ifNull: [
                                        "$$it.qty",
                                        { $ifNull: ["$$it.quantity", 0] },
                                      ],
                                    },
                                    {
                                      $ifNull: [
                                        "$$it.price_snapshot",
                                        { $ifNull: ["$$it.price", 0] },
                                      ],
                                    },
                                  ],
                                },
                                0,
                              ],
                            },
                            {
                              $multiply: [
                                {
                                  $ifNull: [
                                    "$$it.qty",
                                    { $ifNull: ["$$it.quantity", 0] },
                                  ],
                                },
                                {
                                  $ifNull: [
                                    "$$it.price_snapshot",
                                    { $ifNull: ["$$it.price", 0] },
                                  ],
                                },
                              ],
                            },
                          ],
                        },
                      },
                    },
                  },
                },
              },
              {
                $group: {
                  _id: "$payment.method",
                  count: { $sum: 1 },
                  revenue: { $sum: "$methodItemTotal" },
                },
              },
            ],
          },
        },
      ]);

      const result = analytics[0];
      const overview = result.overview[0] || {
        totalRevenue: 0,
        totalOrders: 0,
        completedOrders: 0,
        cancelledOrders: 0,
        pendingOrders: 0,
      };

      // Calculate average order value
      const avgOrderValue =
        overview.totalOrders > 0
          ? overview.totalRevenue / overview.totalOrders
          : 0;

      res.json({
        period,
        overview: {
          ...overview,
          avgOrderValue: Math.round(avgOrderValue * 100) / 100,
        },
        topProducts: result.topProducts,
        revenueByDay: result.revenueByDay,
        paymentMethods: result.paymentMethods,
      });
    } catch (e) {
      console.error("seller analytics error", e);
      res.status(500).json({ error: "failed to fetch analytics" });
    }
  }

  // ========================================
  // ANALYTICS EXPORT (CSV)
  // ========================================

  /**
   * GET /api/seller/analytics/export
   * Export analytics as CSV
   * Query params:
   *   - period: 'today' | 'week' | 'month' | 'year' | 'all'
   */
  async exportAnalytics(req, res) {
    try {
      const sellerId = req.sellerId;
      const period = req.query.period || "month";

      // Calculate date range (same logic as analytics endpoint)
      const now = new Date();
      let startDate;
      switch (period) {
        case "today":
          startDate = new Date(now.setHours(0, 0, 0, 0));
          break;
        case "week":
          startDate = new Date(now.setDate(now.getDate() - 7));
          break;
        case "month":
          startDate = new Date(now.setMonth(now.getMonth() - 1));
          break;
        case "year":
          startDate = new Date(now.setFullYear(now.getFullYear() - 1));
          break;
        case "all":
          startDate = new Date(0);
          break;
        default:
          startDate = new Date(now.setMonth(now.getMonth() - 1));
      }

      // Get orders
      const orders = await Order.find({
        seller_id: new mongoose.Types.ObjectId(sellerId),
        created_at: { $gte: startDate },
      })
        .sort({ created_at: -1 })
        .lean();

      // Generate CSV
      let csv = "Order ID,Date,Customer,Items,Amount,Payment Method,Status\n";

      for (const order of orders) {
        const orderId = String(order._id).slice(-8);
        const date = new Date(order.created_at).toISOString().split("T")[0];
        const customer = order.client_id || "N/A";
        const itemCount = order.order_items?.length || 0;
        const amount = order.payment?.amount || 0;
        const method = order.payment?.method || "N/A";
        const status =
          order.status || order.delivery?.delivery_status || "pending";

        csv += `${orderId},${date},${customer},${itemCount},${amount},${method},${status}\n`;
      }

      // Set headers for CSV download
      const filename = `analytics_${period}_${Date.now()}.csv`;
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(csv);
    } catch (e) {
      console.error("analytics export error", e);
      res.status(500).json({ error: "failed to export analytics" });
    }
  }

  /**
   * GET /api/seller/analytics/stream
   * SSE endpoint for real-time analytics updates
   */
  async analyticsStream(req, res) {
    const sellerId = req.sellerId;

    // Setup SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    // Store client connection
    if (!sellerAnalyticsClients.has(sellerId)) {
      sellerAnalyticsClients.set(sellerId, new Set());
    }
    sellerAnalyticsClients.get(sellerId).add(res);

    // Send initial connection message
    res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

    // Send analytics update every 30 seconds
    const interval = setInterval(async () => {
      try {
        // Quick stats for real-time updates
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const stats = await Order.aggregate([
          {
            $match: {
              seller_id: new mongoose.Types.ObjectId(sellerId),
              created_at: { $gte: today },
            },
          },
          {
            $group: {
              _id: null,
              todayRevenue: { $sum: "$payment.amount" },
              todayOrders: { $sum: 1 },
              pendingOrders: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $ne: ["$status", "cancelled"] },
                        { $ne: ["$delivery.delivery_status", "delivered"] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ]);

        const data = stats[0] || {
          todayRevenue: 0,
          todayOrders: 0,
          pendingOrders: 0,
        };

        res.write(
          `data: ${JSON.stringify({
            type: "update",
            data,
            timestamp: new Date(),
          })}\n\n`,
        );
      } catch (error) {
        console.error("SSE analytics update error:", error);
      }
    }, 30000); // Update every 30 seconds

    // Cleanup on connection close
    req.on("close", () => {
      clearInterval(interval);
      const clients = sellerAnalyticsClients.get(sellerId);
      if (clients) {
        clients.delete(res);
        if (clients.size === 0) {
          sellerAnalyticsClients.delete(sellerId);
        }
      }
    });
  }
}

const controller = new AnalyticsController();
// Export for use in other files (legacy: router.broadcastAnalyticsUpdate)
controller.broadcastAnalyticsUpdate = broadcastAnalyticsUpdate;

module.exports = controller;
