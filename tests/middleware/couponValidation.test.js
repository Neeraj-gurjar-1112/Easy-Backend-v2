/**
 * Coupon Validation Middleware Tests
 *
 * CURRENT COVERAGE: 0%
 * TARGET COVERAGE: 95%
 * PRIORITY: 🔴 HIGH (Business Logic Critical)
 *
 * This middleware is untested but handles money calculations!
 */

const request = require("supertest");
const app = require("../../app");
const {
  connectTestDB,
  closeTestDB,
  clearTestDB,
} = require("../testUtils/dbHandler");
const {
  PlatformSettings,
  Client,
  Product,
  Seller,
} = require("../../lib/models");

describe("Coupon Validation Middleware - Complete Coverage", () => {
  let testClient;
  let testSeller;
  let testProduct;
  let platformSettings;

  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();

    // Create test seller
    testSeller = await Seller.create({
      name: "Test Seller",
      business_name: "Test Business",
      email: `seller${Date.now()}@test.com`,
      phone: "9876543210",
      firebase_uid: `seller_${Date.now()}`,
      approved: true,
      active: true,
    });

    // Create test client
    testClient = await Client.create({
      name: "Test Client",
      email: `client${Date.now()}@test.com`,
      phone: "9876543211",
      firebase_uid: `client_${Date.now()}`,
    });

    // Create test product
    testProduct = await Product.create({
      seller_id: testSeller._id,
      name: "Test Product",
      category: "Grocery",
      price: 500,
      stock: 100,
      status: "active",
    });

    // Create platform settings with various coupons
    platformSettings = await PlatformSettings.create({
      coupons: [
        {
          code: "VALID20",
          percent: 20,
          active: true,
          minSubtotal: 200,
          validFrom: new Date(Date.now() - 24 * 60 * 60 * 1000),
          validTo: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          categories: [],
          max_uses_per_user: 5,
          usage_limit: 100,
          usage_count: 0,
        },
        {
          code: "EXPIRED10",
          percent: 10,
          active: true,
          minSubtotal: 100,
          validFrom: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          validTo: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // Expired yesterday
          categories: [],
        },
        {
          code: "NOTSTARTED",
          percent: 15,
          active: true,
          minSubtotal: 100,
          validFrom: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Starts in 7 days
          validTo: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          categories: [],
        },
        {
          code: "INACTIVE25",
          percent: 25,
          active: false, // Disabled
          minSubtotal: 100,
          validFrom: new Date(Date.now() - 24 * 60 * 60 * 1000),
          validTo: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          categories: [],
        },
        {
          code: "GROCERY15",
          percent: 15,
          active: true,
          minSubtotal: 100,
          validFrom: new Date(Date.now() - 24 * 60 * 60 * 1000),
          validTo: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          categories: ["grocery"], // Category specific
        },
        {
          code: "FOOD20",
          percent: 20,
          active: true,
          minSubtotal: 500,
          validFrom: new Date(Date.now() - 24 * 60 * 60 * 1000),
          validTo: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          categories: ["food"], // Different category
        },
        {
          code: "MAXED5",
          percent: 5,
          active: true,
          minSubtotal: 100,
          validFrom: new Date(Date.now() - 24 * 60 * 60 * 1000),
          validTo: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          categories: [],
          usage_limit: 5,
          usage_count: 5, // Already at max
        },
        {
          code: "HIGHMIN",
          percent: 30,
          active: true,
          minSubtotal: 5000, // High minimum
          validFrom: new Date(Date.now() - 24 * 60 * 60 * 1000),
          validTo: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          categories: [],
        },
      ],
    });
  });

  // ==========================================
  // HAPPY PATH TESTS
  // ==========================================

  describe("✅ Happy Path - Valid Coupon Application", () => {
    test("should apply valid coupon with correct discount", async () => {
      const quoteData = {
        items: [{ product_id: testProduct._id, qty: 2 }], // 1000 subtotal
        coupon: "VALID20",
      };

      const res = await request(app)
        .post("/api/products/quote")
        .send(quoteData);

      expect(res.status).toBe(200);
      expect(res.body.subtotal).toBe(1000);

      const couponAdj = res.body.adjustments?.find(
        (adj) => adj.type === "coupon"
      );
      expect(couponAdj).toBeDefined();
      expect(couponAdj.code).toBe("VALID20");
      expect(couponAdj.amount).toBe(-200); // 20% of 1000
    });

    test("should handle case-insensitive coupon codes", async () => {
      const quoteData = {
        items: [{ product_id: testProduct._id, qty: 2 }],
        coupon: "valid20", // lowercase
      };

      const res = await request(app)
        .post("/api/products/quote")
        .send(quoteData);

      expect(res.status).toBe(200);
      const couponAdj = res.body.adjustments?.find(
        (adj) => adj.type === "coupon"
      );
      expect(couponAdj).toBeDefined();
      expect(couponAdj.code).toBe("VALID20");
    });

    test("should work when no coupon is provided", async () => {
      const quoteData = {
        items: [{ product_id: testProduct._id, qty: 1 }],
        // No coupon field
      };

      const res = await request(app)
        .post("/api/products/quote")
        .send(quoteData);

      expect(res.status).toBe(200);
      expect(res.body.subtotal).toBe(500);

      const couponAdj = res.body.adjustments?.find(
        (adj) => adj.type === "coupon"
      );
      expect(couponAdj).toBeUndefined();
    });
  });

  // ==========================================
  // ERROR HANDLING TESTS
  // ==========================================

  describe("❌ Error Handling - Invalid Coupons", () => {
    test("should reject non-existent coupon code", async () => {
      const quoteData = {
        items: [{ product_id: testProduct._id, qty: 2 }],
        coupon: "DOESNOTEXIST",
      };

      const res = await request(app)
        .post("/api/products/quote")
        .send(quoteData);

      expect(res.status).toBe(200);
      const couponAdj = res.body.adjustments?.find(
        (adj) => adj.type === "coupon"
      );
      expect(couponAdj).toBeUndefined();
    });

    test("should reject expired coupon", async () => {
      const quoteData = {
        items: [{ product_id: testProduct._id, qty: 2 }],
        coupon: "EXPIRED10",
      };

      const res = await request(app)
        .post("/api/products/quote")
        .send(quoteData);

      expect(res.status).toBe(200);
      const couponAdj = res.body.adjustments?.find(
        (adj) => adj.type === "coupon"
      );
      expect(couponAdj).toBeUndefined();
    });

    test("should reject coupon that hasn't started yet", async () => {
      const quoteData = {
        items: [{ product_id: testProduct._id, qty: 2 }],
        coupon: "NOTSTARTED",
      };

      const res = await request(app)
        .post("/api/products/quote")
        .send(quoteData);

      expect(res.status).toBe(200);
      const couponAdj = res.body.adjustments?.find(
        (adj) => adj.type === "coupon"
      );
      expect(couponAdj).toBeUndefined();
    });

    test("should reject inactive coupon", async () => {
      const quoteData = {
        items: [{ product_id: testProduct._id, qty: 2 }],
        coupon: "INACTIVE25",
      };

      const res = await request(app)
        .post("/api/products/quote")
        .send(quoteData);

      expect(res.status).toBe(200);
      const couponAdj = res.body.adjustments?.find(
        (adj) => adj.type === "coupon"
      );
      expect(couponAdj).toBeUndefined();
    });
  });

  // ==========================================
  // BUSINESS RULE TESTS
  // ==========================================

  describe("📏 Business Rules - Minimum Subtotal", () => {
    test("should apply coupon when minimum subtotal is met", async () => {
      const quoteData = {
        items: [{ product_id: testProduct._id, qty: 1 }], // 500 subtotal
        coupon: "VALID20", // minSubtotal = 200
      };

      const res = await request(app)
        .post("/api/products/quote")
        .send(quoteData);

      expect(res.status).toBe(200);
      const couponAdj = res.body.adjustments?.find(
        (adj) => adj.type === "coupon"
      );
      expect(couponAdj).toBeDefined(); // Should apply (500 >= 200)
    });

    test("should NOT apply coupon when minimum subtotal is not met", async () => {
      const quoteData = {
        items: [{ product_id: testProduct._id, qty: 1 }], // 500 subtotal
        coupon: "HIGHMIN", // minSubtotal = 5000
      };

      const res = await request(app)
        .post("/api/products/quote")
        .send(quoteData);

      expect(res.status).toBe(200);
      const couponAdj = res.body.adjustments?.find(
        (adj) => adj.type === "coupon"
      );
      expect(couponAdj).toBeUndefined(); // Should NOT apply (500 < 5000)
    });
  });

  describe("🏷️ Category Restrictions", () => {
    test("should apply category-specific coupon to matching category", async () => {
      const quoteData = {
        items: [{ product_id: testProduct._id, qty: 2 }], // Grocery category
        coupon: "GROCERY15",
      };

      const res = await request(app)
        .post("/api/products/quote")
        .send(quoteData);

      expect(res.status).toBe(200);
      const couponAdj = res.body.adjustments?.find(
        (adj) => adj.type === "coupon"
      );
      expect(couponAdj).toBeDefined();
      expect(couponAdj.code).toBe("GROCERY15");
    });

    test("should NOT apply coupon to wrong category", async () => {
      const quoteData = {
        items: [{ product_id: testProduct._id, qty: 2 }], // Grocery category
        coupon: "FOOD20", // Food only (different from Grocery)
      };

      const res = await request(app)
        .post("/api/products/quote")
        .send(quoteData);

      expect(res.status).toBe(200);
      const couponAdj = res.body.adjustments?.find(
        (adj) => adj.type === "coupon"
      );
      expect(couponAdj).toBeUndefined();
    });
  });

  describe("🔢 Usage Limits", () => {
    test("should reject coupon that has reached max total usage", async () => {
      const quoteData = {
        items: [{ product_id: testProduct._id, qty: 2 }],
        coupon: "MAXED5", // currentTotalUsage = 5, maxTotalUsage = 5
      };

      const res = await request(app)
        .post("/api/products/quote")
        .send(quoteData);

      expect(res.status).toBe(200);
      const couponAdj = res.body.adjustments?.find(
        (adj) => adj.type === "coupon"
      );
      expect(couponAdj).toBeUndefined(); // Should reject
    });

    // TODO: Add per-user usage limit tests
    // This requires tracking coupon usage per user in orders
  });

  // ==========================================
  // EDGE CASES
  // ==========================================

  describe("⚠️ Edge Cases", () => {
    test("should handle empty coupon string", async () => {
      const quoteData = {
        items: [{ product_id: testProduct._id, qty: 1 }],
        coupon: "", // Empty string
      };

      const res = await request(app)
        .post("/api/products/quote")
        .send(quoteData);

      expect(res.status).toBe(200);
      expect(res.body.subtotal).toBe(500);
    });

    test("should handle whitespace in coupon code", async () => {
      const quoteData = {
        items: [{ product_id: testProduct._id, qty: 2 }],
        coupon: "  VALID20  ", // Whitespace
      };

      const res = await request(app)
        .post("/api/products/quote")
        .send(quoteData);

      expect(res.status).toBe(200);
      const couponAdj = res.body.adjustments?.find(
        (adj) => adj.type === "coupon"
      );
      expect(couponAdj).toBeDefined(); // Should trim and work
    });

    test("should handle null coupon", async () => {
      const quoteData = {
        items: [{ product_id: testProduct._id, qty: 1 }],
        coupon: null,
      };

      const res = await request(app)
        .post("/api/products/quote")
        .send(quoteData);

      expect(res.status).toBe(200);
    });

    test("should handle cart with subtotal of exactly zero", async () => {
      // This is an edge case - what if free items?
      const quoteData = {
        items: [{ product_id: testProduct._id, qty: 0 }],
        coupon: "VALID20",
      };

      const res = await request(app)
        .post("/api/products/quote")
        .send(quoteData);

      // Should handle gracefully
      expect(res.status).toBe(200);
    });
  });

  // ==========================================
  // SECURITY TESTS
  // ==========================================

  describe("🔒 Security Tests", () => {
    test("should prevent coupon code injection attempts", async () => {
      const quoteData = {
        items: [{ product_id: testProduct._id, qty: 2 }],
        coupon: "'; DROP TABLE coupons; --",
      };

      const res = await request(app)
        .post("/api/products/quote")
        .send(quoteData);

      // Should not crash, should reject invalid code
      expect(res.status).toBe(200);
      const couponAdj = res.body.adjustments?.find(
        (adj) => adj.type === "coupon"
      );
      expect(couponAdj).toBeUndefined();
    });

    test("should handle extremely long coupon codes", async () => {
      const quoteData = {
        items: [{ product_id: testProduct._id, qty: 2 }],
        coupon: "A".repeat(10000), // 10k character code
      };

      const res = await request(app)
        .post("/api/products/quote")
        .send(quoteData);

      expect(res.status).toBe(200);
      const couponAdj = res.body.adjustments?.find(
        (adj) => adj.type === "coupon"
      );
      expect(couponAdj).toBeUndefined();
    });

    test("should handle special characters in coupon code", async () => {
      const quoteData = {
        items: [{ product_id: testProduct._id, qty: 2 }],
        coupon: "<script>alert('xss')</script>",
      };

      const res = await request(app)
        .post("/api/products/quote")
        .send(quoteData);

      expect(res.status).toBe(200);
      const couponAdj = res.body.adjustments?.find(
        (adj) => adj.type === "coupon"
      );
      expect(couponAdj).toBeUndefined();
    });
  });

  // ==========================================
  // PERFORMANCE TESTS
  // ==========================================

  describe("⚡ Performance Tests", () => {
    test("should handle coupon validation within acceptable time", async () => {
      const quoteData = {
        items: [{ product_id: testProduct._id, qty: 2 }],
        coupon: "VALID20",
      };

      const start = Date.now();
      const res = await request(app)
        .post("/api/products/quote")
        .send(quoteData);
      const duration = Date.now() - start;

      expect(res.status).toBe(200);
      expect(duration).toBeLessThan(500); // Should complete in under 500ms
    });
  });
});

/**
 * COVERAGE CHECKLIST:
 *
 * ✅ Valid coupon application
 * ✅ Case-insensitive codes
 * ✅ No coupon provided
 * ✅ Invalid coupon codes
 * ✅ Expired coupons
 * ✅ Future-dated coupons
 * ✅ Inactive coupons
 * ✅ Minimum subtotal enforcement
 * ✅ Category restrictions
 * ✅ Usage limits (total)
 * ⚠️  Usage limits (per-user) - TODO
 * ✅ Empty/null/whitespace handling
 * ✅ SQL injection prevention
 * ✅ XSS prevention
 * ✅ Long input handling
 * ✅ Performance baseline
 *
 * EXPECTED COVERAGE: 90-95%
 * ESTIMATED TIME: 4-6 hours
 * BUSINESS IMPACT: HIGH (Prevents coupon abuse, revenue loss)
 */
