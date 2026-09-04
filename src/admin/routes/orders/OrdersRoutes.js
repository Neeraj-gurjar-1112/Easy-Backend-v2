const express = require("express");
const { requireAdmin } = require("../../util/auth");
const OrdersController = require("./OrdersController");

const router = express.Router();

// -------- One-off repair: fix a specific order's delivery address coords --------
router.post("/orders/:orderId/fix-address", requireAdmin, OrdersController.fixAddress);

// Get available delivery agents for an order with distance calculation
router.get("/orders/:orderId/available-agents", requireAdmin, OrdersController.availableAgents);

// Manual delivery agent assignment (fallback when auto-assignment fails)
router.post("/orders/:orderId/assign-delivery-agent", requireAdmin, OrdersController.assignDeliveryAgent);

// ---------------- Orders ----------------
router.get("/orders", requireAdmin, OrdersController.list);

router.patch("/orders/:id/payment", requireAdmin, OrdersController.payment);
router.patch("/orders/:id/delivery", requireAdmin, OrdersController.delivery);

// Admin cancel order
router.post("/orders/:id/cancel", requireAdmin, OrdersController.cancel);

// Admin delete order
router.delete("/orders/:id", requireAdmin, OrdersController.remove);

// ---------------- ORDER MANAGEMENT ----------------
router.put("/orders/:id", requireAdmin, OrdersController.update);

module.exports = router;
