const express = require("express");
const MiscController = require("./MiscController");

const router = express.Router();

router.get("/api/app-version", MiscController.appVersion);
router.get("/api/auth/debug/verify-token", MiscController.debugVerifyToken);

module.exports = router;
