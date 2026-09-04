const express = require("express");
const { requireAdmin } = require("../../util/auth");
const DashboardController = require("./DashboardController");

const router = express.Router();

// ---------------- Admin Reporting (Advanced) ----------------
// Returns revenue, order count, average order value, top products, daily trend arrays.
router.get("/reporting/overview", requireAdmin, DashboardController.reportingOverview);

// ---------------- Metrics ----------------
router.get("/metrics", requireAdmin, DashboardController.metrics);

module.exports = router;
