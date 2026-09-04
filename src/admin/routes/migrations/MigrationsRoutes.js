const express = require("express");
const { requireAdmin } = require("../../util/auth");
const MigrationsController = require("./MigrationsController");

const router = express.Router();

// ---------------- Migrations / Backfill Tools ----------------
router.post("/migrations/backfill-locations/start", requireAdmin, MigrationsController.start);
router.get("/migrations/backfill-locations/progress", requireAdmin, MigrationsController.progress);

// Preview count: how many seller/user addresses missing coords (without starting job)
router.get("/migrations/backfill-locations/preview-count", requireAdmin, MigrationsController.previewCount);
router.get("/migrations/backfill-locations/stream", requireAdmin, MigrationsController.stream);
router.post("/migrations/backfill-locations/stop", requireAdmin, MigrationsController.stop);

module.exports = router;
