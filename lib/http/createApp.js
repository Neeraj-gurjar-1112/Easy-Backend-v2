/**
 * Express app factory shared by the app, admin and socket services (and by the
 * combined server.js / test harness). Mirrors the legacy app.js middleware chain:
 * trust proxy -> helmet -> CORS -> global rate limit -> auth rate limit -> body parsers
 * -> response helpers -> health -> routers -> Sentry error handler -> JSON error handler.
 */
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const logger = require("@util/logger");
const { Sentry, isSentryEnabled } = require("@util/sentry");
const { isRedisAvailable } = require("@middleware/cache");
const { isFirebaseInitialized } = require("@push/firebaseAdmin");
const bus = require("@events/bus");
const { responseHelpers } = require("./response");

function allowedOrigins() {
  const list = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",")
        .map((o) => o.trim())
        .filter(Boolean)
    : ["http://localhost:3000", "http://192.168.1.76:3000", "https://easy-backend-785621869568.asia-south1.run.app"];
  if (process.env.CDN_DOMAIN && !list.includes(process.env.CDN_DOMAIN)) list.push(process.env.CDN_DOMAIN);
  return list;
}

/**
 * @param {object} opts
 * @param {string} opts.name                 service name (app | admin | socket | all)
 * @param {import("express").Router[]} opts.routers  routers already carrying their public prefixes
 * @param {boolean} [opts.authLimiter=true]  apply the 20/15min limiter to /api/auth/login|signup
 * @param {boolean} [opts.health=true]       expose /health and /api/health
 */
function createApp({ name = "server", routers = [], authLimiter = true, health = true } = {}) {
  const app = express();
  app.set("trust proxy", 1);
  app.locals.serviceName = name;

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'", "https://maps.googleapis.com", "https://firebaseinstallations.googleapis.com"],
        },
      },
      crossOriginEmbedderPolicy: false,
    })
  );

  const origins = allowedOrigins();
  logger.info(`[${name}] CORS enabled for origins: ${origins.join(", ")}`);
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) return callback(null, true); // mobile apps, curl, server-to-server
        if (origins.indexOf(origin) !== -1) return callback(null, true);
        logger.warn(`CORS blocked origin: ${origin}`);
        return callback(new Error("Not allowed by CORS"));
      },
      credentials: true,
      maxAge: 86400,
    })
  );

  const isDevelopment = process.env.NODE_ENV !== "production";
  app.use(
    "/api/",
    rateLimit({
      windowMs: 60 * 1000,
      max: isDevelopment ? 500 : 300,
      message: "Too many requests from this IP, please try again later.",
      standardHeaders: true,
      legacyHeaders: false,
      validate: { trustProxy: false },
      skip: (req) => req.path.includes("/sse/") || req.path.includes("/stream") || req.path.startsWith("/socket"),
    })
  );

  if (authLimiter) {
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: process.env.NODE_ENV === "test" ? 1000 : 20,
      skipSuccessfulRequests: true,
      message: "Too many login attempts, please try again later.",
      validate: { trustProxy: false },
    });
    app.use("/api/auth/login", limiter);
    app.use("/api/auth/signup", limiter);
  }

  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));
  app.use(responseHelpers());

  if (health) {
    app.get("/health", (req, res) => res.json({ status: "ok" }));
    app.get("/api/health", (req, res) =>
      res.json({
        status: "ok",
        service: name,
        firebaseAdmin: isFirebaseInitialized(),
        redis: isRedisAvailable(),
        eventBus: bus.isDistributed() ? "redis" : "memory",
      })
    );
  }

  for (const router of routers) app.use(router);

  if (isSentryEnabled()) {
    Sentry.setupExpressErrorHandler(app, {
      shouldHandleError(error) {
        return Boolean(error && (error.status >= 500 || error.name === "UnauthorizedError" || error.name === "MongoError"));
      },
    });
  }

  // Fallback error handler (same contract as the legacy app.js)
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    logger.logError(err, { url: req.originalUrl, method: req.method, ip: req.ip });
    res.status(err.status || 500).json({
      error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
      ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
    });
  });

  return app;
}

module.exports = { createApp, allowedOrigins };
