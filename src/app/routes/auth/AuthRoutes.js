const express = require("express");
const { validate, sanitize } = require("@middleware/validation");
const { signupSchema, loginSchema } = require("./AuthValidations");
const AuthController = require("./AuthController");

const router = express.Router();

// Client signup - with validation
router.post(
  "/signup/client",
  sanitize,
  validate(signupSchema),
  AuthController.signupClient,
);

// Seller signup
router.post("/signup/seller", AuthController.signupSeller);

// Seller email/password login (for admin-created accounts with password) - with validation
router.post(
  "/login/seller",
  sanitize,
  validate(loginSchema),
  AuthController.loginSeller,
);

// Delivery Agent signup
router.post("/signup/delivery-agent", AuthController.signupDeliveryAgent);

// Delivery Agent email/password login
router.post(
  "/login/delivery-agent",
  sanitize,
  validate(loginSchema),
  AuthController.loginDeliveryAgent,
);

// Universal login or role check by email
router.post("/role-by-email", AuthController.roleByEmail);

// GET endpoint just to check role by email (without logging in)
router.get("/role-by-email", AuthController.getRoleByEmail);

// GET /api/auth/user/me — returns current user from JWT (requires Authorization: Bearer <token>)
router.get("/user/me", AuthController.me);

// Get user by Firebase UID
router.get("/user/:firebase_uid", AuthController.getUserByFirebaseUid);

// Password reset flow for Seller, DeliveryAgent, and Admin (NOT for Clients who use OTP)
router.post("/forgot-password", AuthController.forgotPassword);
router.post("/reset-password", AuthController.resetPassword);

// Logout endpoint — clears device tokens
// (registered after `module.exports = router` in the legacy file; same router instance, so it was live)
router.post("/logout", AuthController.logout);

module.exports = router;
