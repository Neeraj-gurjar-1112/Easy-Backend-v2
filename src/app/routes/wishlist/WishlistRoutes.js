const express = require("express");
// JWT auth middleware (legacy name kept: it replaced the old Firebase verifier)
const verifyFirebaseToken = require("@middleware/auth");
const WishlistController = require("./WishlistController");

const router = express.Router();

// POST /api/wishlist - Add product to wishlist
router.post("/", verifyFirebaseToken, WishlistController.add);

// GET /api/wishlist - Get user's wishlist
router.get("/", verifyFirebaseToken, WishlistController.list);

// GET /api/wishlist/check/:productId - Check if product is in wishlist
router.get("/check/:productId", verifyFirebaseToken, WishlistController.check);

// DELETE /api/wishlist/:productId - Remove from wishlist
router.delete("/:productId", verifyFirebaseToken, WishlistController.remove);

// DELETE /api/wishlist - Clear entire wishlist
router.delete("/", verifyFirebaseToken, WishlistController.clear);

module.exports = router;
