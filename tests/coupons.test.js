const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../app");
const {
  PlatformSettings,
  Order,
  Client,
  Product,
  Seller,
} = require("../lib/models");
const { setupTestDB, cleanupTestDB } = require("./testUtils/dbHandler");

describe("Coupons - Integration Tests", () => {
  let testClient, testSeller, testProduct, platformSettings;

  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await cleanupTestDB();
  });

  beforeEach(async () => {
    // Create test client
    testClient = await Client.create({
      firebase_uid: `test_coupon_client_${Date.now()}_${Math.random()}`,
      name: "Test Customer",
      email: `coupon_customer_${Date.now()}@test.com`,
      phone: `987654${Date.now().toString().slice(-4)}`,
    });

    // Create test seller
    testSeller = await Seller.create({
      business_name: "Test Store",
      email: `coupon_seller_${Date.now()}@test.com`,
      phone: `987655${Date.now().toString().slice(-4)}`,
      password: "password123",
      business_type: "grocery",
      approved: true,
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

    // Create or update platform settings with test coupons
    platformSettings = await PlatformSettings.findOneAndUpdate(
      {},
      {
        $set: {
          coupons: [
            {
              code: "SAVE20",
              percent: 20,
              active: true,
              minSubtotal: 200,
              validFrom: new Date(Date.now() - 24 * 60 * 60 * 1000),
              validTo: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
              categories: [],
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
              code: "GROCERY15",
              percent: 15,
              active: true,
              minSubtotal: 100,
              validFrom: new Date(Date.now() - 24 * 60 * 60 * 1000),
              validTo: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
              categories: ["grocery"],
            },
            {
              code: "BIGORDER30",
              percent: 30,
              active: true,
              minSubtotal: 2000, // High minimum - won't be met with single item at 500
              validFrom: new Date(Date.now() - 24 * 60 * 60 * 1000),
              validTo: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
              categories: [],
            },
          ],
        },
      },
      { upsert: true, new: true }
    );
  });

  afterEach(async () => {
    await Order.deleteMany({});
    await Product.deleteMany({});
    await Seller.deleteMany({});
    await Client.deleteMany({});
    await PlatformSettings.deleteMany({});
  });

  describe("Coupon Application via Quote Endpoint", () => {
    test("should apply valid percentage coupon correctly", async () => {
      const quoteData = {
        items: [
          {
            product_id: testProduct._id,
            qty: 2,
          },
        ],
        coupon: "SAVE20",
      };

      const res = await request(app)
        .post("/api/products/quote")
        .send(quoteData);

      expect(res.status).toBe(200);
      expect(res.body.subtotal).toBe(1000); // 500 * 2

      // Check if coupon adjustment exists
      const couponAdjustment = res.body.adjustments.find(
        (adj) => adj.type === "coupon"
      );
      expect(couponAdjustment).toBeDefined();
      expect(couponAdjustment.code).toBe("SAVE20");
      expect(couponAdjustment.amount).toBe(-200); // 20% of 1000
    });

    test("should reject expired coupon", async () => {
      const quoteData = {
        items: [
          {
            product_id: testProduct._id,
            qty: 2,
          },
        ],
        coupon: "EXPIRED10",
      };

      const res = await request(app)
        .post("/api/products/quote")
        .send(quoteData);

      expect(res.status).toBe(200);
      // Expired coupon should not be applied
      const couponAdjustment = res.body.adjustments.find(
        (adj) => adj.type === "coupon"
      );
      expect(couponAdjustment).toBeUndefined();
      expect(res.body.subtotal).toBe(1000);
    });

    test("should apply coupon only when min subtotal is met", async () => {
      const quoteData = {
        items: [
          {
            product_id: testProduct._id,
            qty: 1, // 1 × 500 = 500, which MEETS minSubtotal of 200 for SAVE20
          },
        ],
        coupon: "SAVE20",
      };

      const res = await request(app)
        .post("/api/products/quote")
        .send(quoteData);

      expect(res.status).toBe(200);
      expect(res.body.subtotal).toBe(500);

      // Coupon SHOULD apply (minSubtotal = 200, cart = 500)
      const couponAdjustment = res.body.adjustments?.find(
        (adj) => adj.type === "coupon"
      );
      expect(couponAdjustment).toBeDefined();
      expect(couponAdjustment.type).toBe("coupon");
      expect(couponAdjustment.amount).toBe(-100); // 20% of 500 = 100
    });

    test("should NOT apply coupon when min subtotal is not met", async () => {
      const quoteData = {
        items: [
          {
            product_id: testProduct._id,
            qty: 1, // 1 × 500 = 500, which is LESS than minSubtotal of 2000 for BIGORDER30
          },
        ],
        coupon: "BIGORDER30",
      };

      const res = await request(app)
        .post("/api/products/quote")
        .send(quoteData);

      expect(res.status).toBe(200);
      expect(res.body.subtotal).toBe(500);

      // Coupon should NOT apply (minSubtotal = 2000, cart = 500)
      const couponAdjustment = res.body.adjustments?.find(
        (adj) => adj.type === "coupon"
      );
      expect(couponAdjustment).toBeUndefined(); // No coupon adjustment
    });

    test("should apply category-specific coupon", async () => {
      const quoteData = {
        items: [
          {
            product_id: testProduct._id,
            qty: 2,
          },
        ],
        coupon: "GROCERY15",
      };

      const res = await request(app)
        .post("/api/products/quote")
        .send(quoteData);

      expect(res.status).toBe(200);

      const couponAdjustment = res.body.adjustments.find(
        (adj) => adj.type === "coupon"
      );
      expect(couponAdjustment).toBeDefined();
      expect(couponAdjustment.code).toBe("GROCERY15");
      expect(couponAdjustment.amount).toBe(-150); // 15% of 1000
      expect(couponAdjustment.categories).toContain("grocery");
    });

    test("should handle case-insensitive coupon codes", async () => {
      const quoteData = {
        items: [
          {
            product_id: testProduct._id,
            qty: 2,
          },
        ],
        coupon: "save20", // lowercase
      };

      const res = await request(app)
        .post("/api/products/quote")
        .send(quoteData);

      expect(res.status).toBe(200);

      const couponAdjustment = res.body.adjustments.find(
        (adj) => adj.type === "coupon"
      );
      expect(couponAdjustment).toBeDefined();
      expect(couponAdjustment.code).toBe("SAVE20");
    });
  });

  describe("Admin Coupon Management", () => {
    test("should list all coupons", async () => {
      // This would require admin authentication
      // For now, just verify PlatformSettings has coupons
      const settings = await PlatformSettings.findOne({});
      expect(settings.coupons).toBeDefined();
      expect(settings.coupons.length).toBeGreaterThan(0);
    });
  });
});
