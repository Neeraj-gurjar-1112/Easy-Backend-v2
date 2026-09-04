/**
 * Sentry bootstrap (optional - only when SENTRY_DSN is set).
 * Uses the @sentry/node v8+ API (setupExpressErrorHandler). The legacy
 * Sentry.Handlers.* middleware used by the old app.js no longer exists in v10.
 */
const Sentry = require("@sentry/node");

let initialized = false;

function initSentry(logger) {
  if (initialized || !process.env.SENTRY_DSN) return initialized;
  const isProd = process.env.NODE_ENV === "production";
  const integrations = [];
  try {
    const { nodeProfilingIntegration } = require("@sentry/profiling-node");
    integrations.push(nodeProfilingIntegration());
  } catch (_) {
    // profiling is optional
  }
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    integrations,
    tracesSampleRate: isProd ? 0.1 : 1.0,
    profilesSampleRate: isProd ? 0.1 : 1.0,
  });
  initialized = true;
  if (logger) logger.info("Sentry error monitoring initialized");
  return true;
}

function isSentryEnabled() {
  return initialized;
}

module.exports = { Sentry, initSentry, isSentryEnabled };
