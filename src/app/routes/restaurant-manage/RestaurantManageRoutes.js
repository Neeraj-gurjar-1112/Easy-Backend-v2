const express = require("express");
const mongoose = require("mongoose");
const RestaurantManageController = require("./RestaurantManageController");

const router = express.Router();

// Simple seller auth placeholder similar to seller routes
function requireSeller(req, res, next) {
  const sellerId =
    req.query.sellerId || req.body.seller_id || req.headers["x-seller-id"];
  if (!sellerId || !mongoose.isValidObjectId(sellerId)) {
    return res.status(400).json({ error: "valid sellerId required" });
  }
  req.sellerId = sellerId;
  next();
}

// GET current restaurant profile (seller details)
router.get("/me", requireSeller, RestaurantManageController.getMe);

// Update restaurant details
router.put("/me", requireSeller, RestaurantManageController.updateMe);

module.exports = router;
