/**
 * Auth controller (mount: /api/auth). Handlers copied verbatim from the legacy
 * routes/auth.js. Client login is OTP-only (see ../otp); these endpoints cover
 * signup, email/password login for seller/agent/admin and password reset.
 */
const {
  Client,
  Seller,
  Admin,
  DeliveryAgent,
  DeviceToken,
} = require("@models");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const logger = require("@util/logger");

// Helper function to get JWT secret with runtime check
function getJwtSecret() {
  const JWT_SECRET = process.env.JWT_SECRET;
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET environment variable not set");
  }
  return JWT_SECRET;
}

/**
 * Verify a phoneVerifiedToken issued by POST /api/auth/otp/verify (partner_signup).
 * Returns the decoded payload or throws on invalid/expired token.
 */
function verifyPhoneVerifiedToken(token) {
  try {
    const decoded = jwt.verify(token, getJwtSecret());
    if (!decoded.phone || decoded.purpose !== 'partner_signup' || !decoded.verified) {
      throw new Error('Invalid phone_verified_token');
    }
    return decoded;
  } catch (err) {
    throw new Error('phone_verified_token is invalid or has expired. Please re-verify your phone number.');
  }
}

class AuthController {
  // POST /signup/client - with validation
  async signupClient(req, res) {
    try {
      const { name, phone } = req.body;

      // Create new client (email field removed from schema Oct 2025)
      const client = new Client({
        name,
        phone,
        otp_verified: true,
      });

      await client.save();
      res.status(201).json({ message: "Client created successfully", client });
    } catch (error) {
      // Only log errors in non-test environments
      if (process.env.NODE_ENV !== "test") {
        console.error("Client signup error:", error);
      }
      res.status(500).json({ error: "Failed to create client" });
    }
  }

  // POST /signup/seller
  async signupSeller(req, res) {
    try {
      const {
        business_name,
        email,
        phone,
        business_type,
        phone_verified_token,  // new: required for self-signup
        password,              // optional: admin-set password
        address,
        location,
        place_id,
      } = req.body;
      const normEmail = String(email || "").toLowerCase().trim();

      // ── Phone ownership verification ───────────────────────────────────────
      // For self-signup flows the client must prove phone ownership via OTP.
      // Admin-created accounts (no phone_verified_token) bypass this check.
      let verifiedPhone = phone;
      if (phone_verified_token) {
        try {
          const decoded = verifyPhoneVerifiedToken(phone_verified_token);
          verifiedPhone = decoded.phone;
        } catch (tokenErr) {
          return res.status(400).json({ error: tokenErr.message });
        }
      }

      // ── Duplicate check ───────────────────────────────────────────────────
      if (normEmail) {
        const existingSeller = await Seller.findOne({ email: normEmail });
        if (existingSeller) {
          return res.status(400).json({ error: "Seller already exists" });
        }
      }

      // ── Location validation ───────────────────────────────────────────────
      const hasLocation =
        location &&
        typeof location === "object" &&
        location.lat !== undefined &&
        location.lng !== undefined;

      if (!address || String(address).trim().length === 0) {
        return res.status(400).json({ error: "Address is required for seller signup" });
      }
      if (!hasLocation) {
        return res.status(400).json({
          error: "Location coordinates (lat/lng) are required. Please select your business location on the map.",
        });
      }

      // ── Create Seller ──────────────────────────────────────────────────────
      const isRestaurant = business_type && /restaurant/i.test(String(business_type));
      const sellerData = {
        business_name,
        email: normEmail || undefined,
        phone: verifiedPhone || phone,
        business_type,
        approved: isRestaurant ? true : false,
        address,
        ...(place_id ? { place_id } : {}),
        ...(password ? { password } : {}),
      };
      if (hasLocation) {
        sellerData.location = {
          lat: Number(location.lat),
          lng: Number(location.lng),
        };
      }
      const seller = new Seller(sellerData);
      await seller.save();

      // Issue a session JWT so the frontend can identify the user immediately
      const token = jwt.sign(
        { id: seller._id.toString(), role: 'seller', email: normEmail },
        getJwtSecret(),
        { expiresIn: process.env.JWT_ACCESS_EXPIRY || '30d' }
      );

      logger.info(`[auth/signup/seller] Seller created: ${seller._id}`);
      return res.status(201).json({ message: "Seller created successfully", seller, token });
    } catch (error) {
      if (process.env.NODE_ENV !== "test") {
        logger.error("Seller signup error:", error);
      }
      if (error.name === "ValidationError") {
        return res.status(400).json({ error: error.message });
      }
      return res.status(500).json({ error: "Failed to create seller" });
    }
  }

  // POST /login/seller - email/password login (for admin-created accounts with password) - with validation
  async loginSeller(req, res) {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: "Email and password required" });
      }
      const seller = await Seller.findOne({
        email: String(email).toLowerCase().trim(),
      });
      if (!seller || !(await seller.comparePassword(password))) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      const token = jwt.sign(
        { id: seller._id, role: "seller", email: seller.email },
        getJwtSecret(),
        { expiresIn: "2h" },
      );
      res.json({ success: true, token, seller });
    } catch (e) {
      console.error("Seller login error:", e);
      res.status(500).json({ error: "Login failed" });
    }
  }

  // POST /signup/delivery-agent
  async signupDeliveryAgent(req, res) {
    try {
      const {
        name,
        email,
        phone,
        phone_verified_token,   // new: required for self-signup
        password,               // optional: set during signup or admin-created
        vehicle_type,
        license_number,
      } = req.body;
      const normEmail = String(email || "").toLowerCase().trim();

      // ── Phone ownership verification ───────────────────────────────────────
      let verifiedPhone = phone;
      if (phone_verified_token) {
        try {
          const decoded = verifyPhoneVerifiedToken(phone_verified_token);
          verifiedPhone = decoded.phone;
        } catch (tokenErr) {
          return res.status(400).json({ error: tokenErr.message });
        }
      }

      // ── Duplicate check ───────────────────────────────────────────────────
      if (normEmail) {
        const existingAgent = await DeliveryAgent.findOne({ email: normEmail });
        if (existingAgent) {
          return res.status(400).json({ error: "Delivery agent already exists" });
        }
      }

      // ── Create DeliveryAgent ──────────────────────────────────────────────
      const agent = new DeliveryAgent({
        name,
        email: normEmail || undefined,
        phone: verifiedPhone || phone,
        ...(password ? { password } : {}),
        vehicle_type,
        license_number,
        approved: false,
      });
      await agent.save();

      logger.info(`[auth/signup/delivery-agent] Agent created: ${agent._id}`);
      return res.status(201).json({ message: "Delivery agent created successfully", agent });
    } catch (error) {
      logger.error("Delivery agent signup error:", error);
      if (error.name === "ValidationError") {
        return res.status(400).json({ error: error.message });
      }
      return res.status(500).json({ error: "Failed to create delivery agent" });
    }
  }

  // POST /login/delivery-agent - email/password login
  async loginDeliveryAgent(req, res) {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: "Email and password required" });
      }
      const agent = await DeliveryAgent.findOne({
        email: String(email).toLowerCase().trim(),
      });
      if (!agent || !(await agent.comparePassword(password))) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      if (!agent.approved) {
        return res.status(403).json({
          error: "Your delivery agent account is pending admin approval.",
        });
      }
      const token = jwt.sign(
        { id: agent._id.toString(), role: "delivery_agent", email: agent.email },
        getJwtSecret(),
        { expiresIn: process.env.JWT_ACCESS_EXPIRY || '30d' }
      );
      return res.json({ success: true, token, agent });
    } catch (e) {
      logger.error("Delivery agent login error:", e);
      return res.status(500).json({ error: "Login failed" });
    }
  }

  // POST /role-by-email - universal login or role check by email
  // Allows the frontend to login an account (seller, admin, delivery) simply by providing email and password
  async roleByEmail(req, res) {
    try {
      const { email, password } = req.body;
      if (!email) {
        return res.status(400).json({ error: "Email is required" });
      }

      const lowerEmail = String(email).toLowerCase().trim();

      // Check Admin
      let user = await Admin.findOne({ email: lowerEmail });
      if (user) {
        if (password && !(await user.comparePassword(password))) {
          return res.status(401).json({ error: "Invalid credentials" });
        }
        const token = jwt.sign(
          { id: user._id, role: "admin", email: user.email },
          getJwtSecret(),
          { expiresIn: "2h" } // admin expiry
        );
        return res.json({ success: true, role: "admin", token, user, admin_id: user._id });
      }

      // Check Seller / Restaurant
      user = await Seller.findOne({ email: lowerEmail });
      if (user) {
        if (password && !(await user.comparePassword(password))) {
          return res.status(401).json({ error: "Invalid credentials" });
        }
        const token = jwt.sign(
          { id: user._id.toString(), role: "seller", email: user.email },
          getJwtSecret(),
          { expiresIn: process.env.JWT_ACCESS_EXPIRY || "30d" }
        );
        const returnRole = user.business_type === "restaurant" ? "restaurant" : "seller";
        return res.json({ success: true, role: returnRole, token, user, seller_id: user._id });
      }

      // Check DeliveryAgent
      user = await DeliveryAgent.findOne({ email: lowerEmail });
      if (user) {
        if (password && !(await user.comparePassword(password))) {
          return res.status(401).json({ error: "Invalid credentials" });
        }
        if (!user.approved) {
          return res.status(403).json({ error: "Your delivery agent account is pending admin approval." });
        }
        const token = jwt.sign(
          { id: user._id.toString(), role: "delivery_agent", email: user.email },
          getJwtSecret(),
          { expiresIn: process.env.JWT_ACCESS_EXPIRY || "30d" }
        );
        return res.json({ success: true, role: "delivery_agent", token, user, delivery_agent_id: user._id });
      }

      return res.status(404).json({ error: "User not found" });

    } catch (error) {
      logger.error("role-by-email login error:", error);
      res.status(500).json({ error: "Login failed" });
    }
  }

  // GET /role-by-email - check role by email (without logging in)
  async getRoleByEmail(req, res) {
    try {
      const email = req.query.email;
      if (!email) {
        return res.status(400).json({ error: "Email query parameter is required" });
      }
      const lowerEmail = String(email).toLowerCase().trim();

      if (await Admin.exists({ email: lowerEmail })) return res.json({ role: "admin" });

      const seller = await Seller.findOne({ email: lowerEmail });
      if (seller) {
         return res.json({ role: seller.business_type === "restaurant" ? "restaurant" : "seller" });
      }

      if (await DeliveryAgent.exists({ email: lowerEmail })) return res.json({ role: "delivery_agent" });

      return res.status(404).json({ error: "User not found" });
    } catch (error) {
      logger.error("role-by-email get error:", error);
      res.status(500).json({ error: "Failed to process request" });
    }
  }

  // GET /user/me — returns current user from JWT (requires Authorization: Bearer <token>)
  async me(req, res) {
    try {
      const authHeader = req.headers.authorization || '';
      const match = authHeader.match(/^Bearer (.+)$/i);
      if (!match) {
        return res.status(401).json({ error: 'Authorization header required' });
      }
      let decoded;
      try {
        decoded = jwt.verify(match[1], getJwtSecret());
      } catch {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }

      const { id, role } = decoded;
      let user, type;
      console.log(decoded);

      switch (role) {
        case 'admin': {
          user = await Admin.findById(id).lean();
          type = 'admin';
          break;
        }
        case 'seller': {
          user = await Seller.findById(id).lean();
          type = 'seller';
          break;
        }
        case 'delivery_agent': {
          user = await DeliveryAgent.findById(id).lean();
          type = 'delivery_agent';
          break;
        }
        case 'client':
        default: {
          user = await Client.findById(id).lean();
          type = 'client';
          break;
        }
      }

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      return res.json({ type, user, [`${type}_id`]: user._id });
    } catch (err) {
      logger.error('[auth/user/me] error:', err);
      return res.status(500).json({ error: 'Failed to get user' });
    }
  }

  // GET /user/:firebase_uid - get user by Firebase UID
  async getUserByFirebaseUid(req, res) {
    try {
      const { firebase_uid } = req.params;

      // IMPORTANT: Check privileged roles first so an accidental Client doc
      // created for an admin/seller email does not mask the real role.
      let user = await Admin.findOne({ firebase_uid });
      if (user) return res.json({ type: "admin", user, admin_id: user._id });

      user = await Seller.findOne({ firebase_uid });
      if (user) return res.json({ type: "seller", user, seller_id: user._id });

      user = await DeliveryAgent.findOne({ firebase_uid });
      if (user)
        return res.json({
          type: "delivery_agent",
          user,
          delivery_agent_id: user._id,
        });

      user = await Client.findOne({ firebase_uid });
      if (user) return res.json({ type: "client", user, client_id: user._id });

      res.status(404).json({ error: "User not found" });
    } catch (error) {
      console.error("Get user error:", error);
      res.status(500).json({ error: "Failed to get user" });
    }
  }

  // POST /forgot-password
  // Password reset flow for Seller, DeliveryAgent, and Admin (NOT for Clients who use OTP)
  // Step 1: Request password reset
  async forgotPassword(req, res) {
    try {
      const { email, userType } = req.body;

      if (!email || !userType) {
        return res.status(400).json({ error: "Email and userType are required" });
      }

      // Only allow password reset for roles that use passwords
      if (!["seller", "delivery_agent", "admin"].includes(userType)) {
        return res.status(400).json({
          error:
            "Password reset is only available for Seller, Delivery Agent, and Admin accounts",
        });
      }

      let Model;
      if (userType === "seller") Model = Seller;
      else if (userType === "delivery_agent") Model = DeliveryAgent;
      else if (userType === "admin") Model = Admin;

      const user = await Model.findOne({ email: email.toLowerCase() });
      if (!user) {
        // Don't reveal if user exists or not for security
        return res.json({
          message:
            "If an account exists with this email, a reset token has been generated",
        });
      }

      // Generate reset token (JWT with 1-hour expiry)
      const resetToken = jwt.sign(
        { userId: user._id, userType, purpose: "password_reset" },
        getJwtSecret(),
        { expiresIn: "1h" },
      );

      // Store reset token and expiry in user document
      user.resetPasswordToken = resetToken;
      user.resetPasswordExpires = Date.now() + 3600000; // 1 hour
      await user.save();

      // In production, send this token via email
      // For now, return it in response (REMOVE IN PRODUCTION)
      res.json({
        message: "Password reset token generated",
        resetToken, // TODO: Remove this in production, send via email instead
      });
    } catch (error) {
      console.error("Forgot password error:", error);
      res.status(500).json({ error: "Failed to process password reset request" });
    }
  }

  // POST /reset-password - Step 2: Reset password using token
  async resetPassword(req, res) {
    try {
      const { resetToken, newPassword } = req.body;

      if (!resetToken || !newPassword) {
        return res
          .status(400)
          .json({ error: "Reset token and new password are required" });
      }

      if (newPassword.length < 6) {
        return res
          .status(400)
          .json({ error: "Password must be at least 6 characters" });
      }

      // Verify token
      let decoded;
      try {
        decoded = jwt.verify(resetToken, getJwtSecret());
      } catch (err) {
        return res.status(400).json({ error: "Invalid or expired reset token" });
      }

      if (decoded.purpose !== "password_reset") {
        return res.status(400).json({ error: "Invalid token purpose" });
      }

      // Find user based on userType from token
      let Model;
      if (decoded.userType === "seller") Model = Seller;
      else if (decoded.userType === "delivery_agent") Model = DeliveryAgent;
      else if (decoded.userType === "admin") Model = Admin;
      else {
        return res.status(400).json({ error: "Invalid user type in token" });
      }

      const user = await Model.findById(decoded.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Check if token matches and hasn't expired
      if (user.resetPasswordToken !== resetToken) {
        return res.status(400).json({ error: "Invalid reset token" });
      }

      if (user.resetPasswordExpires < Date.now()) {
        return res.status(400).json({ error: "Reset token has expired" });
      }

      // Update password (pre-save hook will hash it) and clear reset token
      user.password = newPassword;
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      await user.save();

      res.json({ message: "Password reset successful" });
    } catch (error) {
      console.error("Reset password error:", error);
      res.status(500).json({ error: "Failed to reset password" });
    }
  }

  // POST /logout { user_id?: string } — clears device tokens; no longer relies on Firebase token revocation
  async logout(req, res) {
    try {
      // Accept user_id from body or from the decoded JWT (if middleware attaches it)
      const bodyUserId = req.body && req.body.user_id ? String(req.body.user_id) : null;
      const jwtUserId  = req.user ? String(req.user.id || req.user._id || '') : null;
      const userId     = bodyUserId || jwtUserId;

      const idsToClear = [];
      if (userId)     idsToClear.push(userId);

      // internal_id covers seller_id / agent_id stored by frontend session
      const internalId = req.body && req.body.internal_id ? String(req.body.internal_id) : null;
      if (internalId) idsToClear.push(internalId);

      if (idsToClear.length === 0) {
        return res.status(400).json({ error: 'user_id or internal_id is required' });
      }

      try {
        await DeviceToken.deleteMany({ user_id: { $in: idsToClear } });
      } catch (e) {
        // non-fatal — tokens will expire naturally
        logger.warn(`[auth/logout] Failed to delete device tokens: ${e.message}`);
      }

      return res.json({ ok: true, cleared_user_ids: idsToClear });
    } catch (e) {
      logger.error('logout error', e);
      return res.status(500).json({ error: 'failed to logout' });
    }
  }
}

module.exports = new AuthController();
