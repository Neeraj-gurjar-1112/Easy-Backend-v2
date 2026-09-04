/**
 * Wishlist controller (mount: /api/wishlist). Handlers copied verbatim from
 * the legacy routes/wishlist.js. Every route is behind the JWT middleware.
 */
const logger = require("@util/logger");
const { Wishlist, Product } = require("@models");

class WishlistController {
  // POST / - Add product to wishlist
  async add(req, res) {
    try {
      const { product_id } = req.body;
      const client_id = req.user.id;

      if (!product_id) {
        return res.status(400).json({
          success: false,
          message: "Product ID is required",
        });
      }

      // Check if product exists
      const product = await Product.findById(product_id);
      if (!product) {
        return res.status(404).json({
          success: false,
          message: "Product not found",
        });
      }

      // Check if already in wishlist
      const existing = await Wishlist.findOne({ client_id, product_id });
      if (existing) {
        return res.status(400).json({
          success: false,
          message: "Product already in wishlist",
        });
      }

      // Add to wishlist
      const wishlistItem = new Wishlist({
        client_id,
        product_id,
      });

      await wishlistItem.save();

      logger.info(
        `Product ${product_id} added to wishlist for user ${client_id}`
      );

      res.status(201).json({
        success: true,
        message: "Added to wishlist",
        wishlistItem,
      });
    } catch (error) {
      logger.error("Error adding to wishlist:", error);
      res.status(500).json({
        success: false,
        message: "Failed to add to wishlist",
        error: error.message,
      });
    }
  }

  // GET / - Get user's wishlist
  async list(req, res) {
    try {
      const client_id = req.user.id;
      const { page = 1, limit = 20 } = req.query;

      const wishlistItems = await Wishlist.find({ client_id })
        .populate({
          path: "product_id",
          select: "name price image stock status seller_id category description",
          populate: {
            path: "seller_id",
            select: "business_name",
          },
        })
        .sort("-added_at")
        .limit(parseInt(limit))
        .skip((parseInt(page) - 1) * parseInt(limit));

      const total = await Wishlist.countDocuments({ client_id });

      // Filter out items where product no longer exists
      const validItems = wishlistItems.filter((item) => item.product_id);

      res.json({
        success: true,
        wishlist: validItems,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (error) {
      logger.error("Error fetching wishlist:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch wishlist",
        error: error.message,
      });
    }
  }

  // GET /check/:productId - Check if product is in wishlist
  async check(req, res) {
    try {
      const { productId } = req.params;
      const client_id = req.user.id;

      const exists = await Wishlist.findOne({
        client_id,
        product_id: productId,
      });

      res.json({
        success: true,
        inWishlist: !!exists,
      });
    } catch (error) {
      logger.error("Error checking wishlist:", error);
      res.status(500).json({
        success: false,
        message: "Failed to check wishlist",
        error: error.message,
      });
    }
  }

  // DELETE /:productId - Remove from wishlist
  async remove(req, res) {
    try {
      const { productId } = req.params;
      const client_id = req.user.id;

      const result = await Wishlist.findOneAndDelete({
        client_id,
        product_id: productId,
      });

      if (!result) {
        return res.status(404).json({
          success: false,
          message: "Product not found in wishlist",
        });
      }

      logger.info(
        `Product ${productId} removed from wishlist for user ${client_id}`
      );

      res.json({
        success: true,
        message: "Removed from wishlist",
      });
    } catch (error) {
      logger.error("Error removing from wishlist:", error);
      res.status(500).json({
        success: false,
        message: "Failed to remove from wishlist",
        error: error.message,
      });
    }
  }

  // DELETE / - Clear entire wishlist
  async clear(req, res) {
    try {
      const client_id = req.user.id;

      const result = await Wishlist.deleteMany({ client_id });

      logger.info(
        `Cleared wishlist for user ${client_id}, removed ${result.deletedCount} items`
      );

      res.json({
        success: true,
        message: "Wishlist cleared",
        deletedCount: result.deletedCount,
      });
    } catch (error) {
      logger.error("Error clearing wishlist:", error);
      res.status(500).json({
        success: false,
        message: "Failed to clear wishlist",
        error: error.message,
      });
    }
  }
}

module.exports = new WishlistController();
