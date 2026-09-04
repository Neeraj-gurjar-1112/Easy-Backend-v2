const express = require("express");
const { requireAdmin } = require("../../util/auth");
const StreamController = require("./StreamController");

const router = express.Router();

// Admin SSE stream for real-time order updates
router.get("/stream", requireAdmin, StreamController.stream);

module.exports = router;
