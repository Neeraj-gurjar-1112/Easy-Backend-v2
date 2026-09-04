/**
 * Cache Middleware Tests
 * Testing: middleware/cache.js
 * Coverage Target: 47.76% → 85%+
 *
 * Test Categories:
 * 1. Redis Initialization (6 tests) - lines 8-56
 * 2. Cache Hit/Miss Logic (8 tests) - lines 77-117
 * 3. Cache Invalidation (4 tests) - lines 119-168
 * 4. Error Handling (5 tests) - error paths
 * 5. Integration Tests (3 tests) - full middleware flow
 *
 * Uncovered Lines to Target:
 * - 18-22: reconnectStrategy logic
 * - 29-34: error event handlers
 * - 47-48: connect event, end event
 * - 55-65: initRedis error handling
 * - 84: cache key generation
 * - 111: cache write error
 * - 119-168: invalidateCache, clearAllCache, closeRedis
 */

const redis = require("redis");
const {
  initRedis,
  getRedisClient,
  isRedisAvailable,
  cacheMiddleware,
  invalidateCache,
  clearAllCache,
  closeRedis,
} = require("../../lib/middleware/cache");

// Mock redis module
jest.mock("redis");

// Mock logger
jest.mock("../../lib/util/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const logger = require("../../lib/util/logger");

describe("Cache Middleware - Complete Coverage", () => {
  let mockRedisClient;
  let eventHandlers;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset event handlers
    eventHandlers = {};

    // Create mock Redis client
    mockRedisClient = {
      connect: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockResolvedValue(undefined),
      get: jest.fn(),
      setEx: jest.fn().mockResolvedValue("OK"),
      del: jest.fn().mockResolvedValue(1),
      keys: jest.fn().mockResolvedValue([]),
      flushAll: jest.fn().mockResolvedValue("OK"),
      on: jest.fn((event, handler) => {
        eventHandlers[event] = handler;
      }),
    };

    redis.createClient.mockReturnValue(mockRedisClient);

    // Set environment variable
    process.env.REDIS_URL = "redis://localhost:6379";
  });

  afterEach(async () => {
    // Clean up Redis connection
    await closeRedis();
  });

  // =============================================================================
  // Category 1: Redis Initialization & Connection Management
  // =============================================================================

  describe("Redis Initialization", () => {
    test("should initialize Redis client successfully", async () => {
      const client = await initRedis();

      expect(redis.createClient).toHaveBeenCalledWith({
        url: "redis://localhost:6379",
        socket: {
          reconnectStrategy: expect.any(Function),
        },
      });
      expect(mockRedisClient.connect).toHaveBeenCalled();
      expect(client).toBe(mockRedisClient);
    });

    test("should register error event handler", async () => {
      await initRedis();

      expect(mockRedisClient.on).toHaveBeenCalledWith(
        "error",
        expect.any(Function)
      );
    });

    test("should handle ECONNREFUSED error silently (Redis not running)", async () => {
      await initRedis();

      // Trigger error handler with ECONNREFUSED
      const errorHandler = eventHandlers.error;
      errorHandler({ code: "ECONNREFUSED" });

      // Should NOT log error (silent failure for optional Redis)
      expect(logger.error).not.toHaveBeenCalledWith(
        "Redis Client Error:",
        expect.anything()
      );
    });

    test("should log non-ECONNREFUSED errors", async () => {
      await initRedis();

      // Trigger error handler with different error
      const errorHandler = eventHandlers.error;
      const testError = new Error("Connection timeout");
      errorHandler(testError);

      expect(logger.error).toHaveBeenCalledWith(
        "Redis Client Error:",
        testError
      );
    });

    test("should handle connect event (line 38)", async () => {
      await initRedis();

      // Trigger connect event
      const connectHandler = eventHandlers.connect;
      connectHandler();

      expect(logger.info).toHaveBeenCalledWith("Redis: Connecting...");
    });

    test("should handle ready event and set isRedisReady flag", async () => {
      await initRedis();

      // Trigger ready event
      const readyHandler = eventHandlers.ready;
      readyHandler();

      expect(logger.info).toHaveBeenCalledWith("Redis: Connected and ready");
      expect(isRedisAvailable()).toBe(true);
    });

    test("should handle end event and reset isRedisReady flag", async () => {
      await initRedis();

      // Trigger ready first
      eventHandlers.ready();
      expect(isRedisAvailable()).toBe(true);

      // Trigger end event
      const endHandler = eventHandlers.end;
      endHandler();

      expect(logger.warn).toHaveBeenCalledWith("Redis: Connection closed");
      expect(isRedisAvailable()).toBe(false);
    });

    test("should handle Redis connection failure gracefully", async () => {
      mockRedisClient.connect.mockRejectedValue(new Error("Connection failed"));

      const client = await initRedis();

      expect(logger.error).toHaveBeenCalledWith(
        "Redis: Failed to initialize",
        expect.any(Error)
      );
      expect(client).toBeNull();
      expect(isRedisAvailable()).toBe(false);
    });

    test("should test reconnectStrategy function", async () => {
      await initRedis();

      // Get the reconnectStrategy function from createClient call
      const createClientCall = redis.createClient.mock.calls[0][0];
      const reconnectStrategy = createClientCall.socket.reconnectStrategy;

      // Test various retry attempts
      expect(reconnectStrategy(1)).toBe(100); // min(100, 3000)
      expect(reconnectStrategy(5)).toBe(500); // min(500, 3000)
      expect(reconnectStrategy(10)).toBe(1000); // min(1000, 3000)

      // Test max retries (>10) - should return Error
      const result = reconnectStrategy(11);
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe("Redis max reconnection attempts reached");
    });
  });

  // =============================================================================
  // Category 2: Cache Middleware - Hit/Miss Logic
  // =============================================================================

  describe("Cache Hit/Miss Logic", () => {
    beforeEach(async () => {
      await initRedis();
    });

    test("should return cached data on cache HIT", async () => {
      eventHandlers.ready(); // Set isRedisReady = true
      const cachedData = { products: ["apple", "banana"] };
      mockRedisClient.get.mockResolvedValue(JSON.stringify(cachedData));

      const req = { originalUrl: "/api/products", url: "/api/products" };
      const res = {
        json: jest.fn(),
      };
      const next = jest.fn();

      const middleware = cacheMiddleware(300);
      await middleware(req, res, next);

      expect(mockRedisClient.get).toHaveBeenCalledWith("cache:/api/products");
      expect(res.json).toHaveBeenCalledWith(cachedData);
      expect(next).not.toHaveBeenCalled(); // Should not call next on cache hit
      expect(logger.debug).toHaveBeenCalledWith(
        "Cache HIT: cache:/api/products"
      );
    });

    test("should call next() on cache MISS (cache key not found)", async () => {
      eventHandlers.ready(); // Set isRedisReady = true
      mockRedisClient.get.mockResolvedValue(null);

      const req = { originalUrl: "/api/users", url: "/api/users" };
      const res = {
        json: jest.fn(),
      };
      const next = jest.fn();

      const middleware = cacheMiddleware(300);
      await middleware(req, res, next);

      expect(mockRedisClient.get).toHaveBeenCalledWith("cache:/api/users");
      expect(next).toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith("Cache MISS: cache:/api/users");
    });

    test("should cache response data after controller execution (cache MISS)", async () => {
      eventHandlers.ready(); // Set isRedisReady = true
      mockRedisClient.get.mockResolvedValue(null);

      const req = { originalUrl: "/api/products", url: "/api/products" };
      const responseData = { products: ["apple", "banana"] };
      let capturedJson;

      const res = {
        json: jest.fn(function (data) {
          // Simulate original json behavior
          capturedJson = data;
          return this;
        }),
      };
      const next = jest.fn();

      const middleware = cacheMiddleware(300);
      await middleware(req, res, next);

      // Simulate controller calling res.json()
      res.json(responseData);

      expect(mockRedisClient.setEx).toHaveBeenCalledWith(
        "cache:/api/products",
        300,
        JSON.stringify(responseData)
      );
      expect(capturedJson).toEqual(responseData);
    });

    test("should use custom keyGenerator if provided", async () => {
      eventHandlers.ready(); // Set isRedisReady = true
      mockRedisClient.get.mockResolvedValue(null);

      const customKeyGenerator = (req) => `custom:${req.params.id}`;
      const req = {
        originalUrl: "/api/products/123",
        url: "/api/products/123",
        params: { id: "123" },
      };
      const res = { json: jest.fn() };
      const next = jest.fn();

      const middleware = cacheMiddleware(300, customKeyGenerator);
      await middleware(req, res, next);

      expect(mockRedisClient.get).toHaveBeenCalledWith("custom:123");
    });

    test("should skip caching when Redis is not available", async () => {
      // Don't trigger ready event (Redis not ready, keep isRedisReady = false)

      const req = { originalUrl: "/api/products", url: "/api/products" };
      const res = { json: jest.fn() };
      const next = jest.fn();

      const middleware = cacheMiddleware(300);
      await middleware(req, res, next);

      expect(mockRedisClient.get).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled(); // Should skip to controller
    });

    test("should handle cache read errors gracefully", async () => {
      eventHandlers.ready(); // Set isRedisReady = true
      mockRedisClient.get.mockRejectedValue(new Error("Redis read error"));

      const req = { originalUrl: "/api/products", url: "/api/products" };
      const res = { json: jest.fn() };
      const next = jest.fn();

      const middleware = cacheMiddleware(300);
      await middleware(req, res, next);

      expect(logger.error).toHaveBeenCalledWith(
        "Cache middleware error:",
        expect.any(Error)
      );
      expect(next).toHaveBeenCalled(); // Should continue despite error
    });

    test("should handle cache write errors gracefully (setEx failure)", async () => {
      eventHandlers.ready(); // Set isRedisReady = true
      mockRedisClient.get.mockResolvedValue(null);
      mockRedisClient.setEx.mockRejectedValue(new Error("Redis write error"));

      const req = { originalUrl: "/api/products", url: "/api/products" };
      const responseData = { products: ["apple"] };
      const res = {
        json: jest.fn(function (data) {
          return this;
        }),
      };
      const next = jest.fn();

      const middleware = cacheMiddleware(300);
      await middleware(req, res, next);

      // Simulate controller calling res.json()
      res.json(responseData);

      // Wait for async error handler
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(logger.error).toHaveBeenCalledWith(
        "Redis setEx error:",
        expect.any(Error)
      );
    });

    test("should use custom TTL when specified", async () => {
      eventHandlers.ready(); // Set isRedisReady = true
      mockRedisClient.get.mockResolvedValue(null);

      const req = { originalUrl: "/api/products", url: "/api/products" };
      const responseData = { products: ["apple"] };
      const res = {
        json: jest.fn(function (data) {
          return this;
        }),
      };
      const next = jest.fn();

      const middleware = cacheMiddleware(600); // Custom TTL: 10 minutes
      await middleware(req, res, next);

      res.json(responseData);

      expect(mockRedisClient.setEx).toHaveBeenCalledWith(
        "cache:/api/products",
        600,
        JSON.stringify(responseData)
      );
    });
  });

  // =============================================================================
  // Category 3: Cache Invalidation & Management
  // =============================================================================

  describe("Cache Invalidation", () => {
    beforeEach(async () => {
      await initRedis();
      eventHandlers.ready(); // Set Redis as ready
    });

    test("should invalidate cache by pattern", async () => {
      const keys = ["cache:products:1", "cache:products:2", "cache:products:3"];
      mockRedisClient.keys.mockResolvedValue(keys);
      mockRedisClient.del.mockResolvedValue(3);

      await invalidateCache("cache:products:*");

      expect(mockRedisClient.keys).toHaveBeenCalledWith("cache:products:*");
      expect(mockRedisClient.del).toHaveBeenCalledWith(keys);
      expect(logger.info).toHaveBeenCalledWith(
        "Cache invalidated: 3 keys matching cache:products:*"
      );
    });

    test("should handle invalidateCache when no keys match pattern", async () => {
      mockRedisClient.keys.mockResolvedValue([]);

      // Clear previous logger.info calls from beforeEach
      logger.info.mockClear();

      await invalidateCache("cache:nonexistent:*");

      expect(mockRedisClient.keys).toHaveBeenCalledWith("cache:nonexistent:*");
      expect(mockRedisClient.del).not.toHaveBeenCalled();
      // Should not log when no keys found
      expect(logger.info).not.toHaveBeenCalled();
    });

    test("should handle invalidateCache errors gracefully", async () => {
      mockRedisClient.keys.mockRejectedValue(new Error("Redis keys error"));

      await invalidateCache("cache:products:*");

      expect(logger.error).toHaveBeenCalledWith(
        "Cache invalidation error:",
        expect.any(Error)
      );
    });

    test("should skip invalidateCache when Redis is not available", async () => {
      // Trigger end event to make Redis unavailable
      eventHandlers.end();

      await invalidateCache("cache:products:*");

      expect(mockRedisClient.keys).not.toHaveBeenCalled();
    });
  });

  describe("Clear All Cache", () => {
    beforeEach(async () => {
      await initRedis();
      eventHandlers.ready(); // Set Redis as ready
    });

    test("should clear all cache successfully", async () => {
      await clearAllCache();

      expect(mockRedisClient.flushAll).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith("All cache cleared");
    });

    test("should handle clearAllCache errors gracefully", async () => {
      mockRedisClient.flushAll.mockRejectedValue(
        new Error("Redis flush error")
      );

      await clearAllCache();

      expect(logger.error).toHaveBeenCalledWith(
        "Clear all cache error:",
        expect.any(Error)
      );
    });

    test("should skip clearAllCache when Redis is not available", async () => {
      // Trigger end event to make Redis unavailable
      eventHandlers.end();

      await clearAllCache();

      expect(mockRedisClient.flushAll).not.toHaveBeenCalled();
    });
  });

  describe("Close Redis Connection", () => {
    test("should close Redis connection gracefully", async () => {
      await initRedis();
      eventHandlers.ready();

      await closeRedis();

      expect(mockRedisClient.quit).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith("Redis connection closed");
      expect(isRedisAvailable()).toBe(false);
    });

    test("should handle closeRedis when client is null (not initialized)", async () => {
      // Don't initialize Redis
      await closeRedis();

      expect(mockRedisClient.quit).not.toHaveBeenCalled();
    });
  });

  // =============================================================================
  // Category 4: Helper Functions
  // =============================================================================

  describe("Helper Functions", () => {
    test("getRedisClient should return client when ready", async () => {
      await initRedis();
      eventHandlers.ready();

      const client = getRedisClient();

      expect(client).toBe(mockRedisClient);
    });

    test("getRedisClient should return null when not ready", async () => {
      await initRedis();
      // Don't trigger ready event

      const client = getRedisClient();

      expect(client).toBeNull();
    });

    test("isRedisAvailable should return false before initialization", () => {
      expect(isRedisAvailable()).toBe(false);
    });

    test("isRedisAvailable should return true after successful initialization", async () => {
      await initRedis();
      eventHandlers.ready();

      expect(isRedisAvailable()).toBe(true);
    });
  });

  // =============================================================================
  // Category 5: Integration Tests
  // =============================================================================

  describe("Integration Tests", () => {
    test("should handle full cache lifecycle: MISS → cache → HIT", async () => {
      await initRedis();
      eventHandlers.ready();

      const req = { originalUrl: "/api/test", url: "/api/test" };
      const responseData = { result: "success" };

      // First request: Cache MISS
      mockRedisClient.get.mockResolvedValueOnce(null);
      const res1 = {
        json: jest.fn(function (data) {
          return this;
        }),
      };
      const next1 = jest.fn();

      const middleware = cacheMiddleware(300);
      await middleware(req, res1, next1);
      expect(next1).toHaveBeenCalled(); // Cache miss, call controller

      // Simulate controller response
      res1.json(responseData);
      expect(mockRedisClient.setEx).toHaveBeenCalledWith(
        "cache:/api/test",
        300,
        JSON.stringify(responseData)
      );

      // Second request: Cache HIT
      mockRedisClient.get.mockResolvedValueOnce(JSON.stringify(responseData));
      const res2 = { json: jest.fn() };
      const next2 = jest.fn();

      await middleware(req, res2, next2);
      expect(res2.json).toHaveBeenCalledWith(responseData);
      expect(next2).not.toHaveBeenCalled(); // Cache hit, skip controller
    });

    test("should handle fallback to req.url when originalUrl is missing", async () => {
      await initRedis();
      eventHandlers.ready();

      mockRedisClient.get.mockResolvedValue(null);

      const req = { url: "/api/fallback" }; // No originalUrl
      const res = { json: jest.fn() };
      const next = jest.fn();

      const middleware = cacheMiddleware(300);
      await middleware(req, res, next);

      expect(mockRedisClient.get).toHaveBeenCalledWith("cache:/api/fallback");
    });

    test("should handle concurrent requests with different cache keys", async () => {
      await initRedis();
      eventHandlers.ready();

      mockRedisClient.get.mockResolvedValue(null);

      const req1 = { originalUrl: "/api/users", url: "/api/users" };
      const req2 = { originalUrl: "/api/products", url: "/api/products" };

      const middleware = cacheMiddleware(300);

      // Request 1
      const res1 = { json: jest.fn() };
      const next1 = jest.fn();
      await middleware(req1, res1, next1);

      // Request 2
      const res2 = { json: jest.fn() };
      const next2 = jest.fn();
      await middleware(req2, res2, next2);

      expect(mockRedisClient.get).toHaveBeenCalledWith("cache:/api/users");
      expect(mockRedisClient.get).toHaveBeenCalledWith("cache:/api/products");
      expect(next1).toHaveBeenCalled();
      expect(next2).toHaveBeenCalled();
    });
  });
});
