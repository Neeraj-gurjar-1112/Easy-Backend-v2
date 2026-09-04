/**
 * Comprehensive Tests for routes/tokens.js
 *
 * Coverage Target: 21.73% → 85%+
 *
 * Endpoints Tested:
 * - POST /api/tokens/register - Register or refresh device token
 *
 * Test Sections:
 * 1. Device Token Registration (Basic Flow)
 * 2. Token Refresh & Updates
 * 3. Duplicate Key Handling (E11000)
 * 4. User Account Switching
 * 5. Validation & Error Handling
 */

const request = require("supertest");
const app = require("../app");
const { DeviceToken } = require("../lib/models");
const dbHandler = require("./testUtils/dbHandler");

describe("Device Token Management - Comprehensive Tests", () => {
  beforeAll(async () => {
    await dbHandler.connectTestDB();
  });

  afterAll(async () => {
    await dbHandler.closeTestDB();
  });

  beforeEach(async () => {
    await DeviceToken.deleteMany({});
  });

  // ===================================================================
  // Section 1: Device Token Registration (Basic Flow)
  // ===================================================================
  describe("Section 1: Device Token Registration", () => {
    test("1.1: should register new device token successfully", async () => {
      const res = await request(app).post("/api/tokens/register").send({
        user_id: "test_user_001",
        token: "fcm_token_12345",
        platform: "android",
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });

      // Verify token saved in DB
      const saved = await DeviceToken.findOne({ token: "fcm_token_12345" });
      expect(saved).toBeTruthy();
      expect(saved.user_id).toBe("test_user_001");
      expect(saved.platform).toBe("android");
      expect(saved.last_seen).toBeDefined();
    });

    test("1.2: should register iOS device token", async () => {
      const res = await request(app).post("/api/tokens/register").send({
        user_id: "test_user_002",
        token: "apns_token_67890",
        platform: "ios",
      });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      const saved = await DeviceToken.findOne({ token: "apns_token_67890" });
      expect(saved.platform).toBe("ios");
    });

    test("1.3: should register web device token", async () => {
      const res = await request(app).post("/api/tokens/register").send({
        user_id: "test_user_003",
        token: "web_token_abcde",
        platform: "web",
      });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      const saved = await DeviceToken.findOne({ token: "web_token_abcde" });
      expect(saved.platform).toBe("web");
    });
  });

  // ===================================================================
  // Section 2: Token Refresh & Updates
  // ===================================================================
  describe("Section 2: Token Refresh & Updates", () => {
    test("2.1: should update last_seen timestamp on refresh", async () => {
      // Initial registration
      await request(app).post("/api/tokens/register").send({
        user_id: "test_user_004",
        token: "fcm_token_refresh",
        platform: "android",
      });

      const initial = await DeviceToken.findOne({ token: "fcm_token_refresh" });
      const initialLastSeen = initial.last_seen;

      // Wait 100ms to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Refresh token
      const res = await request(app).post("/api/tokens/register").send({
        user_id: "test_user_004",
        token: "fcm_token_refresh",
        platform: "android",
      });

      expect(res.status).toBe(200);

      const updated = await DeviceToken.findOne({ token: "fcm_token_refresh" });
      expect(updated.last_seen.getTime()).toBeGreaterThan(
        initialLastSeen.getTime()
      );
    });

    test("2.2: should update platform when refreshing token", async () => {
      // Initial registration as android
      await request(app).post("/api/tokens/register").send({
        user_id: "test_user_005",
        token: "fcm_token_platform_change",
        platform: "android",
      });

      // Update to iOS
      const res = await request(app).post("/api/tokens/register").send({
        user_id: "test_user_005",
        token: "fcm_token_platform_change",
        platform: "ios",
      });

      expect(res.status).toBe(200);

      const updated = await DeviceToken.findOne({
        token: "fcm_token_platform_change",
      });
      expect(updated.platform).toBe("ios");
      expect(updated.user_id).toBe("test_user_005");
    });

    test("2.3: should handle token refresh without platform field", async () => {
      // Initial registration
      await request(app).post("/api/tokens/register").send({
        user_id: "test_user_006",
        token: "fcm_token_no_platform",
        platform: "android",
      });

      // Refresh without platform
      const res = await request(app).post("/api/tokens/register").send({
        user_id: "test_user_006",
        token: "fcm_token_no_platform",
      });

      expect(res.status).toBe(200);

      const updated = await DeviceToken.findOne({
        token: "fcm_token_no_platform",
      });
      expect(updated.user_id).toBe("test_user_006");
      // Platform should be updated to undefined/null
      expect(updated.last_seen).toBeDefined();
    });
  });

  // ===================================================================
  // Section 3: User Account Switching
  // ===================================================================
  describe("Section 3: User Account Switching", () => {
    test("3.1: should update token when different user registers same token", async () => {
      // First registration (user_id + token combination is unique due to compound index)
      await request(app).post("/api/tokens/register").send({
        user_id: "old_user",
        token: "fcm_token_switch",
        platform: "android",
      });

      // Different user, same token (upsert will update last_seen and platform)
      const res = await request(app).post("/api/tokens/register").send({
        user_id: "new_user",
        token: "fcm_token_switch",
        platform: "ios",
      });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      // Verify new user-token combination created (compound key: user_id + token)
      const newUserToken = await DeviceToken.findOne({
        user_id: "new_user",
        token: "fcm_token_switch",
      });
      expect(newUserToken).toBeTruthy();
      expect(newUserToken.platform).toBe("ios");

      // Old user-token combination still exists
      const oldUserToken = await DeviceToken.findOne({
        user_id: "old_user",
        token: "fcm_token_switch",
      });
      expect(oldUserToken).toBeTruthy();
      expect(oldUserToken.platform).toBe("android");
    });

    test("3.2: should handle multiple registrations from same user-token pair", async () => {
      // First registration
      await request(app).post("/api/tokens/register").send({
        user_id: "user_a",
        token: "fcm_token_same_user",
        platform: "android",
      });

      // Same user, same token, different platform (should update)
      await request(app).post("/api/tokens/register").send({
        user_id: "user_a",
        token: "fcm_token_same_user",
        platform: "ios",
      });

      // Final update
      const res = await request(app).post("/api/tokens/register").send({
        user_id: "user_a",
        token: "fcm_token_same_user",
        platform: "web",
      });

      expect(res.status).toBe(200);

      // Should only have one record for this user-token pair (updated)
      const tokens = await DeviceToken.find({
        user_id: "user_a",
        token: "fcm_token_same_user",
      });
      expect(tokens.length).toBe(1);
      expect(tokens[0].platform).toBe("web");
    });
  });

  // ===================================================================
  // Section 4: Upsert Behavior & Edge Cases
  // ===================================================================
  describe("Section 4: Upsert Behavior & Edge Cases", () => {
    test("4.1: should handle E11000 duplicate key error and recover", async () => {
      // Pre-create a token
      await DeviceToken.create({
        user_id: "e11000_user",
        token: "e11000_token",
        platform: "android",
        last_seen: new Date(Date.now() - 86400000),
      });

      // Mock findOneAndUpdate to throw E11000
      const originalFindOneAndUpdate = DeviceToken.findOneAndUpdate;
      const originalFindOne = DeviceToken.findOne;

      let callCount = 0;
      DeviceToken.findOneAndUpdate = jest.fn(async (...args) => {
        callCount++;
        if (callCount === 1) {
          // First call: throw E11000 error
          const err = new Error("E11000 duplicate key error");
          err.code = 11000;
          throw err;
        }
        // Subsequent calls: use original
        return originalFindOneAndUpdate.apply(DeviceToken, args);
      });

      // Register - should hit E11000 path and recover via findOne
      const res = await request(app).post("/api/tokens/register").send({
        user_id: "e11000_user_new",
        token: "e11000_token",
        platform: "ios",
      });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      // Restore mocks
      DeviceToken.findOneAndUpdate = originalFindOneAndUpdate;
      DeviceToken.findOne = originalFindOne;
    });

    test("4.2: should upsert token successfully on refresh", async () => {
      // Initial registration
      await request(app).post("/api/tokens/register").send({
        user_id: "upsert_user",
        token: "upsert_token_001",
        platform: "android",
      });

      const initial = await DeviceToken.findOne({
        user_id: "upsert_user",
        token: "upsert_token_001",
      });
      const initialLastSeen = initial.last_seen;

      // Wait to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Upsert with platform change
      const res = await request(app).post("/api/tokens/register").send({
        user_id: "upsert_user",
        token: "upsert_token_001",
        platform: "ios",
      });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      // Verify upsert updated existing record
      const tokens = await DeviceToken.find({
        user_id: "upsert_user",
        token: "upsert_token_001",
      });
      expect(tokens.length).toBe(1); // Only one record
      expect(tokens[0].platform).toBe("ios");
      expect(tokens[0].last_seen.getTime()).toBeGreaterThan(
        initialLastSeen.getTime()
      );
    });

    test("4.3: should handle concurrent upserts gracefully", async () => {
      // Simulate multiple concurrent registrations
      const promises = [1, 2, 3, 4, 5].map((i) =>
        request(app)
          .post("/api/tokens/register")
          .send({
            user_id: "concurrent_user",
            token: "concurrent_token",
            platform: i % 2 === 0 ? "android" : "ios",
          })
      );

      const results = await Promise.all(promises);

      // All should succeed
      results.forEach((res) => {
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
      });

      // Should have exactly one record (upsert handled duplicates)
      const tokens = await DeviceToken.find({
        user_id: "concurrent_user",
        token: "concurrent_token",
      });
      expect(tokens.length).toBe(1);
    });
  });

  // ===================================================================
  // Section 5: Validation & Error Handling
  // ===================================================================
  describe("Section 5: Validation & Error Handling", () => {
    test("5.1: should return 400 if user_id is missing", async () => {
      const res = await request(app).post("/api/tokens/register").send({
        token: "fcm_token_no_user",
        platform: "android",
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("user_id and token required");
    });

    test("5.2: should return 400 if token is missing", async () => {
      const res = await request(app).post("/api/tokens/register").send({
        user_id: "test_user_007",
        platform: "android",
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("user_id and token required");
    });

    test("5.3: should return 400 if both user_id and token are missing", async () => {
      const res = await request(app).post("/api/tokens/register").send({
        platform: "android",
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("user_id and token required");
    });

    test("5.4: should return 400 if request body is empty", async () => {
      const res = await request(app).post("/api/tokens/register").send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("user_id and token required");
    });

    test("5.5: should return 400 if request body is null", async () => {
      const res = await request(app).post("/api/tokens/register").send(null);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("user_id and token required");
    });

    test("5.6: should handle empty string values for user_id", async () => {
      const res = await request(app).post("/api/tokens/register").send({
        user_id: "",
        token: "fcm_token_empty_user",
        platform: "android",
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("user_id and token required");
    });

    test("5.7: should handle empty string values for token", async () => {
      const res = await request(app).post("/api/tokens/register").send({
        user_id: "test_user_008",
        token: "",
        platform: "android",
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("user_id and token required");
    });

    test("5.8: should handle database errors gracefully (500)", async () => {
      // Mock findOneAndUpdate to throw unexpected error
      const originalFindOneAndUpdate = DeviceToken.findOneAndUpdate;
      DeviceToken.findOneAndUpdate = jest
        .fn()
        .mockRejectedValue(new Error("Database connection failed"));

      const res = await request(app).post("/api/tokens/register").send({
        user_id: "test_user_009",
        token: "fcm_token_db_error",
        platform: "android",
      });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("failed to register token");

      // Restore original method
      DeviceToken.findOneAndUpdate = originalFindOneAndUpdate;
    });

    test("5.9: should handle very long token strings", async () => {
      const longToken = "fcm_" + "a".repeat(1000);
      const res = await request(app).post("/api/tokens/register").send({
        user_id: "test_user_010",
        token: longToken,
        platform: "android",
      });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      const saved = await DeviceToken.findOne({ token: longToken });
      expect(saved).toBeTruthy();
      expect(saved.token.length).toBe(1004);
    });

    test("5.10: should handle special characters in token", async () => {
      const specialToken = "fcm_token_!@#$%^&*()_+-=[]{}|;:',.<>?/~`";
      const res = await request(app).post("/api/tokens/register").send({
        user_id: "test_user_011",
        token: specialToken,
        platform: "android",
      });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      const saved = await DeviceToken.findOne({ token: specialToken });
      expect(saved).toBeTruthy();
      expect(saved.token).toBe(specialToken);
    });
  });
});
