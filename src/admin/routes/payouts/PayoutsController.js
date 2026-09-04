const mongoose = require("mongoose");
const { Order, PlatformSettings, EarningLog } = require("@models");
const { parsePagination } = require("../../util/helpers");

class PayoutsController {
  // ---------------- Payouts (aggregate with pagination metadata) ----------------
  async list(req, res) {
    try {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
      const search = req.query.search;
      const all = await Order.aggregate([
        { $match: { status: { $in: ["completed", "delivered"] } } },
        {
          $group: {
            _id: "$seller_id",
            total_sales: { $sum: "$payment.amount" },
            orders: { $sum: 1 },
          },
        },
        { $sort: { total_sales: -1 } },
      ]);
      let filtered = all;
      if (search) {
        const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        filtered = all.filter((r) => rx.test(String(r._id)));
      }
      const total = filtered.length;
      const start = (page - 1) * limit;
      const rows = filtered.slice(start, start + limit);
      res.json({ page, limit, total, rows });
    } catch (e) {
      console.error("admin payouts error", e);
      res.status(500).json({ message: "Failed to compute payouts" });
    }
  }

  // ---------------- Payouts / Earnings Overview ----------------
  // GET /api/admin/payouts/summary?sellerId=&from=&to=
  async summary(req, res) {
    try {
      const { sellerId } = req.query;
      const from = req.query.from ? new Date(req.query.from) : null;
      const to = req.query.to ? new Date(req.query.to) : null;
      const match = { "delivery.delivery_status": "delivered" };
      if (from || to) {
        match.created_at = {};
        if (from && !isNaN(from)) match.created_at.$gte = from;
        if (to && !isNaN(to)) match.created_at.$lte = to;
      }

      const settings = (await PlatformSettings.findOne().lean()) || {};
      const commissionRate = Number(settings.platform_commission_rate ?? 0.1);

      const pipeline = [
        { $match: match },
        {
          $lookup: {
            from: "products",
            let: { pids: "$order_items.product_id" },
            pipeline: [
              {
                $match: {
                  $expr: { $in: ["$_id", "$$pids"] },
                },
              },
              { $project: { _id: 1, seller_id: 1 } },
            ],
            as: "prodInfo",
          },
        },
        { $unwind: "$prodInfo" },
        ...(req.query.sellerId
          ? [
              {
                $match: {
                  "prodInfo.seller_id": new mongoose.Types.ObjectId(
                    String(sellerId),
                  ),
                },
              },
            ]
          : []),
        { $unwind: "$order_items" },
        {
          $group: {
            _id: "$prodInfo.seller_id",
            item_total: {
              $sum: {
                $multiply: ["$order_items.price_snapshot", "$order_items.qty"],
              },
            },
            orders: { $addToSet: "$_id" },
          },
        },
        {
          $project: {
            seller_id: "$_id",
            _id: 0,
            item_total: 1,
            orders_count: { $size: "$orders" },
          },
        },
      ];

      const agg = await Order.aggregate(pipeline);
      const rows = agg.map((r) => {
        const platform_commission = +(r.item_total * commissionRate).toFixed(2);
        const seller_net = +(r.item_total - platform_commission).toFixed(2);
        return {
          ...r,
          platform_commission_rate: commissionRate,
          platform_commission,
          seller_net,
        };
      });
      const totals = rows.reduce(
        (acc, r) => {
          acc.item_total += r.item_total;
          acc.platform_commission += r.platform_commission;
          acc.seller_net += r.seller_net;
          acc.orders_count += r.orders_count;
          return acc;
        },
        { item_total: 0, platform_commission: 0, seller_net: 0, orders_count: 0 },
      );
      res.json({ from: from || null, to: to || null, totals, rows });
    } catch (e) {
      console.error("admin payouts summary error", e);
      res.status(500).json({ error: "failed to compute payouts summary" });
    }
  }

  // Detailed payout logs for drill-down (seller/delivery earnings)
  // GET /api/admin/payouts/logs?role=seller|delivery&sellerId=&agentId=&from=&to=&paid=true|false&page=&limit=
  async logs(req, res) {
    try {
      const { page, limit, skip } = parsePagination(req);
      const role =
        String(req.query.role || "seller").toLowerCase() === "delivery"
          ? "delivery"
          : "seller";
      const { sellerId, agentId, from, to, paid } = req.query;

      const filter = { role };
      if (sellerId && mongoose.isValidObjectId(String(sellerId))) {
        filter.seller_id = new mongoose.Types.ObjectId(String(sellerId));
      }
      if (agentId && mongoose.isValidObjectId(String(agentId))) {
        filter.agent_id = new mongoose.Types.ObjectId(String(agentId));
      }
      if (paid === "true" || paid === "1") filter.paid = true;
      if (paid === "false" || paid === "0") filter.paid = { $ne: true };
      if (from || to) {
        const dt = {};
        if (from) {
          const d = new Date(from);
          if (!isNaN(d)) dt.$gte = d;
        }
        if (to) {
          const d = new Date(to);
          if (!isNaN(d)) dt.$lte = d;
        }
        if (Object.keys(dt).length) filter.created_at = dt;
      }

      const [total, rawRows] = await Promise.all([
        EarningLog.countDocuments(filter),
        EarningLog.find(filter)
          .sort({ created_at: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
      ]);

      // Enrich with minimal order info for context
      const orderIds = Array.from(
        new Set(
          rawRows
            .map((r) => (r.order_id ? r.order_id.toString() : null))
            .filter(Boolean),
        ),
      );
      let ordersById = {};
      if (orderIds.length) {
        const orders = await Order.find({ _id: { $in: orderIds } })
          .select(
            "_id created_at delivery.delivery_status payment.method payment.status",
          )
          .lean();
        ordersById = Object.fromEntries(orders.map((o) => [o._id.toString(), o]));
      }

      const rows = rawRows.map((r) => ({
        ...r,
        order: r.order_id ? ordersById[r.order_id.toString()] || null : null,
      }));

      res.json({ page, limit, total, rows });
    } catch (e) {
      console.error("admin payouts logs error", e);
      res.status(500).json({ error: "failed to list payout logs" });
    }
  }

  // Toggle payout log paid flag (admin reconciliation)
  // PATCH /api/admin/payouts/logs/:id/paid { paid: true|false }
  async markPaid(req, res) {
    try {
      const { id } = req.params;
      const { paid } = req.body || {};
      if (!mongoose.isValidObjectId(String(id))) {
        return res.status(400).json({ error: "invalid payout log id" });
      }
      const doc = await EarningLog.findByIdAndUpdate(
        id,
        { $set: { paid: !!paid } },
        { new: true },
      ).lean();
      if (!doc) return res.status(404).json({ error: "payout log not found" });
      res.json({ ok: true, log: doc });
    } catch (e) {
      console.error("admin mark payout paid error", e);
      res.status(500).json({ error: "failed to update payout paid flag" });
    }
  }

  // GET /api/admin/earning-logs - List earning logs with filtering by sellerId
  async earningLogs(req, res) {
    try {
      const { sellerId } = req.query;
      const filter = {};

      if (sellerId && mongoose.isValidObjectId(String(sellerId))) {
        filter.seller_id = new mongoose.Types.ObjectId(String(sellerId));
      }

      const earnings = await EarningLog.find(filter)
        .sort({ created_at: -1 })
        .lean();

      res.json({ earnings });
    } catch (e) {
      console.error("admin earning-logs error", e);
      res.status(500).json({ error: "failed to fetch earning logs" });
    }
  }
}

module.exports = new PayoutsController();
