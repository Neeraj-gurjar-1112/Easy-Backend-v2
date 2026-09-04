/**
 * Admin route table. Every module router is mounted at the /api/admin root
 * (module paths are heterogeneous, e.g. campaigns/ also owns /device-tokens and /test-push).
 * adminLimiter + logRequest apply to ALL admin routes including /login; requireAdmin is per-route.
 */
const express = require("express");
const { adminLimiter, logRequest } = require("../util/middleware");

const router = express.Router();
const admin = express.Router();

admin.use(adminLimiter);
admin.use(logRequest);

const modules = [
  "auth",
  "dashboard",
  "alerts",
  "clients",
  "sellers",
  "products",
  "orders",
  "delivery-agents",
  "payouts",
  "coupons",
  "settings",
  "roles",
  "campaigns",
  "feedback",
  "migrations",
  "backup",
  "stream",
];

for (const name of modules) {
  admin.use(require(`./${name}`));
}

router.use("/api/admin", admin);

module.exports = router;
