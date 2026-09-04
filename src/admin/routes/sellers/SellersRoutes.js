const express = require("express");
const { requireAdmin } = require("../../util/auth");
const SellersController = require("./SellersController");

const router = express.Router();

// Route order matches the legacy file: /approve is registered before the
// general PATCH /sellers/:id so it keeps winning the match.

// ---------------- Sellers ----------------
router.get("/sellers", requireAdmin, SellersController.list);
router.patch("/sellers/:id/approve", requireAdmin, SellersController.approve);

// ---------------- Seller Address Admin Helpers ----------------
// Get a seller by id (address/location/place_id included)
router.get("/sellers/:sellerId", requireAdmin, SellersController.getOne);

// NOTE: the legacy location-only PATCH /sellers/:sellerId was already commented out
// in the source (Dec 3, 2025); location updates go through PATCH /sellers/:id below.

// Test pickup string resolution for a seller (mirrors delivery endpoints logic)
router.get("/sellers/:sellerId/test-pickup", requireAdmin, SellersController.testPickup);

// Minimal Admin UI page (no auth on HTML; protected JSON calls require Authorization header)
router.get("/ui/sellers", SellersController.uiSellers);

router.delete("/sellers/:id", requireAdmin, SellersController.remove);

// ---------------- SELLER CRUD ----------------
router.post("/sellers", requireAdmin, SellersController.create);
router.put("/sellers/:id", requireAdmin, SellersController.update);

// Backward compatible PATCH for updating seller (frontend calls PATCH)
router.patch("/sellers/:id", requireAdmin, SellersController.patch);

module.exports = router;
