const express = require("express");
const { requireAdmin } = require("../../util/auth");
const AuthController = require("./AuthController");

const router = express.Router();

// Admin login endpoint - generates JWT token
router.post("/login", AuthController.login);

// Change admin password (requires current password verification)
router.put("/change-password", requireAdmin, AuthController.changePassword);

module.exports = router;
