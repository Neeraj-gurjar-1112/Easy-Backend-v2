/**
 * JWT Authentication Middleware
 *
 * This middleware verifies JWT tokens and attaches the decoded user info to req.user.
 * It replaces the legacy verifyFirebaseToken middleware.
 */

const jwt = require("jsonwebtoken");
const logger = require("@util/logger");

function getJwtSecret() {
  const JWT_SECRET = process.env.JWT_SECRET;
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET environment variable not set");
  }
  return JWT_SECRET;
}

/**
 * Middleware to verify JWT token from Authorization header
 * Expects: Authorization: Bearer <jwt-token>
 * Sets req.user = { id, role, email, ... } on success
 */
function verifyToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "No authentication token provided",
      });
    }

    const token = authHeader.split("Bearer ")[1];
    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Invalid authentication token format",
      });
    }

    // Verify the JWT token
    const decoded = jwt.verify(token, getJwtSecret());

    // Attach user info to request object
    // JWT payload usually contains { id, role, email }
    req.user = decoded;

    // Optional logging
    if (logger.logAuth) {
      logger.logAuth({
        action: "token_verified",
        id: decoded.id,
        role: decoded.role,
        email: decoded.email,
      });
    }

    next();
  } catch (error) {
    logger.error("JWT token verification failed:", error);

    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Authentication token expired",
      });
    }

    return res.status(401).json({
      success: false,
      message: "Authentication failed",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
}

/**
 * Optional authentication middleware
 * Similar to verifyToken but doesn't require authentication
 * If token is present and valid, sets req.user
 * If token is missing or invalid, continues without req.user
 */
function optionalToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return next();
    }

    const token = authHeader.split("Bearer ")[1];
    if (!token) {
      return next();
    }

    const decoded = jwt.verify(token, getJwtSecret());
    req.user = decoded;

    next();
  } catch (error) {
    // Silent fail - just continue without user
    logger.warn(`Optional token verification failed: ${error.message}`);
    next();
  }
}

module.exports = verifyToken;
module.exports.optionalToken = optionalToken;
// For backward compatibility while refactoring
module.exports.verifyFirebaseToken = verifyToken;
module.exports.optionalFirebaseToken = optionalToken;
