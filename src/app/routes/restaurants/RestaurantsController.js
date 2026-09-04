const { Seller, Product } = require("@models");
const { paginate } = require("@middleware/pagination");

class RestaurantsController {
  // GET /api/restaurants?q=pizza&page=1&limit=20 -> list restaurants with optional search
  async list(req, res) {
    try {
      const { skip, limit, page } = req.pagination;
      const q = req.query && req.query.q ? String(req.query.q).trim() : "";
      const hasQ = q.length > 0;
      const safe = hasQ ? q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "";
      const rx = hasQ ? new RegExp(safe, "i") : null;
      // Strategy: include approved sellers whose business_type already indicates restaurant OR
      // sellers that have at least one active product with category 'Restaurants'.
      const baseSellerFilter = {
        approved: true,
        business_type: { $regex: /restaurant/i },
      };
      if (rx) {
        // Include sellers that match by name/cuisine/description
        baseSellerFilter.$or = [
          { business_name: rx },
          { cuisine: rx },
          { description: rx },
        ];
      }
      const restaurantTypeSellers = await Seller.find(baseSellerFilter).lean();
      const allApproved = await Seller.find({ approved: true })
        .select("_id business_name business_type")
        .lean();
      const approvedIds = allApproved.map((s) => s._id);
      const productFilter = {
        seller_id: { $in: approvedIds },
        category: { $regex: /^Restaurants$/i },
        ...(rx ? { name: { $regex: rx } } : {}),
      };
      const restaurantProducts = await Product.find(productFilter)
        .select("seller_id name price image rating category status stock admin_sort_order")
        .lean();
      const sellersWithRestaurantProductsIds = Array.from(
        new Set(restaurantProducts.map((p) => String(p.seller_id)))
      );
      // Merge seller lists
      const mergedMap = new Map();
      for (const s of restaurantTypeSellers) mergedMap.set(String(s._id), s);
      for (const sid of sellersWithRestaurantProductsIds) {
        if (!mergedMap.has(sid)) {
          // Load full seller doc so description/logo/etc. are available
          const found = await Seller.findById(sid).lean();
          if (found) mergedMap.set(sid, found);
        }
      }
      const mergedSellers = Array.from(mergedMap.values());
      const grouped = mergedSellers.map((s) => ({
        seller_id: s._id,
        name: s.business_name,
        type: s.business_type,
        // Enriched fields for better client cards
        logo_url: s.logo_url || null,
        banner_url: s.banner_url || null,
        cuisine: s.cuisine || null,
        description: s.description || null,
        address: s.address || null,
        // Availability flag (default true if missing)
        is_open: typeof s.is_open === "boolean" ? s.is_open : true,
        // optional: aggregate simple rating from product ratings if present
        rating: (() => {
          const ps = restaurantProducts.filter(
            (p) => String(p.seller_id) === String(s._id)
          );
          const scores = ps.map((p) =>
            typeof p.rating === "number" ? p.rating : Number(p.rating) || 0
          );
          if (scores.length === 0) return null;
          const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
          return Math.round(avg * 10) / 10;
        })(),
        products: restaurantProducts
          .filter((p) => String(p.seller_id) === String(s._id))
          .sort((a, b) => {
            const aActive = a.status === 'active' && (a.stock == null || a.stock > 0) ? 1 : 0;
            const bActive = b.status === 'active' && (b.stock == null || b.stock > 0) ? 1 : 0;
            if (aActive !== bActive) return bActive - aActive;
            return (a.admin_sort_order || 0) - (b.admin_sort_order || 0);
          })
          .slice(0, 5),
      }));

      // Sort sellers by admin_sort_order, then naturally
      grouped.sort((a, b) => {
        const aOrder = mergedMap.get(String(a.seller_id))?.admin_sort_order || 0;
        const bOrder = mergedMap.get(String(b.seller_id))?.admin_sort_order || 0;
        return aOrder - bOrder;
      });

      // Apply pagination
      const total = grouped.length;
      const paginatedSellers = grouped.slice(skip, skip + limit);

      res.json(paginate(paginatedSellers, total, page, limit));
    } catch (err) {
      console.error("restaurants list error:", err);
      res.status(500).json({ message: "Failed to load restaurants" });
    }
  }
}

module.exports = new RestaurantsController();
