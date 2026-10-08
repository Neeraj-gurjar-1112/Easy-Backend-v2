const mongoose = require("mongoose");
const logger = require("@util/logger");

function getUri() {
  return (
    process.env.DB_CONNECTION_STRING || "mongodb://127.0.0.1:27017/easy_app"
  );
}

/**
 * Database name to connect to. A URI that already names a database wins; otherwise DB_NAME
 * from .env is used (previously such a URI silently landed in Mongo's default "test" db).
 */
function getDbName(uri = getUri()) {
  const match = String(uri).match(/^mongodb(?:\+srv)?:\/\/[^/]+(?:\/([^?]*))?/);
  const inUri = match && match[1];
  if (inUri) return undefined;
  return process.env.DB_NAME || undefined;
}

let memoryServer = null;

/**
 * USE_MEMORY_DB=1 → run MongoDB inside this process (mongodb-memory-server). Meant for hosted
 * demos with no database service: data starts empty on every boot and SEED_ON_BOOT=1 refills it.
 * Never for production data.
 */
async function resolveUri() {
  if (process.env.USE_MEMORY_DB !== "1") return getUri();
  if (!memoryServer) {
    const { MongoMemoryServer } = require("mongodb-memory-server");
    memoryServer = await MongoMemoryServer.create({
      instance: { dbName: process.env.DB_NAME || "easy_app" },
    });
    logger.warn(
      "USE_MEMORY_DB=1 - using an in-memory MongoDB; data resets on every restart",
    );
  }
  return memoryServer.getUri();
}

/** SEED_ON_BOOT=1 → make sure the demo rows exist right after connecting (idempotent upsert). */
async function seedIfRequested() {
  if (process.env.SEED_ON_BOOT !== "1") return;
  const { seedDeliveryAgents } = require("@lib/seed/deliveryAgents");
  const result = await seedDeliveryAgents({
    log: (msg) => logger.info("[seed] " + msg),
  });
  logger.info(
    "[seed] ready: " + result.total + " delivery agents, admin " + result.admin,
  );
}

/**
 * Non-blocking connect with automatic retry. The HTTP server starts even when
 * MongoDB is temporarily unreachable (Cloud Run cold-start friendly).
 */
async function connectWithRetry(uri, retryMs = 5000) {
  try {
    const target = uri || (await resolveUri());
    await mongoose.connect(target, {
      dbName: getDbName(target),
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
    });
    logger.info("Connected to MongoDB");
    await seedIfRequested();
    return true;
  } catch (err) {
    logger.warn("MongoDB connection failed (will retry):", err.message);
    setTimeout(() => {
      connectWithRetry(uri, retryMs).catch((e) =>
        logger.error("MongoDB background connection error:", e),
      );
    }, retryMs);
    return false;
  }
}

module.exports = { mongoose, getUri, getDbName, resolveUri, connectWithRetry };
