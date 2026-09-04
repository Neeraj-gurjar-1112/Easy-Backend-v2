/**
 * Coupon Validation Middleware - UNIT Tests
 *
 * Direct function testing to ensure coverage tracking
 * Tests validateCoupon and updateCouponUsage functions directly
 */

const {
  validateCoupon,
  updateCouponUsage,
} = require("../../lib/middleware/couponValidation");
const { PlatformSettings } = require("../../lib/models");
const {
  connectTestDB,
  closeTestDB,
  clearTestDB,
} = require("../testUtils/dbHandler");

describe("Coupon Validation Middleware - Unit Tests", () => {
  let mockReq, mockRes, mockNext;

  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();

    // Mock Express req, res, next
    mockReq = {
      body: {},
      couponData: null,
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();
  });

  describe("validateCoupon - Happy Paths", () => {
    test("should pass through when no coupon code provided", async () => {
      mockReq.body = {
        subtotal: 1000,
      };

      await validateCoupon(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.couponData).toEqual({
        valid: false,
        discount: 0,
        coupon: null,
      });
    });

    test("should validate valid coupon and calculate discount", async () => {
      await PlatformSettings.create({
        coupons: [
          {
            code: "SAVE20",
            percent: 20,
            active: true,
            minSubtotal: 100,
            validFrom: new Date(Date.now() - 24 * 60 * 60 * 1000),
            validTo: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            usage_limit: 100,
            usage_count: 0,
          },
        ],
      });

      mockReq.body = {
        coupon_code: "SAVE20",
        subtotal: 1000,
        client_id: "client123",
      };

      await validateCoupon(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.couponData.valid).toBe(true);
      expect(mockReq.couponData.discount).toBe(200); // 20% of 1000
      expect(mockReq.couponData.coupon.code).toBe("SAVE20");
    });

    test("should handle lowercase coupon codes", async () => {
      await PlatformSettings.create({
        coupons: [
          {
            code: "LOWERCASE",
            percent: 10,
            active: true,
            minSubtotal: 0,
          },
        ],
      });

      mockReq.body = {
        coupon_code: "lowercase",
        subtotal: 500,
      };

      await validateCoupon(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.couponData.valid).toBe(true);
      expect(mockReq.couponData.discount).toBe(50);
    });

    test("should round discount to 2 decimal places", async () => {
      await PlatformSettings.create({
        coupons: [
          {
            code: "WEIRD33",
            percent: 33.33,
            active: true,
            minSubtotal: 0,
          },
        ],
      });

      mockReq.body = {
        coupon_code: "WEIRD33",
        subtotal: 100,
      };

      await validateCoupon(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.couponData.discount).toBe(33.33);
    });
  });

  describe("validateCoupon - Error Cases", () => {
    test("should reject when no platform settings exist", async () => {
      mockReq.body = {
        coupon_code: "NONEXISTENT",
        subtotal: 1000,
      };

      await validateCoupon(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: "Invalid coupon code",
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    test("should reject when coupons array is empty", async () => {
      await PlatformSettings.create({ coupons: [] });

      mockReq.body = {
        coupon_code: "ANYTHING",
        subtotal: 1000,
      };

      await validateCoupon(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: "Invalid coupon code",
      });
    });

    test("should reject invalid coupon code", async () => {
      await PlatformSettings.create({
        coupons: [
          {
            code: "VALID",
            percent: 10,
            active: true,
          },
        ],
      });

      mockReq.body = {
        coupon_code: "INVALID",
        subtotal: 1000,
      };

      await validateCoupon(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: "Invalid coupon code",
      });
    });

    test("should reject inactive coupon", async () => {
      await PlatformSettings.create({
        coupons: [
          {
            code: "INACTIVE",
            percent: 20,
            active: false,
          },
        ],
      });

      mockReq.body = {
        coupon_code: "INACTIVE",
        subtotal: 1000,
      };

      await validateCoupon(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: "This coupon is no longer active",
      });
    });

    test("should reject coupon not yet valid", async () => {
      await PlatformSettings.create({
        coupons: [
          {
            code: "FUTURE",
            percent: 15,
            active: true,
            validFrom: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days future
          },
        ],
      });

      mockReq.body = {
        coupon_code: "FUTURE",
        subtotal: 1000,
      };

      await validateCoupon(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: "This coupon is not yet valid",
      });
    });

    test("should reject expired coupon", async () => {
      await PlatformSettings.create({
        coupons: [
          {
            code: "EXPIRED",
            percent: 10,
            active: true,
            validTo: new Date(Date.now() - 24 * 60 * 60 * 1000), // Expired yesterday
          },
        ],
      });

      mockReq.body = {
        coupon_code: "EXPIRED",
        subtotal: 1000,
      };

      await validateCoupon(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: "This coupon has expired",
      });
    });

    test("should reject when total usage limit reached", async () => {
      await PlatformSettings.create({
        coupons: [
          {
            code: "MAXED",
            percent: 10,
            active: true,
            usage_limit: 100,
            usage_count: 100,
          },
        ],
      });

      mockReq.body = {
        coupon_code: "MAXED",
        subtotal: 1000,
      };

      await validateCoupon(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: "This coupon has reached its usage limit",
      });
    });

    test("should reject when user usage limit reached", async () => {
      await PlatformSettings.create({
        coupons: [
          {
            code: "USERMAX",
            percent: 10,
            active: true,
            max_uses_per_user: 3,
            used_by: [
              {
                client_id: "client123",
                usage_count: 3,
                last_used: new Date(),
              },
            ],
          },
        ],
      });

      mockReq.body = {
        coupon_code: "USERMAX",
        subtotal: 1000,
        client_id: "client123",
      };

      await validateCoupon(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message:
          "You have already used this coupon the maximum number of times",
      });
    });

    test("should reject when subtotal below minimum", async () => {
      await PlatformSettings.create({
        coupons: [
          {
            code: "MIN500",
            percent: 10,
            active: true,
            minSubtotal: 500,
          },
        ],
      });

      mockReq.body = {
        coupon_code: "MIN500",
        subtotal: 300,
      };

      await validateCoupon(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: "Minimum order amount of ₹500 required for this coupon",
      });
    });

    test("should reject when category doesn't match", async () => {
      await PlatformSettings.create({
        coupons: [
          {
            code: "GROCERY20",
            percent: 20,
            active: true,
            categories: ["grocery"],
          },
        ],
      });

      mockReq.body = {
        coupon_code: "GROCERY20",
        subtotal: 1000,
        category: "Restaurants",
      };

      await validateCoupon(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: "This coupon is only valid for grocery categories",
      });
    });

    test("should handle category case insensitively", async () => {
      await PlatformSettings.create({
        coupons: [
          {
            code: "GROCERY20",
            percent: 20,
            active: true,
            categories: ["grocery"],
          },
        ],
      });

      mockReq.body = {
        coupon_code: "GROCERY20",
        subtotal: 1000,
        category: "Grocery", // Uppercase
      };

      await validateCoupon(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.couponData.valid).toBe(true);
    });

    test("should handle server errors gracefully", async () => {
      // Force error by mocking PlatformSettings.findOne to throw
      jest
        .spyOn(PlatformSettings, "findOne")
        .mockRejectedValueOnce(new Error("DB Error"));

      mockReq.body = {
        coupon_code: "ANY",
        subtotal: 1000,
      };

      await validateCoupon(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: "Failed to validate coupon",
        error: "DB Error",
      });

      jest.restoreAllMocks();
    });
  });

  describe("validateCoupon - Edge Cases", () => {
    test("should allow coupon with no date restrictions", async () => {
      await PlatformSettings.create({
        coupons: [
          {
            code: "NODATES",
            percent: 10,
            active: true,
            // No validFrom or validTo
          },
        ],
      });

      mockReq.body = {
        coupon_code: "NODATES",
        subtotal: 1000,
      };

      await validateCoupon(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.couponData.valid).toBe(true);
    });

    test("should allow coupon with no usage limits", async () => {
      await PlatformSettings.create({
        coupons: [
          {
            code: "UNLIMITED",
            percent: 5,
            active: true,
            // No usage_limit or max_uses_per_user
          },
        ],
      });

      mockReq.body = {
        coupon_code: "UNLIMITED",
        subtotal: 1000,
        client_id: "client123",
      };

      await validateCoupon(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.couponData.valid).toBe(true);
    });

    test("should allow coupon with no category restrictions", async () => {
      await PlatformSettings.create({
        coupons: [
          {
            code: "ALLCATS",
            percent: 10,
            active: true,
            categories: [], // Empty array = all categories
          },
        ],
      });

      mockReq.body = {
        coupon_code: "ALLCATS",
        subtotal: 1000,
        category: "Anything",
      };

      await validateCoupon(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.couponData.valid).toBe(true);
    });

    test("should calculate discount as 0 when no subtotal provided", async () => {
      await PlatformSettings.create({
        coupons: [
          {
            code: "NOSUBTOTAL",
            percent: 10,
            active: true,
          },
        ],
      });

      mockReq.body = {
        coupon_code: "NOSUBTOTAL",
        // No subtotal
      };

      await validateCoupon(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.couponData.valid).toBe(true);
      expect(mockReq.couponData.discount).toBe(0);
    });

    test("should allow user below per-user limit", async () => {
      await PlatformSettings.create({
        coupons: [
          {
            code: "USERTEST",
            percent: 10,
            active: true,
            max_uses_per_user: 5,
            used_by: [
              {
                client_id: "client123",
                usage_count: 2,
                last_used: new Date(),
              },
            ],
          },
        ],
      });

      mockReq.body = {
        coupon_code: "USERTEST",
        subtotal: 1000,
        client_id: "client123",
      };

      await validateCoupon(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.couponData.valid).toBe(true);
    });

    test("should allow new user when coupon has existing users", async () => {
      await PlatformSettings.create({
        coupons: [
          {
            code: "NEWUSER",
            percent: 10,
            active: true,
            max_uses_per_user: 3,
            used_by: [
              {
                client_id: "otherClient",
                usage_count: 3,
                last_used: new Date(),
              },
            ],
          },
        ],
      });

      mockReq.body = {
        coupon_code: "NEWUSER",
        subtotal: 1000,
        client_id: "client123", // New user
      };

      await validateCoupon(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.couponData.valid).toBe(true);
    });

    test("should handle usage_limit of 0", async () => {
      await PlatformSettings.create({
        coupons: [
          {
            code: "ZEROLIMIT",
            percent: 10,
            active: true,
            usage_limit: 0,
            usage_count: 0,
          },
        ],
      });

      mockReq.body = {
        coupon_code: "ZEROLIMIT",
        subtotal: 1000,
      };

      await validateCoupon(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: "This coupon has reached its usage limit",
      });
    });
  });

  describe("updateCouponUsage - Unit Tests", () => {
    test("should increment usage count for first-time user", async () => {
      const settings = await PlatformSettings.create({
        coupons: [
          {
            code: "FIRSTTIME",
            percent: 10,
            active: true,
            usage_count: 5,
            used_by: [],
          },
        ],
      });

      await updateCouponUsage("FIRSTTIME", "client123");

      const updated = await PlatformSettings.findById(settings._id);
      const coupon = updated.coupons.find((c) => c.code === "FIRSTTIME");

      expect(coupon.usage_count).toBe(6);
      expect(coupon.used_by).toHaveLength(1);
      expect(coupon.used_by[0].client_id).toBe("client123");
      expect(coupon.used_by[0].usage_count).toBe(1);
      expect(coupon.updated_at).toBeDefined();
    });

    test("should increment existing user usage count", async () => {
      const settings = await PlatformSettings.create({
        coupons: [
          {
            code: "REPEAT",
            percent: 10,
            active: true,
            usage_count: 10,
            used_by: [
              {
                client_id: "client123",
                usage_count: 2,
                last_used: new Date(Date.now() - 24 * 60 * 60 * 1000),
              },
            ],
          },
        ],
      });

      await updateCouponUsage("REPEAT", "client123");

      const updated = await PlatformSettings.findById(settings._id);
      const coupon = updated.coupons.find((c) => c.code === "REPEAT");

      expect(coupon.usage_count).toBe(11);
      expect(coupon.used_by).toHaveLength(1);
      expect(coupon.used_by[0].usage_count).toBe(3);
    });

    test("should handle lowercase coupon code", async () => {
      await PlatformSettings.create({
        coupons: [
          {
            code: "LOWERCASE",
            percent: 10,
            active: true,
            usage_count: 0,
            used_by: [],
          },
        ],
      });

      await updateCouponUsage("lowercase", "client123");

      const updated = await PlatformSettings.findOne();
      const coupon = updated.coupons.find((c) => c.code === "LOWERCASE");

      expect(coupon.usage_count).toBe(1);
    });

    test("should handle null coupon code gracefully", async () => {
      await updateCouponUsage(null, "client123");
      // Should not throw error
      expect(true).toBe(true);
    });

    test("should handle undefined coupon code gracefully", async () => {
      await updateCouponUsage(undefined, "client123");
      // Should not throw error
      expect(true).toBe(true);
    });

    test("should handle empty coupon code gracefully", async () => {
      await updateCouponUsage("", "client123");
      // Should not throw error
      expect(true).toBe(true);
    });

    test("should handle missing platform settings gracefully", async () => {
      await updateCouponUsage("NONEXISTENT", "client123");
      // Should not throw error
      expect(true).toBe(true);
    });

    test("should handle nonexistent coupon code gracefully", async () => {
      await PlatformSettings.create({
        coupons: [
          {
            code: "EXISTS",
            percent: 10,
            active: true,
          },
        ],
      });

      await updateCouponUsage("DOESNOTEXIST", "client123");
      // Should not throw error
      expect(true).toBe(true);
    });

    test("should update usage without client_id", async () => {
      const settings = await PlatformSettings.create({
        coupons: [
          {
            code: "NOCLIENT",
            percent: 10,
            active: true,
            usage_count: 5,
          },
        ],
      });

      await updateCouponUsage("NOCLIENT", null);

      const updated = await PlatformSettings.findById(settings._id);
      const coupon = updated.coupons.find((c) => c.code === "NOCLIENT");

      expect(coupon.usage_count).toBe(6);
      expect(coupon.used_by || []).toHaveLength(0);
    });

    test("should initialize used_by array if missing (line 182)", async () => {
      const settings = await PlatformSettings.create({
        coupons: [
          {
            code: "NOUSEDBY",
            percent: 10,
            active: true,
            usage_count: 0,
            used_by: [], // Mongoose initializes as empty array
          },
        ],
      });

      // Manually remove the used_by field to simulate old data without this field
      // This tests line 182: if (!coupon.used_by) { coupon.used_by = []; }
      await PlatformSettings.updateOne(
        { _id: settings._id, "coupons.code": "NOUSEDBY" },
        { $unset: { "coupons.$.used_by": "" } }
      );

      // Verify the field was removed
      const initial = await PlatformSettings.findById(settings._id).lean();
      const initialCoupon = initial.coupons.find((c) => c.code === "NOUSEDBY");
      expect(initialCoupon.used_by).toBeUndefined();

      await updateCouponUsage("NOUSEDBY", "client123");

      const updated = await PlatformSettings.findById(settings._id);
      const coupon = updated.coupons.find((c) => c.code === "NOUSEDBY");

      // Line 182 should have initialized the array
      expect(coupon.used_by).toHaveLength(1);
      expect(coupon.used_by[0].client_id).toBe("client123");
    });

    test("should handle database errors gracefully", async () => {
      // Mock findOne to throw error
      jest
        .spyOn(PlatformSettings, "findOne")
        .mockRejectedValueOnce(new Error("DB Error"));

      // Should not throw error
      await expect(
        updateCouponUsage("ANY", "client123")
      ).resolves.not.toThrow();

      jest.restoreAllMocks();
    });
  });
});
