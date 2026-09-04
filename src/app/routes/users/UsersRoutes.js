const express = require("express");
const UsersController = require("./UsersController");

const router = express.Router();

// GET /api/users/:uid/addresses - Get all addresses for a user
router.get("/:uid/addresses", UsersController.listAddresses);

// POST /api/users/:uid/addresses - Add new address
router.post("/:uid/addresses", UsersController.createAddress);

// PUT /api/users/:uid/addresses/:addressId - Update address
router.put("/:uid/addresses/:addressId", UsersController.updateAddress);

// DELETE /api/users/:uid/addresses/:addressId - Delete address
router.delete("/:uid/addresses/:addressId", UsersController.deleteAddress);

// GET /api/users/:uid/profile - Get user profile
router.get("/:uid/profile", UsersController.getProfile);

// PUT /api/users/:uid/profile - Update user profile
router.put("/:uid/profile", UsersController.updateProfile);

// PUT /api/users/preferences - Update notification preferences
router.put("/preferences", UsersController.updatePreferences);

// GET /api/users/:uid/orders - Get user order history
router.get("/:uid/orders", UsersController.listOrders);

// ---------------- FEEDBACK (User-submitted) ----------------
// POST /api/users/:uid/feedback - Create a feedback/support ticket
// (registered after `module.exports = router` in the legacy file; same router instance, so it was live)
router.post("/:uid/feedback", UsersController.createFeedback);

module.exports = router;
