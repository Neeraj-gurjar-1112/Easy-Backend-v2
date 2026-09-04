const express = require("express");
const { requireAdmin } = require("../../util/auth");
const BackupController = require("./BackupController");

const router = express.Router();

// Manual backup trigger (admin only)
router.post("/trigger-backup", requireAdmin, BackupController.triggerBackup);

// NOTE: unauthenticated in legacy app.js - tighten later
router.post("/backup-now", BackupController.backupNow);

module.exports = router;
