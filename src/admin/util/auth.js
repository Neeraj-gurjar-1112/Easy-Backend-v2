/**
 * Admin authentication helpers. Copied verbatim from legacy routes/admin.js.
 *
 * requireAdmin accepts, in order:
 * 1. JWT Bearer token with role "admin"
 * 2. req.firebaseUser whose email matches an Admin document
 * 3. API key (ADMIN_API_KEY) via Bearer token or x-api-key header
 * 4. Legacy header x-admin: 1 (dev only - remove before hardening)
 */
const jwt = require("jsonwebtoken");
const { Admin } = require("@models");

// Helper function to get JWT secret with runtime check
function getJwtSecret() {
  const JWT_SECRET = process.env.JWT_SECRET;
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET environment variable not set");
  }
  return JWT_SECRET;
}

// Middleware to protect admin routes.
// Now supports:
// 1. JWT Bearer tokens (preferred)
// 2. Legacy header x-admin: 1 (dev only)
// 3. API key via Bearer token or x-api-key header
async function requireAdmin(req, res, next) {
  const legacy = req.headers["x-admin"] === "1"; // backward compat (DEV ONLY)
  const apiKey = process.env.ADMIN_API_KEY;
  let providedKey = null;
  const auth = req.headers.authorization || req.headers.Authorization;

  if (auth && /^Bearer /i.test(auth)) {
    const token = auth.split(/\s+/)[1];

    // Try JWT first
    try {
      const decoded = jwt.verify(token, getJwtSecret());
      if (decoded.role === "admin") {
        req.admin = decoded;
        return next();
      }
    } catch (jwtError) {
      // Log JWT verification errors for debugging
      if (process.env.NODE_ENV !== "production") {
        console.error("JWT verification failed:", jwtError.message);
      }
      // If JWT fails, try as API key
      providedKey = token;
    }
  }

  if (!providedKey && req.headers["x-api-key"]) {
    providedKey = req.headers["x-api-key"];
  }

  // Accept Firebase ID Token if it corresponds to an Admin document
  try {
    if (req.firebaseUser) {
      const uid = req.firebaseUser.uid;
      const email = (req.firebaseUser.email || "").toLowerCase();
      const adminDoc = await Admin.findOne({
        ...(email ? { email } : { _id: null }), // fallback to ensure no match if email is missing
      }).lean();
      if (adminDoc) {
        req.admin = {
          id: adminDoc._id,
          email: adminDoc.email,
          role: adminDoc.role || "admin",
          source: "firebase",
        };
        return next();
      }
    }
  } catch (e) {
    // fall through to other auth methods
  }

  if (legacy || (apiKey && providedKey && providedKey === apiKey)) {
    req.admin = { role: "admin", source: legacy ? "legacy" : "api-key" };
    return next();
  }

  return res.status(401).json({ error: "admin auth required" });
}

module.exports = { getJwtSecret, requireAdmin };
