const express = require("express");
const { requireAdmin } = require("../../util/auth");
const CouponsController = require("./CouponsController");

const router = express.Router();

// ========================================
// COUPON MANAGEMENT ENDPOINTS
// ========================================

// GET /api/admin/coupons - List all coupons with usage statistics
router.get("/coupons", requireAdmin, CouponsController.list);

// POST /api/admin/coupons - Create a new coupon
router.post("/coupons", requireAdmin, CouponsController.create);

// PUT /api/admin/coupons/:code - Update a coupon
router.put("/coupons/:code", requireAdmin, CouponsController.update);

// DELETE /api/admin/coupons/:code - Delete a coupon
router.delete("/coupons/:code", requireAdmin, CouponsController.remove);

// GET /api/admin/coupons/:code/usage - Get detailed usage statistics for a coupon
router.get("/coupons/:code/usage", requireAdmin, CouponsController.usage);

module.exports = router;
