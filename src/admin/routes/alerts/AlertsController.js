const mongoose = require("mongoose");
const { Order, Alert } = require("@models");
const { parsePagination, parseDateRange } = require("../../util/helpers");

class AlertsController {
  // ---------------- Fraud Detection (Rule-based signals) ----------------
  async fraudSignals(req, res) {
    try {
      const { from, to } = parseDateRange(req, { defaultDays: 7 });
      const windowMatch = { created_at: { $gte: from, $lte: to } };
      const orders = await Order.find(windowMatch)
        .select("client_id payment status created_at coupon_code")
        .lean();
      const byClient = new Map();
      for (const o of orders) {
        const cid = o.client_id;
        if (!byClient.has(cid)) byClient.set(cid, []);
        byClient.get(cid).push(o);
      }
      const signals = [];
      for (const [cid, list] of byClient.entries()) {
        const sorted = list.sort(
          (a, b) => new Date(a.created_at) - new Date(b.created_at),
        );
        // Rapid fire: >=3 orders within 10 minutes
        for (let i = 0; i < sorted.length - 2; i++) {
          const a = sorted[i],
            b = sorted[i + 2];
          if (new Date(b.created_at) - new Date(a.created_at) < 10 * 60 * 1000) {
            signals.push({
              type: "rapid_orders",
              client_id: cid,
              window: [a.created_at, b.created_at],
              count: 3,
            });
            break;
          }
        }
        // High-value COD (amount > 2000 and method COD)
        for (const o of sorted) {
          if (o.payment?.method === "COD" && o.payment.amount > 2000) {
            signals.push({
              type: "high_cod_amount",
              client_id: cid,
              order_id: o._id,
              amount: o.payment.amount,
            });
          }
        }
        // Refund rate (>40% refunded of window orders)
        const refunded = sorted.filter(
          (o) => o.status === "refunded" || o.payment?.status === "failed",
        );
        if (refunded.length >= 2 && refunded.length / sorted.length > 0.4) {
          signals.push({
            type: "high_refund_rate",
            client_id: cid,
            refunded: refunded.length,
            total: sorted.length,
          });
        }
      }
      res.json({ from, to, totalSignals: signals.length, signals });
    } catch (e) {
      console.error("admin fraud signals error", e);
      res.status(500).json({ message: "Failed to build fraud signals" });
    }
  }

  // ---------------- Automated Alerts ----------------
  async evaluate(req, res) {
    try {
      const { from, to } = parseDateRange(req, { defaultDays: 1 });
      const todayMatch = {
        created_at: { $gte: from, $lte: to },
        status: { $ne: "cancelled" },
      };
      const prevFrom = new Date(from.getTime() - (to - from) - 1000);
      const prevTo = new Date(from.getTime() - 1000);
      const prevMatch = {
        created_at: { $gte: prevFrom, $lte: prevTo },
        status: { $ne: "cancelled" },
      };
      const [todayAgg, prevAgg] = await Promise.all([
        Order.aggregate([
          { $match: todayMatch },
          {
            $group: {
              _id: null,
              revenue: { $sum: "$payment.amount" },
              orders: { $sum: 1 },
            },
          },
        ]),
        Order.aggregate([
          { $match: prevMatch },
          {
            $group: {
              _id: null,
              revenue: { $sum: "$payment.amount" },
              orders: { $sum: 1 },
            },
          },
        ]),
      ]);
      const todayRevenue = todayAgg[0]?.revenue || 0;
      const prevRevenue = prevAgg[0]?.revenue || 0;
      const alerts = [];
      if (prevRevenue > 0 && todayRevenue < prevRevenue * 0.6) {
        alerts.push({
          type: "revenue_drop",
          severity: "high",
          message: `Revenue dropped ${(
            100 -
            (todayRevenue / prevRevenue) * 100
          ).toFixed(1)}% compared to previous window`,
          meta: { todayRevenue, prevRevenue, from, to },
        });
      }
      const refundedCount = await Order.countDocuments({
        ...todayMatch,
        status: "refunded",
      });
      const todayCount = todayAgg[0]?.orders || 0;
      if (todayCount >= 5 && refundedCount / todayCount > 0.3) {
        alerts.push({
          type: "refund_ratio_high",
          severity: "medium",
          message: `Refund ratio ${((refundedCount / todayCount) * 100).toFixed(
            1,
          )}% exceeds threshold`,
          meta: { refundedCount, todayCount, from, to },
        });
      }
      const created = [];
      for (const a of alerts) {
        const exists = await Alert.findOne({
          type: a.type,
          "meta.from": { $gte: prevFrom },
          acknowledged: false,
        }).lean();
        if (!exists) {
          created.push(await Alert.create(a));
        }
      }
      res.json({
        evaluated: alerts.length,
        created: created.length,
        alerts: created,
      });
    } catch (e) {
      console.error("admin alerts evaluate error", e);
      res.status(500).json({ message: "Failed to evaluate alerts" });
    }
  }

  async list(req, res) {
    try {
      const { page, limit, skip } = parsePagination(req);
      const filter = {};
      if (req.query.unacked === "1") filter.acknowledged = false;
      const [total, rows] = await Promise.all([
        Alert.countDocuments(filter),
        Alert.find(filter)
          .sort({ created_at: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
      ]);
      res.json({ page, limit, total, rows });
    } catch (e) {
      console.error("admin alerts list error", e);
      res.status(500).json({ message: "Failed to list alerts" });
    }
  }

  async ack(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.isValidObjectId(id))
        return res.status(400).json({ error: "invalid alert id" });
      const updated = await Alert.findByIdAndUpdate(
        id,
        { $set: { acknowledged: true, acknowledged_at: new Date() } },
        { new: true },
      );
      if (!updated) return res.status(404).json({ error: "alert not found" });
      res.json(updated);
    } catch (e) {
      console.error("admin alert ack error", e);
      res.status(500).json({ message: "Failed to acknowledge alert" });
    }
  }
}

module.exports = new AlertsController();
