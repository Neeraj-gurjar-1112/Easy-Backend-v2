/**
 * Delivery agent routes. Mounted at /api/delivery by src/app/routes/index.js.
 * Route order is identical to the legacy routes/delivery.js.
 */
const express = require("express");
const AgentController = require("./AgentController");
const OrdersController = require("./OrdersController");
const EarningsController = require("./EarningsController");
const RouteController = require("./RouteController");
const MaintenanceController = require("./MaintenanceController");
const { requireAdmin } = require("./helpers");

const router = express.Router();

router.get("/check-availability", AgentController.checkAvailability);
router.get("/pending-orders/:agentId", OrdersController.pendingOrders);
router.get("/offers/:agentId", OrdersController.offers);
router.get("/assigned-orders/:agentId", OrdersController.assignedOrders);
router.get("/history/:agentId", OrdersController.history);
router.post("/accept-order", OrdersController.acceptOrder);
router.post("/reject-order", OrdersController.rejectOrder);
router.post("/force-reassign/:orderId", requireAdmin, OrdersController.forceReassign);
router.post("/update-status", OrdersController.updateStatus);
router.put("/mark-delivered/:orderId", OrdersController.markDelivered);
router.post("/update-location", AgentController.updateLocation);
router.post("/toggle-availability", AgentController.toggleAvailability);
router.get("/profile/:agentId", AgentController.getProfile);
router.get("/:agentId/earnings/summary", EarningsController.summary);
router.get("/:agentId/earnings/breakdown", EarningsController.breakdown);
router.post("/:agentId/route/optimize", RouteController.optimize);
router.post("/logout", AgentController.logout);
router.get("/:agentId/earnings/logs", EarningsController.logs);
router.post("/check-timeouts", MaintenanceController.checkTimeouts);
router.post("/retry-pending-orders", MaintenanceController.retryPendingOrders);

module.exports = router;
