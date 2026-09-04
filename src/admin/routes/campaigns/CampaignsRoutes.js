const express = require("express");
const { requireAdmin } = require("../../util/auth");
const CampaignsController = require("./CampaignsController");

const router = express.Router();

// ---------------- Device Tokens & Test Push ----------------
// GET /api/admin/device-tokens?userId=...&email=...&limit=50
router.get("/device-tokens", requireAdmin, CampaignsController.deviceTokens);

// Quick debug: list device tokens for a client Firebase UID
router.get("/device-tokens/by-client", requireAdmin, CampaignsController.deviceTokensByClient);

// POST /api/admin/test-push { token? , userId? , email? , title? , body? , route? , data? }
router.post("/test-push", requireAdmin, CampaignsController.testPush);

// ---------------- Extended Admin: Notification Campaigns ----------------
router.get("/campaigns", requireAdmin, CampaignsController.list);
router.post("/campaigns", requireAdmin, CampaignsController.create);
router.patch("/campaigns/:id", requireAdmin, CampaignsController.update);

module.exports = router;
