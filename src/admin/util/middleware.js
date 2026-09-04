/**
 * Router-level middleware for the whole /api/admin surface.
 * Applied once in src/admin/routes/index.js - do NOT re-apply inside modules.
 * Copied verbatim from legacy routes/admin.js.
 */
const rateLimit = require("express-rate-limit");

// Rate limiting for admin routes
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === "test" ? 10000 : 500, // Increased from 100 to 500 for admin operations
  message: { error: "Too many admin requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

// Request logging middleware
const logRequest = (req, res, next) => {
  // Capture start time and basic request info
  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  const method = req.method;
  const path = req.path;
  const ip = req.ip;
  const userAgent = req.get("User-Agent");

  // Log after response is sent (when req.admin is set by requireAdmin middleware)
  res.on("finish", () => {
    if (process.env.NODE_ENV !== "test") {
      const duration = Date.now() - startTime;
      const adminId = req.admin?.id || req.admin?.email || "Anonymous";
      console.log(
        `[ADMIN LOG] ${timestamp} | ${method} ${path} | IP: ${ip} | Admin: ${adminId} | Status: ${res.statusCode} | ${duration}ms | UserAgent: ${userAgent}`,
      );
    }
  });

  next();
};

module.exports = { adminLimiter, logRequest };
