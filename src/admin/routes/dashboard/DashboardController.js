const {
  Client,
  Seller,
  Product,
  Order,
  DeliveryAgent,
  EarningLog,
} = require("@models");
const { parseDateRange } = require("../../util/helpers");

class DashboardController {
  // ---------------- Admin Reporting (Advanced) ----------------
  // Returns revenue, order count, average order value, top products, daily trend arrays.
  async reportingOverview(req, res) {
    try {
      const { from, to } = parseDateRange(req, { defaultDays: 30 });
      const matchStage = {
        created_at: { $gte: from, $lte: to },
        status: { $ne: "cancelled" },
      };

      const [agg] = await Order.aggregate([
        { $match: matchStage },
        {
          $facet: {
            core: [
              {
                $group: {
                  _id: null,
                  totalRevenue: { $sum: "$payment.amount" },
                  orderCount: { $sum: 1 },
                  avgValue: { $avg: "$payment.amount" },
                },
              },
            ],
            daily: [
              {
                $group: {
                  _id: {
                    y: { $year: "$created_at" },
                    m: { $month: "$created_at" },
                    d: { $dayOfMonth: "$created_at" },
                  },
                  revenue: { $sum: "$payment.amount" },
                  orders: { $sum: 1 },
                },
              },
              { $sort: { "_id.y": 1, "_id.m": 1, "_id.d": 1 } },
            ],
            topProducts: [
              { $unwind: "$order_items" },
              {
                $group: {
                  _id: "$order_items.product_id",
                  qty: { $sum: "$order_items.qty" },
                  revenue: {
                    $sum: {
                      $multiply: [
                        "$order_items.qty",
                        "$order_items.price_snapshot",
                      ],
                    },
                  },
                },
              },
              { $sort: { revenue: -1 } },
              { $limit: 10 },
            ],
          },
        },
      ]);

      const core =
        agg.core && agg.core[0]
          ? agg.core[0]
          : { totalRevenue: 0, orderCount: 0, avgValue: 0 };
      // Trend arrays (fill missing days)
      const dailyMap = new Map();
      for (const d of agg.daily || []) {
        const key = new Date(d._id.y, d._id.m - 1, d._id.d)
          .toISOString()
          .slice(0, 10);
        dailyMap.set(key, { revenue: d.revenue, orders: d.orders });
      }
      const cursor = new Date(from);
      const trend = [];
      while (cursor <= to) {
        const key = cursor.toISOString().slice(0, 10);
        const val = dailyMap.get(key) || { revenue: 0, orders: 0 };
        trend.push({ date: key, revenue: val.revenue, orders: val.orders });
        cursor.setDate(cursor.getDate() + 1);
      }

      // Enrich top products with names (best effort)
      let enrichedTop = [];
      if (agg.topProducts?.length) {
        const ids = agg.topProducts.map((p) => p._id).filter(Boolean);
        const prodDocs = await Product.find({ _id: { $in: ids } })
          .select("name price seller_id")
          .lean();
        const byId = new Map(prodDocs.map((p) => [String(p._id), p]));
        enrichedTop = agg.topProducts.map((p) => ({
          product_id: p._id,
          name: byId.get(String(p._id))?.name || "Unknown",
          qty: p.qty,
          revenue: p.revenue,
        }));
      }

      res.json({
        range: { from, to },
        metrics: {
          totalRevenue: core.totalRevenue || 0,
          orderCount: core.orderCount || 0,
          averageOrderValue: core.avgValue || 0,
        },
        trend,
        topProducts: enrichedTop,
      });
    } catch (e) {
      console.error("admin reporting overview error", e);
      res.status(500).json({ message: "Failed to build reporting overview" });
    }
  }

  // ---------------- Metrics ----------------
  async metrics(req, res) {
    try {
      console.log("[METRICS] Starting metrics fetch...");
      const [
        ordersCount,
        activeProducts,
        allClients,
        sellersPending,
        allSellers,
        deliveryAgentsCount,
        salesAgg,
        commissionAgg,
        discountAgg,
      ] = await Promise.all([
        Order.estimatedDocumentCount(),
        Product.countDocuments({ status: "active" }),
        Client.find().select("email phone").lean(),
        Seller.countDocuments({ approved: false }),
        Seller.find().select("email phone business_type").lean(),
        DeliveryAgent.estimatedDocumentCount(),
        Order.aggregate([
          { $group: { _id: null, total: { $sum: "$payment.amount" } } },
        ]),
        // Sum platform_commission from earning logs (seller role)
        EarningLog.aggregate([
          { $match: { role: "seller" } },
          { $group: { _id: null, total: { $sum: "$platform_commission" } } },
        ]),
        // Sum applied_discount_amount across orders
        Order.aggregate([
          { $match: { applied_discount_amount: { $gt: 0 } } },
          { $group: { _id: null, total: { $sum: "$applied_discount_amount" } } },
        ]),
      ]);

      console.log(
        `[METRICS] Fetched: ${ordersCount} orders, ${activeProducts} products, ${allClients.length} clients, ${allSellers.length} sellers, ${deliveryAgentsCount} agents`,
      );

      // Build lookup maps for sellers and delivery agents
      const sellerKeys = new Set();
      const restaurantKeys = new Set();
      for (const s of allSellers) {
        const keys = [s.email, s.phone]
          .filter(Boolean)
          .map((k) => String(k).toLowerCase());
        const isRestaurant = /rest/i.test(s.business_type || "");
        for (const k of keys) {
          if (isRestaurant) {
            restaurantKeys.add(k);
          } else {
            sellerKeys.add(k);
          }
        }
      }

      // Count pure clients (not sellers/restaurants/delivery)
      let pureClientsCount = 0;
      for (const c of allClients) {
        const keys = [c.email, c.phone]
          .filter(Boolean)
          .map((k) => String(k).toLowerCase());
        const isSeller = keys.some(
          (k) => sellerKeys.has(k) || restaurantKeys.has(k),
        );
        if (!isSeller) {
          pureClientsCount++;
        }
      }

      const totalSales = salesAgg.length ? salesAgg[0].total : 0;
      const platformCommission = commissionAgg.length
        ? commissionAgg[0].total
        : 0;
      const totalDiscounts = discountAgg.length ? discountAgg[0].total : 0;

      // Count restaurants vs sellers from allSellers
      let restaurantsCount = 0;
      let sellersCount = 0;
      for (const s of allSellers) {
        if (/rest/i.test(s.business_type || "")) {
          restaurantsCount++;
        } else {
          sellersCount++;
        }
      }

      console.log(
        `[METRICS] Computed: ${pureClientsCount} pure clients, ${restaurantsCount} restaurants, ${sellersCount} sellers`,
      );

      res.json({
        orders: ordersCount,
        active_products: activeProducts,
        clients: pureClientsCount,
        sellers_pending: sellersPending,
        restaurants: restaurantsCount,
        sellers: sellersCount,
        delivery_agents: deliveryAgentsCount,
        total_sales: totalSales,
        platform_commission_total: platformCommission,
        total_discounts_given: totalDiscounts,
      });
    } catch (e) {
      console.error("Error metrics", e);
      console.error("Error stack:", e.stack);
      res.status(500).json({ error: "failed to compute metrics" });
    }
  }
}

module.exports = new DashboardController();
