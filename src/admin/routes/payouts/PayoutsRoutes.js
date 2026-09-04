const express = require("express");
const { requireAdmin } = require("../../util/auth");
const PayoutsController = require("./PayoutsController");

const router = express.Router();

// ---------------- Payouts (aggregate with pagination metadata) ----------------
router.get("/payouts", requireAdmin, PayoutsController.list);

// ---------------- Payouts / Earnings Overview ----------------
// GET /api/admin/payouts/summary?sellerId=&from=&to=
router.get("/payouts/summary", requireAdmin, PayoutsController.summary);

// Detailed payout logs for drill-down (seller/delivery earnings)
// GET /api/admin/payouts/logs?role=seller|delivery&sellerId=&agentId=&from=&to=&paid=true|false&page=&limit=
router.get("/payouts/logs", requireAdmin, PayoutsController.logs);

// Toggle payout log paid flag (admin reconciliation)
// PATCH /api/admin/payouts/logs/:id/paid { paid: true|false }
router.patch("/payouts/logs/:id/paid", requireAdmin, PayoutsController.markPaid);

// GET /api/admin/earning-logs - List earning logs with filtering by sellerId
router.get("/earning-logs", requireAdmin, PayoutsController.earningLogs);

module.exports = router;
