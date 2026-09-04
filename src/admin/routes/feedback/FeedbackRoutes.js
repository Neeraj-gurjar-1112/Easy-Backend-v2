const express = require("express");
const { requireAdmin } = require("../../util/auth");
const FeedbackController = require("./FeedbackController");

const router = express.Router();

// ---------------- Extended Admin: Feedback Tickets ----------------
router.get("/feedback", requireAdmin, FeedbackController.list);
router.post("/feedback", requireAdmin, FeedbackController.create);
router.patch("/feedback/:id", requireAdmin, FeedbackController.update);

module.exports = router;
