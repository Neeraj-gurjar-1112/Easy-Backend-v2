const express = require("express");
const {
  validate,
  sanitize,
  createOrderSchema,
} = require("@middleware/validation");
const OrdersController = require("./OrdersController");

const router = express.Router();

// Create new order (COD-only) - with validation
router.post("/", sanitize, validate(createOrderSchema), OrdersController.createOrder);

// Get order status
router.get("/:id/status", OrdersController.getStatus);

// Admin enriched detail: snapshot + earnings/commission breakdown
router.get("/:id/admin-detail", OrdersController.adminDetail);

// Admin verifies payment result
router.post("/:id/verify", OrdersController.verifyPayment);

// Order history for a client (recent orders)
router.get("/history/:clientId", OrdersController.getHistory);

// Update delivery status & ETA (temporary open endpoint)
router.patch("/:id/delivery", OrdersController.updateDelivery);

// SSE stream for live order updates
router.get("/:id/stream", OrdersController.stream);

// Cancel order endpoint (COD only, no refunds)
router.post("/:orderId/cancel", OrdersController.cancel);

module.exports = router;
