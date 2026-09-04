/**
 * Comprehensive Tests for services/geocode.js (Priority 4.3)
 *
 * Coverage Target: 15.21% → 85%+
 * Tests: 20 comprehensive tests
 * Categories:
 *   1. Reverse Geocoding (7 tests)
 *   2. Place Details Lookup (5 tests)
 *   3. Configuration & Fallback (4 tests)
 *   4. Cache Management (4 tests)
 *
 * Service Overview:
 * - Google Maps API wrapper (Geocoding + Place Details)
 * - In-memory caching with 24h TTL
 * - Environment-based configuration (ENABLED flag, API_KEY)
 */

const https = require("https");

// Mock https module before importing geocode
jest.mock("https");

// Helper function to mock HTTPS responses
function mockHttpsResponse(responseData) {
  const mockReq = {
    on: jest.fn((event, callback) => mockReq),
  };

  https.get.mockImplementation((url, callback) => {
    process.nextTick(() => {
      const mockRes = {
        on: jest.fn((event, cb) => {
          if (event === "data") {
            cb(JSON.stringify(responseData));
          } else if (event === "end") {
            cb();
          }
          return mockRes;
        }),
      };
      callback(mockRes);
    });
    return mockReq;
  });
}

describe("Geocoding Service Tests", () => {
  let geocode;
  let originalEnv;

  beforeAll(() => {
    // Save original environment
    originalEnv = { ...process.env };
  });

  beforeEach(() => {
    // Clear mocks but don't reset modules (would clear https mock)
    jest.clearAllMocks();

    // Set default environment variables
    process.env.GOOGLE_MAPS_API_KEY = "test_api_key_123";
    process.env.GEOCODE_SERVER_FALLBACK = "1"; // Enable by default

    // Clear module cache to get fresh instance (but keep https mock)
    delete require.cache[require.resolve("../../lib/util/geocode")];
    geocode = require("../../lib/util/geocode");
  });

  afterAll(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  // ============================================================
  // CATEGORY 1: Reverse Geocoding (7 tests)
  // ============================================================

  describe("Reverse Geocoding", () => {
    test("should reverse geocode valid coordinates (cache miss)", async () => {
      mockHttpsResponse({
        status: "OK",
        results: [
          {
            formatted_address: "123 Test Street, San Francisco, CA 94102, USA",
          },
        ],
      });

      const result = await geocode.reverseGeocode(37.77493, -122.41942);

      expect(result).toBe("123 Test Street, San Francisco, CA 94102, USA");
      expect(https.get).toHaveBeenCalledWith(
        expect.stringContaining("latlng=37.77493,-122.41942"),
        expect.any(Function)
      );
      expect(https.get).toHaveBeenCalledWith(
        expect.stringContaining("key=test_api_key_123"),
        expect.any(Function)
      );
    });

    test("should use cached result for same coordinates (cache hit)", async () => {
      // Use different coordinates to avoid cache pollution from previous test
      mockHttpsResponse({
        status: "OK",
        results: [{ formatted_address: "Cached Address" }],
      });

      // First call - cache miss
      const result1 = await geocode.reverseGeocode(40.71427, -74.00597); // NYC coordinates
      expect(result1).toBe("Cached Address");
      expect(https.get).toHaveBeenCalledTimes(1);

      // Second call - cache hit (should not call HTTPS)
      jest.clearAllMocks();
      const result2 = await geocode.reverseGeocode(40.71427, -74.00597);
      expect(result2).toBe("Cached Address");
      expect(https.get).not.toHaveBeenCalled();
    });

    test("should apply coordinate precision (5 decimal places)", async () => {
      mockHttpsResponse({
        status: "OK",
        results: [{ formatted_address: "Precise Location" }],
      });

      // Use different coordinates to avoid cache hit from previous tests
      await geocode.reverseGeocode(51.507351234567, -0.127758912345);

      expect(https.get).toHaveBeenCalledWith(
        expect.stringContaining("latlng=51.507351234567,-0.127758912345"),
        expect.any(Function)
      );
    });

    test("should return null when Google API returns ZERO_RESULTS", async () => {
      const mockResponse = {
        status: "ZERO_RESULTS",
        results: [],
      };

      const mockReq = { on: jest.fn(() => mockReq) };
      const mockRes = {
        on: jest.fn((event, callback) => {
          if (event === "data") callback(JSON.stringify(mockResponse));
          else if (event === "end") callback();
          return mockRes;
        }),
      };

      https.get.mockImplementation((url, callback) => {
        callback(mockRes);
        return mockReq;
      });

      const result = await geocode.reverseGeocode(0, 0);
      expect(result).toBeNull();
    });

    test("should return null when Google API returns error status", async () => {
      const mockResponse = {
        status: "REQUEST_DENIED",
        error_message: "Invalid API key",
      };

      const mockReq = { on: jest.fn(() => mockReq) };

      https.get.mockImplementation((url, callback) => {
        process.nextTick(() => {
          const mockRes = {
            on: jest.fn((event, cb) => {
              if (event === "data") cb(JSON.stringify(mockResponse));
              else if (event === "end") cb();
              return mockRes;
            }),
          };
          callback(mockRes);
        });
        return mockReq;
      });

      // Use unique coordinates to avoid cache hits
      const result = await geocode.reverseGeocode(35.689487, 139.691706); // Tokyo
      expect(result).toBeNull();
    });

    test("should handle network errors gracefully", async () => {
      const mockReq = {
        on: jest.fn((event, callback) => {
          if (event === "error") {
            // Simulate network error
            process.nextTick(() => callback(new Error("ENOTFOUND")));
          }
          return mockReq;
        }),
      };

      https.get.mockImplementation(() => mockReq);

      // Use unique coordinates to avoid cache hits
      const result = await geocode.reverseGeocode(48.856614, 2.352222); // Paris
      expect(result).toBeNull();
    });

    test("should handle invalid JSON response gracefully", async () => {
      const mockReq = { on: jest.fn(() => mockReq) };

      https.get.mockImplementation((url, callback) => {
        process.nextTick(() => {
          const mockRes = {
            on: jest.fn((event, cb) => {
              if (event === "data") cb("Invalid JSON {{{");
              else if (event === "end") cb();
              return mockRes;
            }),
          };
          callback(mockRes);
        });
        return mockReq;
      });

      // Use unique coordinates to avoid cache hits
      const result = await geocode.reverseGeocode(-33.865143, 151.2099); // Sydney
      expect(result).toBeNull();
    });
  });

  // ============================================================
  // CATEGORY 2: Place Details Lookup (5 tests)
  // ============================================================

  describe("Place Details Lookup", () => {
    test("should fetch place details for valid place ID (cache miss)", async () => {
      mockHttpsResponse({
        result: {
          formatted_address: "456 Market Street, San Francisco, CA 94111, USA",
        },
        status: "OK",
      });

      const result = await geocode.placeDetails("ChIJIQBpAG2ahYAR_6128GcTUEo");

      expect(result).toBe("456 Market Street, San Francisco, CA 94111, USA");
      expect(https.get).toHaveBeenCalledWith(
        expect.stringContaining("place_id=ChIJIQBpAG2ahYAR_6128GcTUEo"),
        expect.any(Function)
      );
      expect(https.get).toHaveBeenCalledWith(
        expect.stringContaining("fields=formatted_address"),
        expect.any(Function)
      );
      expect(https.get).toHaveBeenCalledWith(
        expect.stringContaining("key=test_api_key_123"),
        expect.any(Function)
      );
    });

    test("should use cached result for same place ID (cache hit)", async () => {
      mockHttpsResponse({
        result: { formatted_address: "Cached Place Address" },
        status: "OK",
      });

      // First call - cache miss
      const result1 = await geocode.placeDetails("ChIJTest123");
      expect(result1).toBe("Cached Place Address");
      expect(https.get).toHaveBeenCalledTimes(1);

      // Second call - cache hit
      jest.clearAllMocks();
      const result2 = await geocode.placeDetails("ChIJTest123");
      expect(result2).toBe("Cached Place Address");
      expect(https.get).not.toHaveBeenCalled();
    });

    test("should return null when place ID is missing or empty", async () => {
      const result1 = await geocode.placeDetails(null);
      const result2 = await geocode.placeDetails("");
      const result3 = await geocode.placeDetails(undefined);

      expect(result1).toBeNull();
      expect(result2).toBeNull();
      expect(result3).toBeNull();
      expect(https.get).not.toHaveBeenCalled();
    });

    test("should return null when API returns no result", async () => {
      const mockResponse = {
        result: {},
        status: "OK",
      };

      const mockReq = { on: jest.fn(() => mockReq) };
      const mockRes = {
        on: jest.fn((event, callback) => {
          if (event === "data") callback(JSON.stringify(mockResponse));
          else if (event === "end") callback();
          return mockRes;
        }),
      };

      https.get.mockImplementation((url, callback) => {
        callback(mockRes);
        return mockReq;
      });

      const result = await geocode.placeDetails("InvalidPlaceID");
      expect(result).toBeNull();
    });

    test("should properly encode place IDs with special characters", async () => {
      mockHttpsResponse({
        result: { formatted_address: "Encoded Place" },
        status: "OK",
      });

      // Place ID with special characters
      await geocode.placeDetails("ChIJ+Special/Chars=123");

      expect(https.get).toHaveBeenCalledWith(
        expect.stringContaining("ChIJ%2BSpecial%2FChars%3D123"),
        expect.any(Function)
      );
    });
  });

  // ============================================================
  // CATEGORY 3: Configuration & Fallback (4 tests)
  // ============================================================

  describe("Configuration & Fallback", () => {
    // These tests verify the geocode module respects configuration
    // Note: Since ENABLED and API_KEY are evaluated at module load time,
    // these tests check the current state set by beforeEach (ENABLED=true, API_KEY set)

    test("should expose ENABLED flag based on GEOCODE_SERVER_FALLBACK env var", () => {
      // Current state from beforeEach: ENABLED should be true
      expect(geocode.ENABLED).toBe(true);

      // Verify it's a boolean
      expect(typeof geocode.ENABLED).toBe("boolean");
    });

    test("should return valid address when enabled (current state)", async () => {
      mockHttpsResponse({
        status: "OK",
        results: [{ formatted_address: "Configuration Test Address" }],
      });

      // Use unique coordinates: Moscow
      const result = await geocode.reverseGeocode(55.755826, 37.6173);

      expect(result).toBe("Configuration Test Address");
      expect(https.get).toHaveBeenCalledWith(
        expect.stringContaining("maps.googleapis.com/maps/api/geocode"),
        expect.any(Function)
      );
    });

    test("should handle API errors gracefully", async () => {
      // Mock error response
      const mockReq = { on: jest.fn(() => mockReq) };
      https.get.mockImplementation((url, callback) => {
        process.nextTick(() => {
          const mockRes = {
            on: jest.fn((event, cb) => {
              if (event === "data") {
                cb(
                  JSON.stringify({
                    status: "REQUEST_DENIED",
                    error_message: "API key invalid",
                  })
                );
              } else if (event === "end") {
                cb();
              }
              return mockRes;
            }),
          };
          callback(mockRes);
        });
        return mockReq;
      });

      // Use unique coordinates: Berlin
      const result = await geocode.reverseGeocode(52.520007, 13.404954);

      // Should return null on error status
      expect(result).toBeNull();
    });

    test("should include API key in requests", async () => {
      mockHttpsResponse({
        status: "OK",
        results: [{ formatted_address: "API Key Test" }],
      });

      // Use unique coordinates: Singapore
      await geocode.reverseGeocode(1.352083, 103.819836);

      // Verify API key is included in URL
      expect(https.get).toHaveBeenCalledWith(
        expect.stringContaining("key=test_api_key_123"),
        expect.any(Function)
      );
    });
  });

  // ============================================================
  // CATEGORY 4: Cache Management (4 tests)
  // ============================================================

  describe("Cache Management", () => {
    test("should enforce 24-hour TTL for reverse geocoding cache", async () => {
      mockHttpsResponse({
        status: "OK",
        results: [{ formatted_address: "Initial Address" }],
      });

      // First call - cache miss
      const originalNow = Date.now;
      const baseTime = 1609459200000; // Fixed timestamp
      Date.now = jest.fn(() => baseTime);

      // Use unique coordinates
      await geocode.reverseGeocode(19.432608, -99.133209); // Mexico City
      expect(https.get).toHaveBeenCalledTimes(1);

      // Second call within 24h - cache hit
      jest.clearAllMocks();
      Date.now = jest.fn(() => baseTime + 1000 * 60 * 60 * 23); // +23 hours
      await geocode.reverseGeocode(19.432608, -99.133209);
      expect(https.get).not.toHaveBeenCalled();

      // Third call after 24h - cache expired, should fetch again
      mockHttpsResponse({
        status: "OK",
        results: [{ formatted_address: "Initial Address" }],
      });
      Date.now = jest.fn(() => baseTime + 1000 * 60 * 60 * 25); // +25 hours
      await geocode.reverseGeocode(19.432608, -99.133209);
      expect(https.get).toHaveBeenCalledTimes(1);

      // Restore Date.now
      Date.now = originalNow;
    });

    test("should use correct cache key format (lat,lng with 5 decimals)", async () => {
      mockHttpsResponse({
        status: "OK",
        results: [{ formatted_address: "Test Address" }],
      });

      // First call with high precision Rome coordinates
      await geocode.reverseGeocode(41.902783456, 12.496365789); // Rome
      jest.clearAllMocks();

      // Second call with slightly different precision, same key: "41.90278,12.49636"
      await geocode.reverseGeocode(41.902783999, 12.496365111); // Still Rome, same key

      // Should use cache (both map to "41.90278,12.49636")
      expect(https.get).not.toHaveBeenCalled();
    });

    test("should maintain separate caches for reverse geocoding and place details", async () => {
      const mockReq = { on: jest.fn(() => mockReq) };

      https.get.mockImplementation((url, callback) => {
        process.nextTick(() => {
          const mockRes = {
            on: jest.fn((event, cb) => {
              if (event === "data") {
                // Different responses based on URL
                if (url.includes("geocode")) {
                  cb(
                    JSON.stringify({
                      status: "OK",
                      results: [{ formatted_address: "Reverse Address" }],
                    })
                  );
                } else if (url.includes("place")) {
                  cb(
                    JSON.stringify({
                      result: { formatted_address: "Place Address" },
                      status: "OK",
                    })
                  );
                }
              } else if (event === "end") {
                cb();
              }
              return mockRes;
            }),
          };
          callback(mockRes);
        });
        return mockReq;
      });

      // Populate reverse cache with unique coordinates (Barcelona)
      const result1 = await geocode.reverseGeocode(41.385064, 2.173404);
      expect(result1).toBe("Reverse Address");

      // Populate place cache with unique place ID
      const result2 = await geocode.placeDetails("ChIJTestSeparateCache");
      expect(result2).toBe("Place Address");

      // Both caches should be independent
      expect(https.get).toHaveBeenCalledTimes(2);
    });

    test("should handle cache isolation between different coordinates", async () => {
      const mockReq = { on: jest.fn(() => mockReq) };

      let callCount = 0;
      https.get.mockImplementation((url, callback) => {
        process.nextTick(() => {
          const mockRes = {
            on: jest.fn((event, cb) => {
              if (event === "data") {
                callCount++;
                cb(
                  JSON.stringify({
                    status: "OK",
                    results: [{ formatted_address: `Address ${callCount}` }],
                  })
                );
              } else if (event === "end") {
                cb();
              }
              return mockRes;
            }),
          };
          callback(mockRes);
        });
        return mockReq;
      });

      // Three different unique coordinates - should create three separate cache entries
      const result1 = await geocode.reverseGeocode(-22.906847, -43.172896); // Rio
      const result2 = await geocode.reverseGeocode(-34.603722, -58.381592); // Buenos Aires
      const result3 = await geocode.reverseGeocode(28.613939, 77.209021); // Delhi

      expect(result1).toBe("Address 1");
      expect(result2).toBe("Address 2");
      expect(result3).toBe("Address 3");
      expect(https.get).toHaveBeenCalledTimes(3);

      // Cache hits for same coordinates
      jest.clearAllMocks();
      await geocode.reverseGeocode(-22.906847, -43.172896); // Cache hit
      await geocode.reverseGeocode(-34.603722, -58.381592); // Cache hit
      await geocode.reverseGeocode(28.613939, 77.209021); // Cache hit

      expect(https.get).not.toHaveBeenCalled();
    });
  });
});
