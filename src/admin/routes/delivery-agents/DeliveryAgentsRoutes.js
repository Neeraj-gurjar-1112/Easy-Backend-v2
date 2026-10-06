const express = require("express");
const { requireAdmin } = require("../../util/auth");
const DeliveryAgentsController = require("./DeliveryAgentsController");
const {
  createAgentSchema,
  updateAgentSchema,
  listAgentsQuerySchema,
  validateAndClean,
} = require("./DeliveryAgentsValidations");

const router = express.Router();

// ---------------- Extended Admin: Delivery Agents ----------------
// Route order matches the legacy file: fixed paths (/pending, /summary) stay registered before /:id.
router.get(
  "/delivery-agents",
  requireAdmin,
  validateAndClean(listAgentsQuerySchema, "query"),
  DeliveryAgentsController.list,
);
router.get(
  "/delivery-agents/pending",
  requireAdmin,
  DeliveryAgentsController.pending,
);
router.get(
  "/delivery-agents/summary",
  requireAdmin,
  DeliveryAgentsController.summary,
);
router.patch(
  "/delivery-agents/:id/approve",
  requireAdmin,
  DeliveryAgentsController.approve,
);
router.patch(
  "/delivery-agents/:id/reject",
  requireAdmin,
  DeliveryAgentsController.reject,
);
router.get(
  "/delivery-agents/:id",
  requireAdmin,
  DeliveryAgentsController.getOne,
);
router.patch(
  "/delivery-agents/:id",
  requireAdmin,
  validateAndClean(updateAgentSchema),
  DeliveryAgentsController.update,
);

// Admin-side creation (the partner app keeps its own self-signup)
router.post(
  "/delivery-agents",
  requireAdmin,
  validateAndClean(createAgentSchema),
  DeliveryAgentsController.create,
);

// Delivery Agents full deletion
router.delete(
  "/delivery-agents/:id",
  requireAdmin,
  DeliveryAgentsController.remove,
);

module.exports = router;
