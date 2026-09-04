const express = require("express");
const { requireAdmin } = require("../../util/auth");
const DeliveryAgentsController = require("./DeliveryAgentsController");

const router = express.Router();

// ---------------- Extended Admin: Delivery Agents ----------------
// Route order matches the legacy file: /pending stays registered before /:id.
router.get("/delivery-agents", requireAdmin, DeliveryAgentsController.list);
router.get("/delivery-agents/pending", requireAdmin, DeliveryAgentsController.pending);
router.patch("/delivery-agents/:id/approve", requireAdmin, DeliveryAgentsController.approve);
router.patch("/delivery-agents/:id/reject", requireAdmin, DeliveryAgentsController.reject);
router.get("/delivery-agents/:id", requireAdmin, DeliveryAgentsController.getOne);
router.patch("/delivery-agents/:id", requireAdmin, DeliveryAgentsController.update);

// Delivery Agents full deletion
router.delete("/delivery-agents/:id", requireAdmin, DeliveryAgentsController.remove);

module.exports = router;
