const { Feedback } = require("@models");
const mongoose = require("mongoose");

class EarningsController {
  // ---------------- Seller Feedback & Earnings (appended endpoints) ----------------
  // Create feedback from seller perspective. Uses sellerId as user_id to keep traceable.
  // POST /:sellerId/feedback
  async createFeedback(req, res) {
    try {
      const { sellerId } = req.params;
      const { message, type } = req.body || {};
      if (!sellerId || !mongoose.isValidObjectId(sellerId)) {
        return res.status(400).json({ error: "valid sellerId required" });
      }
      if (!message || String(message).trim().length < 3) {
        return res
          .status(400)
          .json({ error: "message is required (min 3 chars)" });
      }
      const fb = await Feedback.create({
        user_id: String(sellerId),
        message: String(message).trim(),
        ...(type ? { type } : {}),
      });
      res.status(201).json(fb);
    } catch (e) {
      console.error("seller feedback create error", e);
      res.status(500).json({ error: "failed to submit feedback" });
    }
  }

  // List feedback created by this seller
  // GET /:sellerId/feedback
  async listFeedback(req, res) {
    try {
      const { sellerId } = req.params;
      if (!sellerId || !mongoose.isValidObjectId(sellerId)) {
        return res.status(400).json({ error: "valid sellerId required" });
      }
      const page = Math.max(parseInt(req.query.page) || 1, 1);
      const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
      const skip = (page - 1) * limit;
      const [total, rows] = await Promise.all([
        Feedback.countDocuments({ user_id: String(sellerId) }),
        Feedback.find({ user_id: String(sellerId) })
          .sort({ created_at: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
      ]);
      res.json({ page, limit, total, rows });
    } catch (e) {
      console.error("seller feedback list error", e);
      res.status(500).json({ error: "failed to list feedback" });
    }
  }

  // Seller earnings summary
  // Computes totals from delivered orders containing seller's items.
  // GET /:sellerId/earnings/summary
  async earningsSummary(req, res) {
    try {
      const { sellerId } = req.params;
      if (!sellerId || !mongoose.isValidObjectId(sellerId)) {
        return res.status(400).json({ error: "valid sellerId required" });
      }
      // Optional date filters
      const from = req.query.from ? new Date(req.query.from) : null;
      const to = req.query.to ? new Date(req.query.to) : null;

      const sellerObjectId = new mongoose.Types.ObjectId(sellerId);

      // Load settings for commission rate reference
      const { PlatformSettings, EarningLog } = require("@models");
      const settings = (await PlatformSettings.findOne().lean()) || {};
      const commissionRate = Number(settings.platform_commission_rate ?? 0.1);

      const match = { role: "seller", seller_id: sellerObjectId };
      if (from || to) {
        match.created_at = {};
        if (from && !isNaN(from)) match.created_at.$gte = from;
        if (to && !isNaN(to)) match.created_at.$lte = to;
      }

      const agg = await EarningLog.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            item_total: { $sum: "$item_total" },
            platform_commission: { $sum: "$platform_commission" },
            seller_net: { $sum: "$net_earning" },
            orders_count: { $sum: 1 }
          }
        }
      ]);

      const base = agg[0] || {
        item_total: 0,
        platform_commission: 0,
        seller_net: 0,
        orders_count: 0
      };

      res.json({
        from: from || null,
        to: to || null,
        orders_count: base.orders_count,
        item_total: +(base.item_total).toFixed(2),
        platform_commission_rate: commissionRate,
        platform_commission: +(base.platform_commission).toFixed(2),
        seller_net: +(base.seller_net).toFixed(2),
      });
    } catch (e) {
      console.error("seller earnings summary error", e);
      res.status(500).json({ error: "failed to compute earnings" });
    }
  }

  // Seller earnings logs (history)
  // GET /:sellerId/earnings/logs
  async earningsLogs(req, res) {
    try {
      const { sellerId } = req.params;
      if (!sellerId || !mongoose.isValidObjectId(sellerId)) {
        return res.status(400).json({ error: "valid sellerId required" });
      }
      const { from, to } = req.query;
      const page = Math.max(parseInt(req.query.page) || 1, 1);
      const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
      const skip = (page - 1) * limit;
      const { EarningLog } = require("@models");
      const q = { role: "seller", seller_id: sellerId };
      if (from || to) {
        q.created_at = {};
        if (from) q.created_at.$gte = new Date(from);
        if (to) q.created_at.$lte = new Date(to);
      }
      const [items, total] = await Promise.all([
        EarningLog.find(q)
          .sort({ created_at: -1, _id: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        EarningLog.countDocuments(q),
      ]);
      res.json({ page, limit, total, items });
    } catch (e) {
      console.error("seller earnings logs error", e);
      res.status(500).json({ error: "failed to fetch earnings logs" });
    }
  }
}

module.exports = new EarningsController();
