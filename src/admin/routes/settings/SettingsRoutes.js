const express = require("express");
const { requireAdmin } = require("../../util/auth");
const SettingsController = require("./SettingsController");

const router = express.Router();

// ---------------- Settings ----------------
router.get("/settings", requireAdmin, SettingsController.get);
router.put("/settings", requireAdmin, SettingsController.update);

module.exports = router;
