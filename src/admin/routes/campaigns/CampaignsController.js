const mongoose = require("mongoose");
const { DeviceToken, NotificationCampaign } = require("@models");
const { parsePagination, _resolveUserIdsByEmail } = require("../../util/helpers");

class CampaignsController {
  // GET /api/admin/device-tokens?userId=...&email=...&limit=50
  async deviceTokens(req, res) {
    try {
      const { userId, email } = req.query || {};
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
      let userIds = [];
      if (userId) userIds.push(String(userId));
      if (email) {
        const resolved = await _resolveUserIdsByEmail(email);
        userIds.push(...resolved);
      }
      const filter = userIds.length
        ? { user_id: { $in: Array.from(new Set(userIds)) } }
        : {};
      const rows = await DeviceToken.find(filter)
        .sort({ last_seen: -1 })
        .limit(limit)
        .select("user_id token platform last_seen")
        .lean();
      res.json({ count: rows.length, rows });
    } catch (e) {
      console.error("admin device-tokens error", e);
      res.status(500).json({ error: "failed to list tokens" });
    }
  }

  // Quick debug: list device tokens for a client Firebase UID
  async deviceTokensByClient(req, res) {
    try {
      const uid = (req.query.uid || "").toString();
      if (!uid) return res.status(400).json({ error: "uid required" });
      const rows = await DeviceToken.find({ user_id: uid })
        .sort({ last_seen: -1 })
        .select("user_id token platform last_seen")
        .lean();
      res.json({ count: rows.length, rows });
    } catch (e) {
      res.status(500).json({ error: "failed to list client tokens" });
    }
  }

  // POST /api/admin/test-push { token? , userId? , email? , title? , body? , route? , data? }
  async testPush(req, res) {
    try {
      const adminSdk = global.firebaseAdmin;
      if (!adminSdk || !adminSdk.messaging) {
        return res.status(503).json({ error: "Firebase Admin not initialized" });
      }
      const { token, userId, email } = req.body || {};
      let tokens = [];
      if (token) tokens.push(String(token));
      if ((userId && !token) || (email && !token)) {
        let userIds = [];
        if (userId) userIds.push(String(userId));
        if (email) {
          const resolved = await _resolveUserIdsByEmail(email);
          userIds.push(...resolved);
        }
        if (userIds.length) {
          const rows = await DeviceToken.find({
            user_id: { $in: Array.from(new Set(userIds)) },
          })
            .sort({ last_seen: -1 })
            .limit(500)
            .select("token")
            .lean();
          tokens = rows.map((r) => r.token);
        }
      }
      tokens = Array.from(new Set(tokens));
      if (!tokens.length)
        return res.status(404).json({ error: "no tokens found" });

      const title = req.body?.title || "Easy App Test";
      const body = req.body?.body || "Hello from FCM v1";
      const route = req.body?.route || "/loading";
      const extraData =
        req.body?.data && typeof req.body.data === "object" ? req.body.data : {};

      // Ensure string data for FCM v1
      const data = {
        route,
        type: "test",
        android_channel_id: "orders_updates",
        click_action: "FLUTTER_NOTIFICATION_CLICK",
      };
      for (const [k, v] of Object.entries(extraData))
        data[k] = typeof v === "string" ? v : JSON.stringify(v);

      // Chunk send (<=500 per request)
      const chunks = [];
      for (let i = 0; i < tokens.length; i += 500)
        chunks.push(tokens.slice(i, i + 500));
      let successCount = 0,
        failureCount = 0;
      const results = [];
      for (const chunk of chunks) {
        const message = {
          tokens: chunk,
          notification: { title, body },
          data,
          android: {
            priority: "high",
            notification: {
              channelId: "orders_updates",
              clickAction: "FLUTTER_NOTIFICATION_CLICK",
              sound: "default",
            },
          },
        };
        const resp = await adminSdk.messaging().sendEachForMulticast(message);
        successCount += resp.successCount || 0;
        failureCount += resp.failureCount || 0;
        results.push({
          successCount: resp.successCount,
          failureCount: resp.failureCount,
        });
      }
      res.json({
        ok: true,
        sent: successCount,
        failed: failureCount,
        batches: results.length,
        results,
      });
    } catch (e) {
      console.error("admin test-push error", e);
      res.status(500).json({ error: e?.message || "failed to send test push" });
    }
  }

  // ---------------- Extended Admin: Notification Campaigns ----------------
  async list(req, res) {
    try {
      const { page, limit, skip } = parsePagination(req);
      const filter = {};
      if (req.query.status) filter.status = req.query.status;
      const [total, rows] = await Promise.all([
        NotificationCampaign.countDocuments(filter),
        NotificationCampaign.find(filter)
          .sort({ created_at: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
      ]);
      res.json({ page, limit, total, rows });
    } catch (e) {
      console.error("admin campaigns list error", e);
      res.status(500).json({ error: "failed to list campaigns" });
    }
  }

  async create(req, res) {
    try {
      const { title, message, segment, scheduled_at } = req.body;
      if (!title || !message)
        return res.status(400).json({ error: "title & message required" });
      const doc = await NotificationCampaign.create({
        title,
        message,
        segment,
        scheduled_at,
        status: scheduled_at ? "scheduled" : "draft",
      });
      res.status(201).json(doc);
    } catch (e) {
      console.error("create campaign error", e);
      res.status(500).json({ error: "failed to create campaign" });
    }
  }

  async update(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.isValidObjectId(id))
        return res.status(400).json({ error: "invalid id" });
      const upd = await NotificationCampaign.findByIdAndUpdate(
        id,
        { $set: req.body },
        { new: true },
      );
      if (!upd) return res.status(404).json({ error: "not found" });
      res.json(upd);
    } catch (e) {
      console.error("update campaign error", e);
      res.status(500).json({ error: "failed to update campaign" });
    }
  }
}

module.exports = new CampaignsController();
