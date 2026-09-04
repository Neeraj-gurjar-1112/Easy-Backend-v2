const { PlatformSettings } = require("@models");

class SettingsController {
  // ---------------- Settings & Roles ----------------
  async get(req, res) {
    try {
      const settings = await PlatformSettings.findOne().lean();
      if (!settings)
        return res.json({
          currency_symbol: "₹",
          locale: "en_IN",
          low_stock_threshold: 5,
          order_status_notifications: true,
          delivery_charge_grocery: 30,
          delivery_charge_food: 40,
          min_total_for_delivery_charge: 100,
          free_delivery_threshold: 0,
          free_delivery_admin_compensation: false,
          free_delivery_agent_payment: 0,
          coupons: [],
        });
      res.json(settings);
    } catch (e) {
      console.error("admin settings get error", e);
      res.status(500).json({ error: "failed to get settings" });
    }
  }

  async update(req, res) {
    try {
      // Sanitize coupons payload if provided
      const update = { ...req.body, updated_at: new Date() };
      // Coerce numeric settings
      if (update.delivery_charge_grocery !== undefined) {
        update.delivery_charge_grocery = Math.max(
          0,
          Number(update.delivery_charge_grocery) || 0,
        );
      }
      if (update.delivery_charge_food !== undefined) {
        update.delivery_charge_food = Math.max(
          0,
          Number(update.delivery_charge_food) || 0,
        );
      }
      if (update.min_total_for_delivery_charge !== undefined) {
        update.min_total_for_delivery_charge = Math.max(
          0,
          Number(update.min_total_for_delivery_charge) || 0,
        );
      }
      if (update.free_delivery_threshold !== undefined) {
        update.free_delivery_threshold = Math.max(
          0,
          Number(update.free_delivery_threshold) || 0,
        );
      }
      if (update.free_delivery_agent_payment !== undefined) {
        update.free_delivery_agent_payment = Math.max(
          0,
          Number(update.free_delivery_agent_payment) || 0,
        );
      }
      if (update.free_delivery_admin_compensation !== undefined) {
        update.free_delivery_admin_compensation = Boolean(
          update.free_delivery_admin_compensation,
        );
      }
      if (update.low_stock_threshold !== undefined) {
        update.low_stock_threshold = Math.max(
          0,
          parseInt(update.low_stock_threshold) || 0,
        );
      }
      if (Array.isArray(update.coupons)) {
        update.coupons = update.coupons
          .filter((c) => c && typeof c.code === "string" && c.code.trim())
          .map((c) => ({
            code: String(c.code).toUpperCase().trim(),
            percent: Math.max(0, Math.min(100, Number(c.percent) || 0)),
            active: c.active !== false,
            minSubtotal: Math.max(0, Number(c.minSubtotal || 0)),
            validFrom: c.validFrom ? new Date(c.validFrom) : undefined,
            validTo: c.validTo ? new Date(c.validTo) : undefined,
            categories: Array.isArray(c.categories)
              ? c.categories
                  .map((v) =>
                    String(v || "")
                      .toLowerCase()
                      .trim(),
                  )
                  .filter((v) => ["grocery", "vegetable", "food"].includes(v))
              : undefined,
          }));
      }
      const doc = await PlatformSettings.findOneAndUpdate(
        {},
        { $set: update },
        { new: true, upsert: true },
      );
      res.json(doc);
    } catch (e) {
      console.error("admin settings update error", e);
      res.status(500).json({ error: "failed to update settings" });
    }
  }
}

module.exports = new SettingsController();
