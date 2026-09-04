/**
 * Phase 18: Coupon Validation Middleware Testing
 * Target: middleware/couponValidation.js (0% -> 85-95% coverage)
 *
 * Test Coverage:
 * - validateCoupon middleware: 10 validation rules
 * - updateCouponUsage helper: usage tracking logic
 *
 * Sections:
 * 1. Basic Setup (2 tests)
 * 2. Invalid/Inactive Codes (4 tests)
 * 3. Date Validation (2 tests)
 * 4. Usage Limits (4 tests)
 * 5. Amount/Category Rules (3 tests)
 * 6. Successful Validation (3 tests)
 * 7. updateCouponUsage Function (6 tests)
 *
 * Total: 24 tests
 */

const {
  validateCoupon,
  updateCouponUsage,
} = require("../lib/middleware/couponValidation");
const { PlatformSettings } = require("../lib/models");
const logger = require("../lib/util/logger");
const {
  connectTestDB,
  closeTestDB,
  clearTestDB,
} = require("./testUtils/dbHandler");

// Mock logger to reduce noise
jest.mock("../lib/util/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
}));

describe("Phase 18: Coupon Validation Middleware", () => {
  let mockReq, mockRes, mockNext, mockSettings;

  beforeAll(async () => {
    await connectTestDB();
  }, 30000);

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    // Clear all mocks
    jest.clearAllMocks();

    // Setup mock response object
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    // Setup mock next function
    mockNext = jest.fn();

    // Create base platform settings with sample coupons
    mockSettings = await PlatformSettings.create({
      coupons: [
        {
          code: "ACTIVE10",
          percent: 10,
          active: true,
          validFrom: new Date(Date.now() - 86400000), // Yesterday
          validTo: new Date(Date.now() + 86400000), // Tomorrow
          usage_limit: 100,
          usage_count: 0,
          max_uses_per_user: 3,
          minSubtotal: 50,
          categories: ["grocery", "vegetable"], // Valid enum values
          used_by: [],
          updated_at: new Date(),
        },
        {
          code: "INACTIVE50",
          percent: 50,
          active: false,
          validFrom: new Date(Date.now() - 86400000),
          validTo: new Date(Date.now() + 86400000),
          usage_limit: null,
          usage_count: 0,
          used_by: [],
          updated_at: new Date(),
        },
        {
          code: "FUTURE20",
          percent: 20,
          active: true,
          validFrom: new Date(Date.now() + 86400000), // Tomorrow
          validTo: new Date(Date.now() + 172800000), // 2 days
          usage_limit: null,
          usage_count: 0,
          used_by: [],
          updated_at: new Date(),
        },
        {
          code: "EXPIRED30",
          percent: 30,
          active: true,
          validFrom: new Date(Date.now() - 172800000), // 2 days ago
          validTo: new Date(Date.now() - 86400000), // Yesterday
          usage_limit: null,
          usage_count: 0,
          used_by: [],
          updated_at: new Date(),
        },
        {
          code: "LIMITREACHED",
          percent: 15,
          active: true,
          validFrom: new Date(Date.now() - 86400000),
          validTo: new Date(Date.now() + 86400000),
          usage_limit: 5,
          usage_count: 5, // Already at limit
          max_uses_per_user: 2,
          used_by: [],
          updated_at: new Date(),
        },
      ],
    });
  });

  afterEach(async () => {
    // Clean up platform settings
    await PlatformSettings.deleteMany({});
  });

  // ============================================================================
  // Section 1: Basic Setup (2 tests)
  // ============================================================================

  describe("Section 1: Basic Setup", () => {
    test("should allow request without coupon code (skip validation)", async () => {
      mockReq = {
        body: {
          client_id: "test_client_123",
          subtotal: 100,
        },
      };

      await validateCoupon(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.couponData).toEqual({
        valid: false,
        discount: 0,
        coupon: null,
      });
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    test("should return 400 when no coupons exist in platform settings", async () => {
      // Remove all coupons
      await PlatformSettings.deleteMany({});

      mockReq = {
        body: {
          coupon_code: "ANYCODE",
          client_id: "test_client_123",
          subtotal: 100,
        },
      };

      await validateCoupon(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: "Invalid coupon code",
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Section 2: Invalid/Inactive Codes (4 tests)
  // ============================================================================

  describe("Section 2: Invalid/Inactive Codes", () => {
    test("should return 400 for non-existent coupon code", async () => {
      mockReq = {
        body: {
          coupon_code: "NONEXISTENT",
          client_id: "test_client_123",
          subtotal: 100,
        },
      };

      await validateCoupon(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: "Invalid coupon code",
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    test("should return 400 for inactive coupon", async () => {
      mockReq = {
        body: {
          coupon_code: "INACTIVE50",
          client_id: "test_client_123",
          subtotal: 100,
        },
      };

      await validateCoupon(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: "This coupon is no longer active",
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    test("should handle uppercase/lowercase coupon codes", async () => {
      mockReq = {
        body: {
          coupon_code: "active10", // lowercase
          client_id: "test_client_123",
          subtotal: 100,
        },
      };

      await validateCoupon(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.couponData.valid).toBe(true);
      expect(mockReq.couponData.coupon.code).toBe("ACTIVE10");
    });

    test("should handle error when PlatformSettings.findOne fails", async () => {
      jest
        .spyOn(PlatformSettings, "findOne")
        .mockRejectedValueOnce(new Error("Database connection failed"));

      mockReq = {
        body: {
          coupon_code: "ACTIVE10",
          client_id: "test_client_123",
          subtotal: 100,
        },
      };

      await validateCoupon(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: "Failed to validate coupon",
        error: "Database connection failed",
      });
      expect(logger.error).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Section 3: Date Validation (2 tests)
  // ============================================================================

  describe("Section 3: Date Validation", () => {
    test("should return 400 for coupon not yet valid", async () => {
      mockReq = {
        body: {
          coupon_code: "FUTURE20",
          client_id: "test_client_123",
          subtotal: 100,
        },
      };

      await validateCoupon(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: "This coupon is not yet valid",
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    test("should return 400 for expired coupon", async () => {
      mockReq = {
        body: {
          coupon_code: "EXPIRED30",
          client_id: "test_client_123",
          subtotal: 100,
        },
      };

      await validateCoupon(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: "This coupon has expired",
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Section 4: Usage Limits (4 tests)
  // ============================================================================

  describe("Section 4: Usage Limits", () => {
    test("should return 400 when total usage limit reached", async () => {
      mockReq = {
        body: {
          coupon_code: "LIMITREACHED",
          client_id: "test_client_123",
          subtotal: 100,
        },
      };

      await validateCoupon(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: "This coupon has reached its usage limit",
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    test("should return 400 when per-user usage limit reached", async () => {
      // Update ACTIVE10 to have user at limit
      const settings = await PlatformSettings.findOne();
      const coupon = settings.coupons.find((c) => c.code === "ACTIVE10");
      coupon.used_by = [
        {
          client_id: "test_client_123",
          usage_count: 3, // At max_uses_per_user limit
          last_used: new Date(),
        },
      ];
      await settings.save();

      mockReq = {
        body: {
          coupon_code: "ACTIVE10",
          client_id: "test_client_123",
          subtotal: 100,
        },
      };

      await validateCoupon(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message:
          "You have already used this coupon the maximum number of times",
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    test("should allow user below per-user limit", async () => {
      // Update ACTIVE10 to have user below limit
      const settings = await PlatformSettings.findOne();
      const coupon = settings.coupons.find((c) => c.code === "ACTIVE10");
      coupon.used_by = [
        {
          client_id: "test_client_123",
          usage_count: 2, // Below max_uses_per_user (3)
          last_used: new Date(),
        },
      ];
      await settings.save();

      mockReq = {
        body: {
          coupon_code: "ACTIVE10",
          client_id: "test_client_123",
          subtotal: 100,
        },
      };

      await validateCoupon(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.couponData.valid).toBe(true);
    });

    test("should allow coupon without usage limits", async () => {
      // INACTIVE50 has usage_limit: null (but it's inactive, so create new one)
      const settings = await PlatformSettings.findOne();
      settings.coupons.push({
        code: "NOLIMIT25",
        percent: 25,
        active: true,
        validFrom: new Date(Date.now() - 86400000),
        validTo: new Date(Date.now() + 86400000),
        usage_limit: null, // No limit
        usage_count: 999, // High count, but no limit
        used_by: [],
        updated_at: new Date(),
      });
      await settings.save();

      mockReq = {
        body: {
          coupon_code: "NOLIMIT25",
          client_id: "test_client_123",
          subtotal: 100,
        },
      };

      await validateCoupon(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.couponData.valid).toBe(true);
    });
  });

  // ============================================================================
  // Section 5: Amount/Category Rules (3 tests)
  // ============================================================================

  describe("Section 5: Amount/Category Rules", () => {
    test("should return 400 when subtotal below minimum", async () => {
      mockReq = {
        body: {
          coupon_code: "ACTIVE10", // minSubtotal: 50
          client_id: "test_client_123",
          subtotal: 30, // Below minimum
        },
      };

      await validateCoupon(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: "Minimum order amount of ₹50 required for this coupon",
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    test("should return 400 for invalid category", async () => {
      mockReq = {
        body: {
          coupon_code: "ACTIVE10", // categories: ["grocery", "vegetable"]
          client_id: "test_client_123",
          subtotal: 100,
          category: "food", // Not in allowed categories
        },
      };

      await validateCoupon(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: "This coupon is only valid for grocery, vegetable categories",
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    test("should allow valid category", async () => {
      mockReq = {
        body: {
          coupon_code: "ACTIVE10",
          client_id: "test_client_123",
          subtotal: 100,
          category: "vegetable", // Valid category
        },
      };

      await validateCoupon(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.couponData.valid).toBe(true);
    });
  });

  // ============================================================================
  // Section 6: Successful Validation (3 tests)
  // ============================================================================

  describe("Section 6: Successful Validation", () => {
    test("should successfully validate coupon with all checks passed", async () => {
      mockReq = {
        body: {
          coupon_code: "ACTIVE10",
          client_id: "test_client_123",
          subtotal: 100,
          category: "grocery",
        },
      };

      await validateCoupon(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.couponData).toEqual({
        valid: true,
        discount: 10, // 10% of 100
        coupon: {
          code: "ACTIVE10",
          percent: 10,
        },
      });
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Coupon validated: ACTIVE10")
      );
    });

    test("should calculate discount correctly with different percentages", async () => {
      // Use FUTURE20 but modify dates to make it valid
      const settings = await PlatformSettings.findOne();
      const coupon = settings.coupons.find((c) => c.code === "FUTURE20");
      coupon.validFrom = new Date(Date.now() - 86400000); // Make it valid now
      await settings.save();

      mockReq = {
        body: {
          coupon_code: "FUTURE20", // 20% discount
          client_id: "test_client_123",
          subtotal: 150,
        },
      };

      await validateCoupon(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.couponData).toEqual({
        valid: true,
        discount: 30, // 20% of 150
        coupon: {
          code: "FUTURE20",
          percent: 20,
        },
      });
    });

    test("should round discount to 2 decimal places", async () => {
      mockReq = {
        body: {
          coupon_code: "ACTIVE10",
          client_id: "test_client_123",
          subtotal: 99.99, // Will create 9.999 before rounding
          category: "grocery",
        },
      };

      await validateCoupon(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.couponData.discount).toBe(10); // 9.999 rounded to 10.00
    });
  });

  // ============================================================================
  // Section 7: updateCouponUsage Function (6 tests)
  // ============================================================================

  describe("Section 7: updateCouponUsage Function", () => {
    test("should increment total usage count for first-time user", async () => {
      const beforeSettings = await PlatformSettings.findOne();
      const beforeCoupon = beforeSettings.coupons.find(
        (c) => c.code === "ACTIVE10"
      );
      const beforeCount = beforeCoupon.usage_count;

      await updateCouponUsage("ACTIVE10", "new_client_456");

      const afterSettings = await PlatformSettings.findOne();
      const afterCoupon = afterSettings.coupons.find(
        (c) => c.code === "ACTIVE10"
      );

      expect(afterCoupon.usage_count).toBe(beforeCount + 1);
      expect(afterCoupon.used_by).toHaveLength(1);
      expect(afterCoupon.used_by[0]).toMatchObject({
        client_id: "new_client_456",
        usage_count: 1,
      });
      expect(afterCoupon.used_by[0].last_used).toBeInstanceOf(Date);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Coupon usage updated: ACTIVE10")
      );
    });

    test("should increment user-specific count for returning user", async () => {
      // Setup: User has already used coupon once
      const settings = await PlatformSettings.findOne();
      const coupon = settings.coupons.find((c) => c.code === "ACTIVE10");
      coupon.usage_count = 5;
      coupon.used_by = [
        {
          client_id: "returning_client_789",
          usage_count: 1,
          last_used: new Date(Date.now() - 86400000), // Yesterday
        },
      ];
      await settings.save();

      await updateCouponUsage("ACTIVE10", "returning_client_789");

      const afterSettings = await PlatformSettings.findOne();
      const afterCoupon = afterSettings.coupons.find(
        (c) => c.code === "ACTIVE10"
      );

      expect(afterCoupon.usage_count).toBe(6); // Incremented
      expect(afterCoupon.used_by).toHaveLength(1);
      expect(afterCoupon.used_by[0].usage_count).toBe(2); // User count incremented
    });

    test("should handle no coupon code provided", async () => {
      await updateCouponUsage(null, "test_client_123");
      await updateCouponUsage(undefined, "test_client_123");
      await updateCouponUsage("", "test_client_123");

      // Should not throw errors and not modify database
      const settings = await PlatformSettings.findOne();
      expect(
        settings.coupons.find((c) => c.code === "ACTIVE10").usage_count
      ).toBe(0);
    });

    test("should handle non-existent coupon code gracefully", async () => {
      await updateCouponUsage("NONEXISTENT", "test_client_123");

      // Should not throw error
      expect(logger.error).not.toHaveBeenCalled();
    });

    test("should handle missing PlatformSettings gracefully", async () => {
      await PlatformSettings.deleteMany({});

      await updateCouponUsage("ACTIVE10", "test_client_123");

      // Should not throw error
      expect(logger.error).not.toHaveBeenCalled();
    });

    test("should handle database save error gracefully", async () => {
      // Mock save to throw error
      jest
        .spyOn(PlatformSettings.prototype, "save")
        .mockRejectedValueOnce(new Error("Database write failed"));

      await updateCouponUsage("ACTIVE10", "test_client_123");

      expect(logger.error).toHaveBeenCalledWith(
        "Error updating coupon usage:",
        expect.any(Error)
      );
      // Should not throw - this is a non-critical operation
    });
  });
});
