const express = require("express");
// JWT auth middleware (legacy name kept: it replaced the old Firebase verifier)
const verifyFirebaseToken = require("@middleware/auth");
const ReviewsController = require("./ReviewsController");

const router = express.Router();

// POST /api/reviews - Add a new review
router.post("/", verifyFirebaseToken, ReviewsController.create);

// GET /api/reviews/product/:productId - Get reviews for a product
router.get("/product/:productId", ReviewsController.listByProduct);

// GET /api/reviews/user - Get user's reviews
router.get("/user", verifyFirebaseToken, ReviewsController.listByUser);

// PUT /api/reviews/:reviewId - Update a review
router.put("/:reviewId", verifyFirebaseToken, ReviewsController.update);

// DELETE /api/reviews/:reviewId - Delete a review
router.delete("/:reviewId", verifyFirebaseToken, ReviewsController.remove);

// POST /api/reviews/:reviewId/helpful - Mark review as helpful
router.post("/:reviewId/helpful", verifyFirebaseToken, ReviewsController.markHelpful);

module.exports = router;
