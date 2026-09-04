/**
 * Reviews controller (mount: /api/reviews). Handlers copied verbatim from the
 * legacy routes/reviews.js.
 */
const logger = require("@util/logger");
const { Review, Product, Order } = require("@models");

class ReviewsController {
  // POST / - Add a new review
  async create(req, res) {
    try {
      const { product_id, rating, comment, images } = req.body;
      const client_id = req.user.id; // From Firebase token

      // Validate required fields
      if (!product_id || !rating) {
        return res.status(400).json({
          success: false,
          message: "Product ID and rating are required",
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

      // Check if user already reviewed this product
      const existingReview = await Review.findOne({ product_id, client_id });
      if (existingReview) {
        return res.status(400).json({
          success: false,
          message: "You have already reviewed this product",
        });
      }

      // Check if user purchased this product (verified purchase)
      const hasPurchased = await Order.findOne({
        client_id,
        "order_items.product_id": product_id,
        "payment.status": "paid",
      });

      // Create review
      const review = new Review({
        product_id,
        client_id,
        rating,
        comment,
        images: images || [],
        verified_purchase: !!hasPurchased,
      });

      await review.save();

      logger.logOrder({
        action: "review_created",
        product_id,
        client_id,
        rating,
      });

      res.status(201).json({
        success: true,
        message: "Review added successfully",
        review,
      });
    } catch (error) {
      logger.error("Error adding review:", error);
      res.status(500).json({
        success: false,
        message: "Failed to add review",
        error: error.message,
      });
    }
  }

  // GET /product/:productId - Get reviews for a product
  async listByProduct(req, res) {
    try {
      const { productId } = req.params;
      const { page = 1, limit = 10, sort = "-created_at" } = req.query;

      const reviews = await Review.find({ product_id: productId })
        .sort(sort)
        .limit(parseInt(limit))
        .skip((parseInt(page) - 1) * parseInt(limit));

      const total = await Review.countDocuments({ product_id: productId });

      // Calculate rating statistics
      const stats = await Review.aggregate([
        { $match: { product_id: productId } },
        {
          $group: {
            _id: null,
            avgRating: { $avg: "$rating" },
            totalReviews: { $sum: 1 },
            rating5: {
              $sum: { $cond: [{ $eq: ["$rating", 5] }, 1, 0] },
            },
            rating4: {
              $sum: { $cond: [{ $eq: ["$rating", 4] }, 1, 0] },
            },
            rating3: {
              $sum: { $cond: [{ $eq: ["$rating", 3] }, 1, 0] },
            },
            rating2: {
              $sum: { $cond: [{ $eq: ["$rating", 2] }, 1, 0] },
            },
            rating1: {
              $sum: { $cond: [{ $eq: ["$rating", 1] }, 1, 0] },
            },
          },
        },
      ]);

      res.json({
        success: true,
        reviews,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit)),
        },
        stats: stats[0] || {
          avgRating: 0,
          totalReviews: 0,
          rating5: 0,
          rating4: 0,
          rating3: 0,
          rating2: 0,
          rating1: 0,
        },
      });
    } catch (error) {
      logger.error("Error fetching reviews:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch reviews",
        error: error.message,
      });
    }
  }

  // GET /user - Get user's reviews
  async listByUser(req, res) {
    try {
      const client_id = req.user.id;
      const { page = 1, limit = 10 } = req.query;

      const reviews = await Review.find({ client_id })
        .populate("product_id", "name image price")
        .sort("-created_at")
        .limit(parseInt(limit))
        .skip((parseInt(page) - 1) * parseInt(limit));

      const total = await Review.countDocuments({ client_id });

      res.json({
        success: true,
        reviews,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (error) {
      logger.error("Error fetching user reviews:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch user reviews",
        error: error.message,
      });
    }
  }

  // PUT /:reviewId - Update a review
  async update(req, res) {
    try {
      const { reviewId } = req.params;
      const { rating, comment, images } = req.body;
      const client_id = req.user.id;

      const review = await Review.findById(reviewId);
      if (!review) {
        return res.status(404).json({
          success: false,
          message: "Review not found",
        });
      }

      // Check ownership
      if (review.client_id !== client_id) {
        return res.status(403).json({
          success: false,
          message: "You can only edit your own reviews",
        });
      }

      // Update fields
      if (rating !== undefined) review.rating = rating;
      if (comment !== undefined) review.comment = comment;
      if (images !== undefined) review.images = images;
      review.updated_at = Date.now();

      await review.save();

      logger.logOrder({
        action: "review_updated",
        review_id: reviewId,
        client_id,
      });

      res.json({
        success: true,
        message: "Review updated successfully",
        review,
      });
    } catch (error) {
      logger.error("Error updating review:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update review",
        error: error.message,
      });
    }
  }

  // DELETE /:reviewId - Delete a review
  async remove(req, res) {
    try {
      const { reviewId } = req.params;
      const client_id = req.user.id;

      const review = await Review.findById(reviewId);
      if (!review) {
        return res.status(404).json({
          success: false,
          message: "Review not found",
        });
      }

      // Check ownership
      if (review.client_id !== client_id) {
        return res.status(403).json({
          success: false,
          message: "You can only delete your own reviews",
        });
      }

      await Review.findByIdAndDelete(reviewId);

      logger.logOrder({
        action: "review_deleted",
        review_id: reviewId,
        client_id,
      });

      res.json({
        success: true,
        message: "Review deleted successfully",
      });
    } catch (error) {
      logger.error("Error deleting review:", error);
      res.status(500).json({
        success: false,
        message: "Failed to delete review",
        error: error.message,
      });
    }
  }

  // POST /:reviewId/helpful - Mark review as helpful
  async markHelpful(req, res) {
    try {
      const { reviewId } = req.params;

      const review = await Review.findById(reviewId);
      if (!review) {
        return res.status(404).json({
          success: false,
          message: "Review not found",
        });
      }

      review.helpful_count += 1;
      await review.save();

      res.json({
        success: true,
        message: "Marked as helpful",
        helpful_count: review.helpful_count,
      });
    } catch (error) {
      logger.error("Error marking review as helpful:", error);
      res.status(500).json({
        success: false,
        message: "Failed to mark review as helpful",
        error: error.message,
      });
    }
  }
}

module.exports = new ReviewsController();
