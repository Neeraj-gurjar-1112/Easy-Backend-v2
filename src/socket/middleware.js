/**
 * Socket.IO handshake auth.
 *   io(url, { auth: { token } })      JWT issued by /api/auth/* or /api/auth/otp/verify
 *   io(url, { auth: { apiKey } })     ADMIN_API_KEY -> role "admin" (dashboards / tooling)
 * Sets socket.user = { id, role, email }.
 */
const jwt = require("jsonwebtoken");

function extractToken(socket) {
  const h = socket.handshake || {};
  const header = typeof h.headers?.authorization === "string" ? h.headers.authorization.replace(/^Bearer\s+/i, "") : "";
  return h.auth?.token || h.query?.token || header || "";
}

function socketAuth(socket, next) {
  try {
    const apiKey = socket.handshake?.auth?.apiKey || socket.handshake?.query?.apiKey;
    if (apiKey && process.env.ADMIN_API_KEY && apiKey === process.env.ADMIN_API_KEY) {
      socket.user = { id: "admin-api-key", role: "admin" };
      return next();
    }
    const token = extractToken(socket);
    if (!token) return next(new Error("Please provide token."));
    if (!process.env.JWT_SECRET) return next(new Error("Server misconfigured: JWT_SECRET missing."));
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const id = String(decoded.id || decoded.sub || decoded.userId || "");
    if (!id) return next(new Error("Invalid token."));
    socket.user = { id, role: String(decoded.role || "client"), email: decoded.email };
    return next();
  } catch (err) {
    return next(new Error(err.name === "TokenExpiredError" ? "Token expired." : "Invalid token."));
  }
}

module.exports = { socketAuth };
