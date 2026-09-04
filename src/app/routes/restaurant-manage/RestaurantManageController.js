const { Seller } = require("@models");

class RestaurantManageController {
  // GET current restaurant profile (seller details)
  // GET /me
  async getMe(req, res) {
    try {
      const seller = await Seller.findById(req.sellerId).lean();
      if (!seller) return res.status(404).json({ error: "seller not found" });
      return res.json(seller);
    } catch (e) {
      console.error("restaurant get error", e);
      res.status(500).json({ error: "failed to fetch" });
    }
  }

  // Update restaurant details
  // PUT /me
  async updateMe(req, res) {
    try {
      const allowed = [
        "business_name",
        // allow switching business_type between 'restaurant' and others
        "business_type",
        "address",
        "description",
        "cuisine",
        "logo_url",
        "banner_url",
        "opening_hours",
        "location",
        "place_id",
        "delivery_radius_km",
      ];
      const update = {};
      for (const k of allowed) if (k in req.body) update[k] = req.body[k];
      const seller = await Seller.findOneAndUpdate(
        { _id: req.sellerId },
        { $set: update },
        { new: true }
      ).lean();
      if (!seller) return res.status(404).json({ error: "seller not found" });
      return res.json(seller);
    } catch (e) {
      console.error("restaurant update error", e);
      res.status(500).json({ error: "failed to update" });
    }
  }
}

module.exports = new RestaurantManageController();
