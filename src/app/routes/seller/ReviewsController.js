const { Product, Review } = require("@models");

class ReviewsController {
  // ========================================
  // PRODUCT REVIEWS & RATINGS
  // ========================================

  /**
   * GET /api/seller/products/reviews
   * Get all reviews for seller's products
   * Query params:
   *   - productId: (optional) filter by specific product
   *   - page: (default: 1)
   *   - limit: (default: 20)
   */
  async listProductReviews(req, res) {
    try {
      const sellerId = req.sellerId;
      const { productId, page = 1, limit = 20 } = req.query;

      // First, get all seller's products
      const productsQuery = { seller_id: sellerId };
      if (productId) {
        productsQuery._id = productId;
      }
      const sellerProducts = await Product.find(productsQuery)
        .select("_id name")
        .lean();

      if (!sellerProducts.length) {
        return res.json({
          reviews: [],
          page: parseInt(page),
          limit: parseInt(limit),
          total: 0,
          stats: {
            totalReviews: 0,
            averageRating: 0,
            ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
          },
        });
      }

      const productIds = sellerProducts.map((p) => p._id);

      // Get reviews from Review collection
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const [reviews, total, stats] = await Promise.all([
        // Paginated reviews
        Review.find({ product_id: { $in: productIds } })
          .sort({ created_at: -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .populate("product_id", "name image")
          .lean(),

        // Total count
        Review.countDocuments({ product_id: { $in: productIds } }),

        // Rating statistics
        Review.aggregate([
          { $match: { product_id: { $in: productIds } } },
          {
            $facet: {
              overall: [
                {
                  $group: {
                    _id: null,
                    averageRating: { $avg: "$rating" },
                    totalReviews: { $sum: 1 },
                  },
                },
              ],
              distribution: [
                {
                  $group: {
                    _id: "$rating",
                    count: { $sum: 1 },
                  },
                },
              ],
            },
          },
        ]),
      ]);

      // Format statistics
      const overall = stats[0]?.overall[0] || {
        averageRating: 0,
        totalReviews: 0,
      };
      const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      stats[0]?.distribution.forEach((d) => {
        distribution[d._id] = d.count;
      });

      res.json({
        reviews: reviews.map((r) => ({
          _id: r._id,
          rating: r.rating,
          comment: r.comment,
          created_at: r.created_at,
          customer: {
            name: r.client_id?.name || "Anonymous",
            email: r.client_id?.email,
          },
          product: {
            _id: r.product_id?._id,
            name: r.product_id?.name,
            image: r.product_id?.image,
          },
        })),
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        stats: {
          totalReviews: overall.totalReviews,
          averageRating: Math.round((overall.averageRating || 0) * 10) / 10,
          ratingDistribution: distribution,
        },
      });
    } catch (e) {
      console.error("seller product reviews error", e);
      res.status(500).json({ error: "failed to fetch product reviews" });
    }
  }

  // ========================================
  // SELLER REVIEW RESPONSES
  // ========================================

  /**
   * POST /api/seller/reviews/:reviewId/respond
   * Seller responds to a customer review
   */
  async respondToReview(req, res) {
    try {
      const sellerId = req.sellerId;
      const { reviewId } = req.params;
      const { message } = req.body;

      if (!message || message.trim().length === 0) {
        return res.status(400).json({ error: "Response message is required" });
      }

      if (message.length > 500) {
        return res
          .status(400)
          .json({ error: "Response cannot exceed 500 characters" });
      }

      // Find the review
      const review = await Review.findById(reviewId).populate(
        "product_id",
        "seller_id",
      );
      if (!review) {
        return res.status(404).json({ error: "Review not found" });
      }

      // Verify this review is for seller's product
      if (String(review.product_id.seller_id) !== String(sellerId)) {
        return res
          .status(403)
          .json({ error: "You can only respond to reviews for your products" });
      }

      // Add/update seller response
      review.seller_response = {
        message: message.trim(),
        responded_at: new Date(),
        seller_id: sellerId,
      };
      review.updated_at = new Date();

      await review.save();

      res.json({
        success: true,
        review: {
          _id: review._id,
          seller_response: review.seller_response,
        },
      });
    } catch (e) {
      console.error("seller review response error", e);
      res.status(500).json({ error: "failed to respond to review" });
    }
  }

  /**
   * DELETE /api/seller/reviews/:reviewId/respond
   * Delete seller's response to a review
   */
  async deleteReviewResponse(req, res) {
    try {
      const sellerId = req.sellerId;
      const { reviewId } = req.params;

      const review = await Review.findById(reviewId).populate(
        "product_id",
        "seller_id",
      );
      if (!review) {
        return res.status(404).json({ error: "Review not found" });
      }

      // Verify this review is for seller's product
      if (String(review.product_id.seller_id) !== String(sellerId)) {
        return res.status(403).json({
          error: "You can only delete responses for your products",
        });
      }

      // Remove seller response
      review.seller_response = undefined;
      review.updated_at = new Date();

      await review.save();

      res.json({ success: true });
    } catch (e) {
      console.error("delete review response error", e);
      res.status(500).json({ error: "failed to delete response" });
    }
  }
}

module.exports = new ReviewsController();
