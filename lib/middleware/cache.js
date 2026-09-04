const redis = require("redis");
const logger = require("@util/logger");

let redisClient = null;
let isRedisReady = false;

/**
 * Initialize Redis client
 */
async function initRedis() {
  try {
    const redisUrl =
      process.env.UPSTASH_REDIS_URL || process.env.REDIS_URL || "redis://localhost:6379";

    // Upstash requires TLS; detect based on URL
    const isTls = redisUrl.includes("upstash.io");

    const clientConfig = {
      url: redisUrl,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            logger.error("Redis: Max reconnection attempts reached");
            return new Error("Redis max reconnection attempts reached");
          }
          return Math.min(retries * 50, 1000);
        },
        connectTimeout: 10000,
        keepAlive: 30000,
        noDelay: true,
      },
      lazyConnect: false,
      maxRetriesPerRequest: 3,
    };

    if (isTls) {
      clientConfig.socket.tls = true;
      clientConfig.socket.rejectUnauthorized = false;
    }

    redisClient = redis.createClient(clientConfig);

    redisClient.on("error", (err) => {
      // Suppress verbose logging for connection refused (Redis not installed/running)
      if (err.code === "ECONNREFUSED") {
        // Silent - Redis is optional
      } else if (err.message && err.message.includes("Socket closed")) {
        // Expected during reconnect attempts
      } else {
        logger.error("Redis Client Error:", err.message || err);
      }
      isRedisReady = false;
    });

    redisClient.on("connect", () => {
      logger.info("Redis: Connecting...");
    });

    redisClient.on("ready", () => {
      logger.info("✅ Redis: Connected and ready - Caching enabled");
      isRedisReady = true;
    });

    redisClient.on("end", () => {
      logger.warn("Redis: Connection closed");
      isRedisReady = false;
    });

    await redisClient.connect();

    return redisClient;
  } catch (error) {
    logger.error("Redis: Failed to initialize", error);
    isRedisReady = false;
    return null;
  }
}

/**
 * Get Redis client instance
 */
function getRedisClient() {
  return isRedisReady ? redisClient : null;
}

/**
 * Check if Redis is available
 */
function isRedisAvailable() {
  return isRedisReady && redisClient !== null;
}

/**
 * Cache middleware factory
 * @param {number} ttl - Time to live in seconds
 * @param {function} keyGenerator - Function to generate cache key from req
 */
function cacheMiddleware(ttl = 300, keyGenerator = null) {
  return async (req, res, next) => {
    // Skip if Redis not available
    if (!isRedisAvailable()) {
      return next();
    }

    try {
      // Generate cache key
      const cacheKey = keyGenerator
        ? keyGenerator(req)
        : `cache:${req.originalUrl || req.url}`;

      // Try to get from cache
      const cachedData = await redisClient.get(cacheKey);

      if (cachedData) {
        logger.debug(`Cache HIT: ${cacheKey}`);
        return res.json(JSON.parse(cachedData));
      }

      logger.debug(`Cache MISS: ${cacheKey}`);

      // Store original res.json
      const originalJson = res.json.bind(res);

      // Override res.json to cache response
      res.json = (data) => {
        // Cache the response
        redisClient
          .setEx(cacheKey, ttl, JSON.stringify(data))
          .catch((err) => logger.error("Redis setEx error:", err));

        // Send response
        return originalJson(data);
      };

      next();
    } catch (error) {
      logger.error("Cache middleware error:", error);
      next();
    }
  };
}

/**
 * Invalidate cache by pattern
 * @param {string} pattern - Redis key pattern (e.g., 'cache:products:*')
 */
async function invalidateCache(pattern) {
  if (!isRedisAvailable()) {
    return;
  }

  try {
    const keys = await redisClient.keys(pattern);
    if (keys.length > 0) {
      await redisClient.del(keys);
      logger.info(`Cache invalidated: ${keys.length} keys matching ${pattern}`);
    }
  } catch (error) {
    logger.error("Cache invalidation error:", error);
  }
}

/**
 * Clear all cache
 */
async function clearAllCache() {
  if (!isRedisAvailable()) {
    return;
  }

  try {
    await redisClient.flushAll();
    logger.info("All cache cleared");
  } catch (error) {
    logger.error("Clear all cache error:", error);
  }
}

/**
 * Close Redis connection
 */
async function closeRedis() {
  if (redisClient) {
    await redisClient.quit();
    isRedisReady = false;
    logger.info("Redis connection closed");
  }
}

module.exports = {
  initRedis,
  getRedisClient,
  isRedisAvailable,
  cacheMiddleware,
  invalidateCache,
  clearAllCache,
  closeRedis,
};
