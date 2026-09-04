/**
 * Device token controller (mount: /api/tokens). Handler copied verbatim from
 * the legacy routes/tokens.js.
 */
const { DeviceToken } = require("@models");

class TokensController {
  // POST /register { user_id, token, platform } - Register or refresh a device token
  async register(req, res) {
    try {
      const { user_id, token, platform } = req.body || {};
      if (!user_id || !token)
        return res.status(400).json({ error: "user_id and token required" });

      try {
        await DeviceToken.findOneAndUpdate(
          { user_id, token },
          { $set: { platform, last_seen: new Date() } },
          { new: true, upsert: true }
        );
      } catch (err) {
        // Handle possible legacy unique index on token alone causing E11000 duplicate key
        if (err && err.code === 11000) {
          // Attempt: locate existing token doc (any user) and if different user, just update user_id fallback
          const existing = await DeviceToken.findOne({ token });
          if (existing) {
            if (existing.user_id !== user_id) {
              existing.user_id = user_id; // move token to new user (device switched accounts)
            }
            existing.platform = platform;
            existing.last_seen = new Date();
            await existing.save().catch(() => {});
          }
        } else {
          throw err;
        }
      }
      res.json({ ok: true });
    } catch (e) {
      console.error("token register error", e);
      res.status(500).json({ error: "failed to register token" });
    }
  }
}

module.exports = new TokensController();
