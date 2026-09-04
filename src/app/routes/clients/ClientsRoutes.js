const express = require("express");
const verifyToken = require("@middleware/auth");
const {
  upsertClient,
  completeProfile,
  getMe,
  updateMe,
} = require("./ClientsController");

const router = express.Router();

// Apply auth middleware to all client routes
router.use(verifyToken);

// Upsert (create/update) client profile
router.post("/upsert", upsertClient);
router.post("/complete-profile", completeProfile);

// Get user profile
router.get("/me", getMe);

// Update user profile
router.put("/me", updateMe);

module.exports = router;
