const mongoose = require("mongoose");
const { Client, Feedback } = require("@models");
const { parsePagination } = require("../../util/helpers");

class FeedbackController {
  // ---------------- Extended Admin: Feedback Tickets ----------------
  async list(req, res) {
    try {
      const { page, limit, skip } = parsePagination(req);
      const filter = {};
      if (req.query.status) filter.status = req.query.status;
      const [total, feedbackRows] = await Promise.all([
        Feedback.countDocuments(filter),
        Feedback.find(filter)
          .sort({ created_at: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
      ]);

      // Populate user details (name, phone) for each feedback
      const rows = await Promise.all(
        feedbackRows.map(async (fb) => {
          try {
            const client = await Client.findOne({ uid: fb.user_id }).lean();
            return {
              ...fb,
              user_name:
                client?.name ||
                client?.full_name ||
                client?.display_name ||
                "Unknown",
              user_phone:
                client?.phone || client?.contact || client?.mobile || null,
              user_email: client?.email || null,
            };
          } catch (err) {
            console.error("Error fetching user for feedback:", err);
            return {
              ...fb,
              user_name: "Unknown",
              user_phone: null,
              user_email: null,
            };
          }
        }),
      );

      res.json({ page, limit, total, rows });
    } catch (e) {
      console.error("admin feedback list error", e);
      res.status(500).json({ error: "failed to list feedback" });
    }
  }

  async create(req, res) {
    try {
      const { user_id, type, message, order_id } = req.body;
      if (!user_id || !message)
        return res.status(400).json({ error: "user_id & message required" });
      const doc = await Feedback.create({ user_id, type, message, order_id });
      res.status(201).json(doc);
    } catch (e) {
      console.error("create feedback error", e);
      res.status(500).json({ error: "failed to create feedback" });
    }
  }

  async update(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.isValidObjectId(id))
        return res.status(400).json({ error: "invalid id" });
      const upd = await Feedback.findByIdAndUpdate(
        id,
        { $set: req.body },
        { new: true },
      );
      if (!upd) return res.status(404).json({ error: "not found" });
      res.json(upd);
    } catch (e) {
      console.error("update feedback error", e);
      res.status(500).json({ error: "failed to update feedback" });
    }
  }
}

module.exports = new FeedbackController();
