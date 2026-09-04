const express = require("express");
const { requireAdmin } = require("../../util/auth");
const AlertsController = require("./AlertsController");

const router = express.Router();

// ---------------- Fraud Detection (Rule-based signals) ----------------
router.get("/fraud/signals", requireAdmin, AlertsController.fraudSignals);

// ---------------- Automated Alerts ----------------
router.post("/alerts/evaluate", requireAdmin, AlertsController.evaluate);
router.get("/alerts", requireAdmin, AlertsController.list);
router.post("/alerts/:id/ack", requireAdmin, AlertsController.ack);

module.exports = router;
