const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../app");
const { DeviceToken } = require("../lib/models");
const {
  connectTestDB,
  clearTestDB,
  closeTestDB,
} = require("./testUtils/dbHandler");

// ========================================
// SETUP & TEARDOWN
// ========================================

beforeAll(async () => {
  await connectTestDB();
});

afterAll(async () => {
  await closeTestDB();
});

beforeEach(async () => {
  await clearTestDB();
});

// ========================================
// PHASE 22.1: TOKEN REGISTRATION TESTS
// ========================================

describe("Phase 22.1: Device Token Registration", () => {
  // ========================================
  // Section 1: Basic Token Registration (Happy Path)
  // ========================================
  describe("Section 1: Basic Token Registration", () => {
    test("should register new device token successfully", async () => {
      const response = await request(app).post("/api/tokens/register").send({
        user_id: "user123",
        token: "fcm-token-abc123",
        platform: "android",
      });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });

      // Verify token was saved to database
      const savedToken = await DeviceToken.findOne({
        user_id: "user123",
        token: "fcm-token-abc123",
      });
      expect(savedToken).toBeDefined();
      expect(savedToken.platform).toBe("android");
      expect(savedToken.last_seen).toBeDefined();
    });

    test("should register token with iOS platform", async () => {
      const response = await request(app).post("/api/tokens/register").send({
        user_id: "user456",
        token: "apns-token-xyz789",
        platform: "ios",
      });

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);

      const savedToken = await DeviceToken.findOne({
        user_id: "user456",
        token: "apns-token-xyz789",
      });
      expect(savedToken.platform).toBe("ios");
    });

    test("should register token with web platform", async () => {
      const response = await request(app).post("/api/tokens/register").send({
        user_id: "user789",
        token: "web-push-token-def456",
        platform: "web",
      });

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);

      const savedToken = await DeviceToken.findOne({ user_id: "user789" });
      expect(savedToken.platform).toBe("web");
    });

    test("should register token without platform field (optional)", async () => {
      const response = await request(app).post("/api/tokens/register").send({
        user_id: "user101",
        token: "token-no-platform",
      });

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);

      const savedToken = await DeviceToken.findOne({ user_id: "user101" });
      expect(savedToken).toBeDefined();
      expect(savedToken.platform).toBeUndefined();
    });
  });

  // ========================================
  // Section 2: Token Update/Refresh (Existing Tokens)
  // ========================================
  describe("Section 2: Token Update and Refresh", () => {
    test("should update last_seen timestamp for existing token", async () => {
      // Register initial token
      await DeviceToken.create({
        user_id: "user123",
        token: "fcm-token-abc123",
        platform: "android",
        last_seen: new Date("2025-01-01"),
      });

      // Wait a moment to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Register same token again (should update last_seen)
      const response = await request(app).post("/api/tokens/register").send({
        user_id: "user123",
        token: "fcm-token-abc123",
        platform: "android",
      });

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);

      const updatedToken = await DeviceToken.findOne({
        user_id: "user123",
        token: "fcm-token-abc123",
      });
      expect(updatedToken.last_seen.getTime()).toBeGreaterThan(
        new Date("2025-01-01").getTime()
      );
    });

    test("should update platform if changed for existing token", async () => {
      // Register with android platform
      await DeviceToken.create({
        user_id: "user456",
        token: "token-switch-platform",
        platform: "android",
        last_seen: new Date(),
      });

      // Update to iOS platform
      const response = await request(app).post("/api/tokens/register").send({
        user_id: "user456",
        token: "token-switch-platform",
        platform: "ios",
      });

      expect(response.status).toBe(200);

      const updatedToken = await DeviceToken.findOne({
        user_id: "user456",
        token: "token-switch-platform",
      });
      expect(updatedToken.platform).toBe("ios");
    });

    test("should handle multiple tokens for same user", async () => {
      const user_id = "user789";

      // Register first device
      await request(app).post("/api/tokens/register").send({
        user_id,
        token: "token-device1",
        platform: "android",
      });

      // Register second device
      await request(app).post("/api/tokens/register").send({
        user_id,
        token: "token-device2",
        platform: "ios",
      });

      const tokens = await DeviceToken.find({ user_id });
      expect(tokens).toHaveLength(2);
      expect(tokens.map((t) => t.token)).toEqual(
        expect.arrayContaining(["token-device1", "token-device2"])
      );
    });
  });

  // ========================================
  // Section 3: Token Migration (Device Switched Accounts)
  // ========================================
  describe("Section 3: Token Migration Between Users", () => {
    test("should migrate token when device switches to different user account", async () => {
      // Create existing token for user1
      await DeviceToken.create({
        user_id: "user1",
        token: "shared-device-token",
        platform: "android",
        last_seen: new Date(),
      });

      // Mock findOneAndUpdate to throw E11000 error (simulating legacy unique index)
      const originalFindOneAndUpdate = DeviceToken.findOneAndUpdate;
      DeviceToken.findOneAndUpdate = jest.fn().mockRejectedValueOnce({
        code: 11000,
        message: "E11000 duplicate key error",
      });

      // Register same token with user2 (device switched accounts)
      const response = await request(app).post("/api/tokens/register").send({
        user_id: "user2",
        token: "shared-device-token",
        platform: "ios", // Platform also changed
      });

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);

      // Token should now belong to user2 with updated platform
      const migratedToken = await DeviceToken.findOne({
        token: "shared-device-token",
      });
      expect(migratedToken.user_id).toBe("user2");
      expect(migratedToken.platform).toBe("ios");

      // Restore original method
      DeviceToken.findOneAndUpdate = originalFindOneAndUpdate;
    });

    test("should handle E11000 error gracefully when token already exists for same user", async () => {
      // Create existing token
      await DeviceToken.create({
        user_id: "user123",
        token: "duplicate-token",
        platform: "android",
        last_seen: new Date("2025-01-01"),
      });

      // Mock findOneAndUpdate to throw E11000 error
      const originalFindOneAndUpdate = DeviceToken.findOneAndUpdate;
      DeviceToken.findOneAndUpdate = jest.fn().mockRejectedValueOnce({
        code: 11000,
        message: "E11000 duplicate key error",
      });

      // Try to register same token
      const response = await request(app).post("/api/tokens/register").send({
        user_id: "user123",
        token: "duplicate-token",
        platform: "ios",
      });

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);

      // Restore original method
      DeviceToken.findOneAndUpdate = originalFindOneAndUpdate;
    });
  });

  // ========================================
  // Section 4: Validation and Error Handling
  // ========================================
  describe("Section 4: Validation and Error Handling", () => {
    test("should return 400 when user_id is missing", async () => {
      const response = await request(app).post("/api/tokens/register").send({
        token: "fcm-token-only",
        platform: "android",
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("user_id and token required");
    });

    test("should return 400 when token is missing", async () => {
      const response = await request(app).post("/api/tokens/register").send({
        user_id: "user123",
        platform: "android",
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("user_id and token required");
    });

    test("should return 400 when both user_id and token are missing", async () => {
      const response = await request(app).post("/api/tokens/register").send({
        platform: "android",
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("user_id and token required");
    });

    test("should return 400 when request body is empty", async () => {
      const response = await request(app).post("/api/tokens/register").send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("user_id and token required");
    });

    test("should return 400 when request body is null", async () => {
      const response = await request(app)
        .post("/api/tokens/register")
        .send(null);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("user_id and token required");
    });

    test("should return 500 when database operation fails unexpectedly", async () => {
      // Mock findOneAndUpdate to throw unexpected error
      const originalFindOneAndUpdate = DeviceToken.findOneAndUpdate;
      DeviceToken.findOneAndUpdate = jest
        .fn()
        .mockRejectedValueOnce(new Error("Database connection lost"));

      const response = await request(app).post("/api/tokens/register").send({
        user_id: "user123",
        token: "fcm-token-error",
        platform: "android",
      });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe("failed to register token");

      // Restore original method
      DeviceToken.findOneAndUpdate = originalFindOneAndUpdate;
    });

    test("should handle E11000 error when findOne returns null (edge case)", async () => {
      // Mock findOneAndUpdate to throw E11000
      const originalFindOneAndUpdate = DeviceToken.findOneAndUpdate;
      DeviceToken.findOneAndUpdate = jest.fn().mockRejectedValueOnce({
        code: 11000,
        message: "E11000 duplicate key error",
      });

      // Mock findOne to return null (token not found)
      const originalFindOne = DeviceToken.findOne;
      DeviceToken.findOne = jest.fn().mockResolvedValueOnce(null);

      const response = await request(app).post("/api/tokens/register").send({
        user_id: "user999",
        token: "ghost-token",
        platform: "android",
      });

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);

      // Restore original methods
      DeviceToken.findOneAndUpdate = originalFindOneAndUpdate;
      DeviceToken.findOne = originalFindOne;
    });

    test("should handle save() error during token migration gracefully", async () => {
      // Create existing token
      await DeviceToken.create({
        user_id: "user1",
        token: "error-save-token",
        platform: "android",
        last_seen: new Date(),
      });

      // Mock findOneAndUpdate to throw E11000
      const originalFindOneAndUpdate = DeviceToken.findOneAndUpdate;
      DeviceToken.findOneAndUpdate = jest.fn().mockRejectedValueOnce({
        code: 11000,
        message: "E11000 duplicate key error",
      });

      // Mock save to throw error
      const originalSave = DeviceToken.prototype.save;
      DeviceToken.prototype.save = jest
        .fn()
        .mockRejectedValueOnce(new Error("Save failed"));

      const response = await request(app).post("/api/tokens/register").send({
        user_id: "user2",
        token: "error-save-token",
        platform: "ios",
      });

      // Should still return 200 (error is caught silently)
      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);

      // Restore original methods
      DeviceToken.findOneAndUpdate = originalFindOneAndUpdate;
      DeviceToken.prototype.save = originalSave;
    });
  });

  // ========================================
  // Section 5: Edge Cases and Data Types
  // ========================================
  describe("Section 5: Edge Cases and Data Types", () => {
    test("should handle very long token strings", async () => {
      const longToken = "x".repeat(1000); // 1000 character token

      const response = await request(app).post("/api/tokens/register").send({
        user_id: "user123",
        token: longToken,
        platform: "android",
      });

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);

      const savedToken = await DeviceToken.findOne({ token: longToken });
      expect(savedToken).toBeDefined();
    });

    test("should handle special characters in user_id", async () => {
      const specialUserId = "user@#$%^&*()_+-=[]{}|;:',.<>?/`~";

      const response = await request(app).post("/api/tokens/register").send({
        user_id: specialUserId,
        token: "token-special-user",
        platform: "web",
      });

      expect(response.status).toBe(200);

      const savedToken = await DeviceToken.findOne({ user_id: specialUserId });
      expect(savedToken).toBeDefined();
    });

    test("should handle numeric user_id (converted to string)", async () => {
      const response = await request(app).post("/api/tokens/register").send({
        user_id: 12345, // Numeric ID
        token: "token-numeric-user",
        platform: "android",
      });

      expect(response.status).toBe(200);

      // MongoDB converts to string
      const savedToken = await DeviceToken.findOne({
        user_id: "12345",
      });
      expect(savedToken).toBeDefined();
    });

    test("should handle empty string platform", async () => {
      const response = await request(app).post("/api/tokens/register").send({
        user_id: "user456",
        token: "token-empty-platform",
        platform: "",
      });

      expect(response.status).toBe(200);

      const savedToken = await DeviceToken.findOne({
        token: "token-empty-platform",
      });
      expect(savedToken.platform).toBe("");
    });

    test("should handle whitespace-only user_id", async () => {
      const response = await request(app).post("/api/tokens/register").send({
        user_id: "   ", // Whitespace only
        token: "token-whitespace-user",
        platform: "android",
      });

      expect(response.status).toBe(200);

      const savedToken = await DeviceToken.findOne({ user_id: "   " });
      expect(savedToken).toBeDefined();
    });

    test("should handle token with newlines and special characters", async () => {
      const weirdToken = "token\nwith\nnewlines\rand\ttabs";

      const response = await request(app).post("/api/tokens/register").send({
        user_id: "user789",
        token: weirdToken,
        platform: "ios",
      });

      expect(response.status).toBe(200);

      const savedToken = await DeviceToken.findOne({ token: weirdToken });
      expect(savedToken).toBeDefined();
    });
  });

  // ========================================
  // Section 6: Concurrent Operations
  // ========================================
  describe("Section 6: Concurrent Token Operations", () => {
    test("should handle multiple concurrent registrations for same token", async () => {
      const promises = Array(5)
        .fill(null)
        .map(() =>
          request(app).post("/api/tokens/register").send({
            user_id: "concurrent-user",
            token: "concurrent-token",
            platform: "android",
          })
        );

      const responses = await Promise.all(promises);

      // All requests should succeed
      responses.forEach((response) => {
        expect(response.status).toBe(200);
        expect(response.body.ok).toBe(true);
      });

      // Only one token should exist in database
      const tokens = await DeviceToken.find({ token: "concurrent-token" });
      expect(tokens).toHaveLength(1);
    });

    test("should handle concurrent registrations with different tokens", async () => {
      const promises = Array(5)
        .fill(null)
        .map((_, i) =>
          request(app)
            .post("/api/tokens/register")
            .send({
              user_id: "multi-device-user",
              token: `token-device-${i}`,
              platform: "android",
            })
        );

      const responses = await Promise.all(promises);

      responses.forEach((response) => {
        expect(response.status).toBe(200);
      });

      // Should have 5 different tokens for same user
      const tokens = await DeviceToken.find({
        user_id: "multi-device-user",
      });
      expect(tokens).toHaveLength(5);
    });
  });

  // ========================================
  // Section 7: Integration with Other User Types
  // ========================================
  describe("Section 7: Different User Types", () => {
    test("should register token for client user", async () => {
      const response = await request(app).post("/api/tokens/register").send({
        user_id: "client-firebase-uid-123",
        token: "client-fcm-token",
        platform: "android",
      });

      expect(response.status).toBe(200);

      const savedToken = await DeviceToken.findOne({
        user_id: "client-firebase-uid-123",
      });
      expect(savedToken).toBeDefined();
    });

    test("should register token for seller user", async () => {
      const response = await request(app).post("/api/tokens/register").send({
        user_id: "seller-firebase-uid-456",
        token: "seller-fcm-token",
        platform: "ios",
      });

      expect(response.status).toBe(200);

      const savedToken = await DeviceToken.findOne({
        user_id: "seller-firebase-uid-456",
      });
      expect(savedToken).toBeDefined();
    });

    test("should register token for delivery agent", async () => {
      const response = await request(app).post("/api/tokens/register").send({
        user_id: "agent-firebase-uid-789",
        token: "agent-fcm-token",
        platform: "android",
      });

      expect(response.status).toBe(200);

      const savedToken = await DeviceToken.findOne({
        user_id: "agent-firebase-uid-789",
      });
      expect(savedToken).toBeDefined();
    });

    test("should register token for admin user", async () => {
      const response = await request(app).post("/api/tokens/register").send({
        user_id: "admin-id-001",
        token: "admin-fcm-token",
        platform: "web",
      });

      expect(response.status).toBe(200);

      const savedToken = await DeviceToken.findOne({ user_id: "admin-id-001" });
      expect(savedToken).toBeDefined();
    });
  });
});
