/**
 * Cart controller (mount: /api/cart). Handlers copied verbatim from the legacy
 * routes/cart.js.
 */
const { Cart } = require("@models");

class CartController {
  // GET /:uid
  async getCart(req, res) {
    try {
      const { uid } = req.params;
      const cart = await Cart.findOne({ user_id: uid }).lean();
      if (!cart) return res.json([]); // empty cart
      return res.json(cart.items || []);
    } catch (err) {
      console.error("Cart GET error:", err);
      res.status(500).json({ message: "Failed to fetch cart" });
    }
  }

  // PUT /:uid  { items: [ { product_id, name, price, qty, seller_id? } ] }
  async saveCart(req, res) {
    try {
      const { uid } = req.params;
      const { items } = req.body || {};
      if (!Array.isArray(items)) {
        return res.status(400).json({ message: "Invalid items array" });
      }
      const sanitized = items
        .map((it) => ({
          product_id: String(it.product_id),
          name: it.name ? String(it.name) : undefined,
          price: Number(it.price) || 0,
          qty: Number(it.qty) || 0,
          seller_id: it.seller_id ? String(it.seller_id) : undefined,
        }))
        .filter((it) => it.qty > 0 && it.product_id);

      const updated = await Cart.findOneAndUpdate(
        { user_id: uid },
        { user_id: uid, items: sanitized, updated_at: new Date() },
        { new: true, upsert: true }
      ).lean();
      res.json({ ok: true, count: updated.items.length });
    } catch (err) {
      console.error("Cart PUT error:", err);
      res.status(500).json({ message: "Failed to save cart" });
    }
  }
}

module.exports = new CartController();
