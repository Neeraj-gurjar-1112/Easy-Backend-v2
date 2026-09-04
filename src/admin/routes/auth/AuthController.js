const jwt = require("jsonwebtoken");
const { Admin } = require("@models");
const { getJwtSecret } = require("../../util/auth");

class AuthController {
  // Admin login endpoint - generates JWT token
  async login(req, res) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: "Email and password required" });
      }

      // Find admin by email
      const admin = await Admin.findOne({ email: email.toLowerCase() });
      if (!admin) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      // Check password with bcrypt; fallback to legacy plaintext then upgrade
      let ok = await admin.comparePassword(password);
      if (!ok && admin.password && admin.password === password) {
        // upgrade legacy plaintext to bcrypt
        admin.password = password;
        await admin.save();
        ok = true;
      }
      if (!ok) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      // Generate JWT token
      const token = jwt.sign(
        {
          id: admin._id,
          email: admin.email,
          role: "admin",
          exp: Math.floor(Date.now() / 1000) + 2 * 60 * 60, // 2 hours
        },
        getJwtSecret(),
      );

      res.json({
        success: true,
        token,
        admin: {
          id: admin._id,
          email: admin.email,
          name: admin.name || admin.email,
          role: admin.role,
        },
      });
    } catch (error) {
      console.error("Admin login error:", error);
      res.status(500).json({ error: "Login failed" });
    }
  }

  // Change admin password (requires current password verification)
  async changePassword(req, res) {
    try {
      const { currentPassword, newPassword } = req.body;

      // Validation
      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          error: "Current password and new password are required",
        });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({
          error: "New password must be at least 6 characters long",
        });
      }

      if (currentPassword === newPassword) {
        return res.status(400).json({
          error: "New password must be different from current password",
        });
      }

      // Get admin from database (req.admin only has basic info from JWT)
      const adminId = req.admin.id;
      if (!adminId) {
        return res.status(401).json({ error: "Admin ID not found in token" });
      }

      const admin = await Admin.findById(adminId);
      if (!admin) {
        return res.status(404).json({ error: "Admin account not found" });
      }

      // Verify current password
      const isValid = await admin.comparePassword(currentPassword);
      if (!isValid) {
        return res.status(401).json({ error: "Current password is incorrect" });
      }

      // Update password (pre-save hook will hash it)
      admin.password = newPassword;
      await admin.save();

      res.json({
        success: true,
        message: "Password changed successfully",
      });
    } catch (error) {
      console.error("Admin password change error:", error);
      res.status(500).json({ error: "Failed to change password" });
    }
  }
}

module.exports = new AuthController();
