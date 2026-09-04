const mongoose = require("mongoose");
const logger = require("@util/logger");

function getUri() {
  return process.env.DB_CONNECTION_STRING || "mongodb://127.0.0.1:27017/easy_app";
}

/**
 * Non-blocking connect with automatic retry. The HTTP server starts even when
 * MongoDB is temporarily unreachable (Cloud Run cold-start friendly).
 */
async function connectWithRetry(uri = getUri(), retryMs = 5000) {
  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
    });
    logger.info("Connected to MongoDB");
    return true;
  } catch (err) {
    logger.warn("MongoDB connection failed (will retry):", err.message);
    setTimeout(() => {
      connectWithRetry(uri, retryMs).catch((e) => logger.error("MongoDB background connection error:", e));
    }, retryMs);
    return false;
  }
}

module.exports = { mongoose, getUri, connectWithRetry };
