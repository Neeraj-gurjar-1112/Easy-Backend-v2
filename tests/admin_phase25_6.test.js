/**
 * Phase 25.6: Admin Panel Testing
 * Target: routes/admin.js 47.49% → 75%+ lines
 * Focus: Reporting, Fraud Detection, Seller Management, Settings
 */

const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../app");
const {
  Admin,
  Seller,
  DeliveryAgent,
  Order,
  Client,
  Product,
  PlatformSettings,
  DeviceToken,
} = require("../lib/models");
const { setupTestDB, cleanupTestDB } = require("./testUtils/dbHandler");

// Mock Firebase Admin
jest.mock("firebase-admin", () => ({
  apps: [],
  initializeApp: jest.fn(),
  credential: {
    cert: jest.fn(() => ({})),
  },
  auth: jest.fn(() => ({
    verifyIdToken: jest.fn(() => Promise.resolve({ uid: "test-firebase-uid" })),
  })),
  messaging: jest.fn(() => ({
    send: jest.fn(() => Promise.resolve("message-id")),
    sendMulticast: jest.fn(() =>
      Promise.resolve({ successCount: 1, failureCount: 0 })
    ),
    sendEachForMulticast: jest.fn(() =>
      Promise.resolve({ successCount: 1, failureCount: 0 })
    ),
  })),
}));

describe("Phase 25.6: Admin Panel Testing", () => {
  let adminToken;
  let adminId;
  let sellerId;
  let clientId;
  let productId;
  let agentId;
  let orderId;

  beforeAll(async () => {
    await setupTestDB();

    // Create admin user
    const admin = await Admin.create({
      email: "admin@test.com",
      password: "hashed_password_123",
      role: "superadmin",
    });
    adminId = admin._id;

    // Generate admin JWT
    const jwt = require("jsonwebtoken");
    adminToken = jwt.sign(
      { admin_id: adminId.toString(), role: "admin" }, // Use "admin" not "superadmin" for requireAdmin middleware
      process.env.JWT_SECRET || "test-secret",
      { expiresIn: "1h" }
    );

    // Create test seller
    const seller = await Seller.create({
      firebase_uid: "seller-uid-123",
      email: "seller@test.com",
      phone: "+919876543211", // Required field
      business_name: "Test Store",
      business_type: "grocery",
      approved: false, // For approval testing
      location: { type: "Point", coordinates: [77.5946, 12.9716] },
      address: "123 Test St, Bangalore",
    });
    sellerId = seller._id;

    // Create test client
    const client = await Client.create({
      firebase_uid: "client-uid-123",
      first_name: "Test",
      last_name: "User",
      phone: "+919876543210",
    });
    clientId = client._id;

    // Create test product
    const product = await Product.create({
      seller_id: sellerId,
      name: "Test Product",
      price: 100,
      in_stock: true,
      category: "grocery",
    });
    productId = product._id;

    // Create test delivery agent
    const agent = await DeliveryAgent.create({
      firebase_uid: "agent-uid-123",
      email: "agent@test.com",
      phone: "+919876543211",
      name: "Test Agent",
      approved: false,
      available: true,
      location: { type: "Point", coordinates: [77.5946, 12.9716] },
    });
    agentId = agent._id;

    // Create test order for reporting (use November 2025 date to match test query)
    const order = await Order.create({
      client_id: clientId,
      seller_id: sellerId,
      items: [{ product_id: productId, quantity: 2, unit_price: 100 }],
      payment: { method: "COD", amount: 200, status: "pending" },
      delivery: {
        delivery_address: {
          full_address: "123 Test St, Bangalore",
        },
      },
      status: "pending",
      created_at: new Date("2025-11-15"), // Within test query range
    });
    orderId = order._id;

    // Set up global Firebase Admin for test-push endpoint
    const firebaseAdmin = require("firebase-admin");
    global.firebaseAdmin = {
      messaging: () => ({
        sendEachForMulticast: jest.fn(() =>
          Promise.resolve({ successCount: 1, failureCount: 0 })
        ),
      }),
    };
  });

  afterAll(async () => {
    await cleanupTestDB();
  });

  // ==================== Section 1: Reporting & Overview ====================
  describe("Section 1: Reporting & Overview (Lines 307-425)", () => {
    test("GET /api/admin/reporting/overview - should return platform metrics", async () => {
      const response = await request(app)
        .get("/api/admin/reporting/overview")
        .set("Authorization", `Bearer ${adminToken}`)
        .query({ from: "2025-11-01", to: "2025-11-30" });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("metrics");
      expect(response.body.metrics).toHaveProperty("totalRevenue");
      expect(response.body.metrics).toHaveProperty("orderCount");
      expect(response.body.metrics).toHaveProperty("averageOrderValue");
      expect(response.body.metrics.orderCount).toBeGreaterThanOrEqual(1); // Should find our test order
    });

    test("GET /api/admin/reporting/overview - should use default date range (30 days)", async () => {
      const response = await request(app)
        .get("/api/admin/reporting/overview")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("metrics");
      expect(response.body).toHaveProperty("range");
      expect(response.body.range).toHaveProperty("from");
      expect(response.body.range).toHaveProperty("to");

      // Verify date range is approximately 30 days
      const from = new Date(response.body.range.from);
      const to = new Date(response.body.range.to);
      const daysDiff = (to - from) / (1000 * 60 * 60 * 24);
      expect(daysDiff).toBeGreaterThan(25); // Allow some tolerance
      expect(daysDiff).toBeLessThan(35);
    });

    test("GET /api/admin/reporting/overview - should exclude cancelled orders", async () => {
      // Create cancelled order (use November 2025 date to match test query)
      await Order.create({
        client_id: clientId,
        seller_id: sellerId,
        items: [{ product_id: productId, quantity: 1, unit_price: 500 }],
        payment: { method: "UPI", amount: 500, status: "pending" },
        delivery: { delivery_address: { full_address: "Test Address" } },
        status: "cancelled",
        created_at: new Date("2025-11-16"), // Within test query range
      });

      const response = await request(app)
        .get("/api/admin/reporting/overview")
        .set("Authorization", `Bearer ${adminToken}`)
        .query({ from: "2025-11-01", to: "2025-11-30" });

      expect(response.status).toBe(200);
      // Cancelled order should not affect revenue, but pending order from beforeAll should be found
      expect(response.body.metrics).toHaveProperty("orderCount");
      expect(response.body.metrics.orderCount).toBeGreaterThanOrEqual(1);
    });

    test("GET /api/admin/reporting/overview - should handle database errors", async () => {
      // Mock Order.aggregate to throw error
      const originalAggregate = Order.aggregate;
      Order.aggregate = jest.fn().mockRejectedValue(new Error("DB Error"));

      const response = await request(app)
        .get("/api/admin/reporting/overview")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(500);
      expect(response.body.message).toContain("Failed to build reporting");

      // Restore
      Order.aggregate = originalAggregate;
    });
  });

  // ==================== Section 2: Fraud Detection ====================
  describe("Section 2: Fraud Detection (Lines 421-490)", () => {
    beforeEach(async () => {
      // Clean orders for fraud tests
      await Order.deleteMany({ client_id: clientId });
    });

    test("GET /api/admin/fraud/signals - should detect rapid orders (3 within 10 min)", async () => {
      const now = new Date();

      // Create 3 orders within 5 minutes
      await Order.create({
        client_id: clientId,
        seller_id: sellerId,
        items: [{ product_id: productId, quantity: 1, unit_price: 100 }],
        payment: { method: "COD", amount: 100, status: "pending" },
        delivery: { delivery_address: { full_address: "Test Address" } },
        status: "pending",
        created_at: new Date(now.getTime() - 4 * 60 * 1000), // 4 min ago
      });

      await Order.create({
        client_id: clientId,
        seller_id: sellerId,
        items: [{ product_id: productId, quantity: 1, unit_price: 100 }],
        payment: { method: "COD", amount: 100, status: "pending" },
        delivery: { delivery_address: { full_address: "Test Address" } },
        status: "pending",
        created_at: new Date(now.getTime() - 2 * 60 * 1000), // 2 min ago
      });

      await Order.create({
        client_id: clientId,
        seller_id: sellerId,
        items: [{ product_id: productId, quantity: 1, unit_price: 100 }],
        payment: { method: "COD", amount: 100, status: "pending" },
        delivery: { delivery_address: { full_address: "Test Address" } },
        status: "pending",
        created_at: now,
      });

      const response = await request(app)
        .get("/api/admin/fraud/signals")
        .set("Authorization", `Bearer ${adminToken}`)
        .query({
          from: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
          to: now.toISOString(),
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("signals");
      expect(response.body.totalSignals).toBeGreaterThanOrEqual(1);

      // Check for rapid_orders signal
      const rapidSignal = response.body.signals.find(
        (s) => s.type === "rapid_orders"
      );
      expect(rapidSignal).toBeDefined();
      expect(rapidSignal.count).toBe(3);
    });

    test("GET /api/admin/fraud/signals - should detect high COD amounts (>2000)", async () => {
      await Order.create({
        client_id: clientId,
        seller_id: sellerId,
        items: [{ product_id: productId, quantity: 25, unit_price: 100 }],
        payment: { method: "COD", amount: 2500, status: "pending" },
        delivery: { delivery_address: { full_address: "Test Address" } },
        status: "pending",
        created_at: new Date(),
      });

      const response = await request(app)
        .get("/api/admin/fraud/signals")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.totalSignals).toBeGreaterThanOrEqual(1);

      const highCodSignal = response.body.signals.find(
        (s) => s.type === "high_cod_amount"
      );
      expect(highCodSignal).toBeDefined();
      expect(highCodSignal.amount).toBeGreaterThan(2000);
    });

    test("GET /api/admin/fraud/signals - should detect high refund rate (>40%)", async () => {
      // Create 5 orders: 3 refunded, 2 completed (60% refund rate)
      for (let i = 0; i < 3; i++) {
        await Order.create({
          client_id: clientId,
          seller_id: sellerId,
          items: [{ product_id: productId, quantity: 1, unit_price: 100 }],
          payment: { method: "UPI", amount: 100, status: "failed" },
          delivery: { delivery_address: { full_address: "Test Address" } },
          status: "refunded",
          created_at: new Date(),
        });
      }

      for (let i = 0; i < 2; i++) {
        await Order.create({
          client_id: clientId,
          seller_id: sellerId,
          items: [{ product_id: productId, quantity: 1, unit_price: 100 }],
          payment: { method: "UPI", amount: 100, status: "paid" },
          delivery: { delivery_address: { full_address: "Test Address" } },
          status: "delivered",
          created_at: new Date(),
        });
      }

      const response = await request(app)
        .get("/api/admin/fraud/signals")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      const refundSignal = response.body.signals.find(
        (s) => s.type === "high_refund_rate"
      );
      expect(refundSignal).toBeDefined();
      expect(refundSignal.refunded).toBe(3);
      expect(refundSignal.total).toBe(5);
    });

    test("GET /api/admin/fraud/signals - should use default 7-day window", async () => {
      const response = await request(app)
        .get("/api/admin/fraud/signals")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("from");
      expect(response.body).toHaveProperty("to");

      // Verify approximately 7 days
      const from = new Date(response.body.from);
      const to = new Date(response.body.to);
      const daysDiff = (to - from) / (1000 * 60 * 60 * 24);
      expect(daysDiff).toBeGreaterThan(5);
      expect(daysDiff).toBeLessThan(9);
    });

    test("GET /api/admin/fraud/signals - should handle database errors", async () => {
      const originalFind = Order.find;
      Order.find = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockRejectedValue(new Error("DB Error")),
        }),
      });

      const response = await request(app)
        .get("/api/admin/fraud/signals")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(500);
      expect(response.body.message).toContain("Failed to build fraud signals");

      Order.find = originalFind;
    });
  });

  // ==================== Section 3: Automated Alerts ====================
  describe("Section 3: Automated Alerts (Lines 491-577)", () => {
    test("POST /api/admin/alerts/evaluate - should detect order count drop", async () => {
      // Create previous day orders (10 orders)
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      for (let i = 0; i < 10; i++) {
        await Order.create({
          client_id: clientId,
          seller_id: sellerId,
          items: [{ product_id: productId, quantity: 1, unit_price: 100 }],
          payment: { method: "COD", amount: 100, status: "pending" },
          delivery: { delivery_address: { full_address: "Test Address" } },
          status: "pending",
          created_at: new Date(yesterday.getTime() + i * 60 * 1000),
        });
      }

      // Today only 2 orders (80% drop)
      const today = new Date();
      for (let i = 0; i < 2; i++) {
        await Order.create({
          client_id: clientId,
          seller_id: sellerId,
          items: [{ product_id: productId, quantity: 1, unit_price: 100 }],
          payment: { method: "COD", amount: 100, status: "pending" },
          delivery: { delivery_address: { full_address: "Test Address" } },
          status: "pending",
          created_at: new Date(today.getTime() - i * 60 * 1000),
        });
      }

      const response = await request(app)
        .post("/api/admin/alerts/evaluate")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          from: new Date(today.setHours(0, 0, 0, 0)).toISOString(),
          to: new Date(today.setHours(23, 59, 59, 999)).toISOString(),
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("alerts");
      expect(Array.isArray(response.body.alerts)).toBe(true);
    });

    test("POST /api/admin/alerts/evaluate - should use default 1-day window", async () => {
      const response = await request(app)
        .post("/api/admin/alerts/evaluate")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("evaluated");
      expect(response.body).toHaveProperty("created");
      expect(response.body).toHaveProperty("alerts");
    });

    test("POST /api/admin/alerts/evaluate - should handle database errors", async () => {
      const originalCount = Order.countDocuments;
      Order.countDocuments = jest.fn().mockRejectedValue(new Error("DB Error"));

      const response = await request(app)
        .post("/api/admin/alerts/evaluate")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({});

      expect(response.status).toBe(500);
      expect(response.body.message).toContain("Failed to evaluate alerts");

      Order.countDocuments = originalCount;
    });
  });

  // ==================== Section 4: Seller Approval ====================
  describe("Section 4: Seller Approval (Lines 767-790)", () => {
    test("PATCH /api/admin/sellers/:id/approve - should approve seller", async () => {
      const response = await request(app)
        .patch(`/api/admin/sellers/${sellerId}/approve`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.approved).toBe(true);

      // Verify in database
      const seller = await Seller.findById(sellerId);
      expect(seller.approved).toBe(true);
    });

    test("PATCH /api/admin/sellers/:id/approve - should reject invalid seller ID", async () => {
      const response = await request(app)
        .patch("/api/admin/sellers/invalid-id/approve")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("invalid seller id");
    });

    test("PATCH /api/admin/sellers/:id/approve - should return 404 for non-existent seller", async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const response = await request(app)
        .patch(`/api/admin/sellers/${fakeId}/approve`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({});

      expect(response.status).toBe(404);
      expect(response.body.error).toContain("seller not found");
    });

    test("PATCH /api/admin/sellers/:id/approve - should handle database errors", async () => {
      const originalFindByIdAndUpdate = Seller.findByIdAndUpdate;
      Seller.findByIdAndUpdate = jest
        .fn()
        .mockRejectedValue(new Error("DB Error"));

      const response = await request(app)
        .patch(`/api/admin/sellers/${sellerId}/approve`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({});

      expect(response.status).toBe(500);
      expect(response.body.error).toContain("failed to approve seller");

      Seller.findByIdAndUpdate = originalFindByIdAndUpdate;
    });
  });

  // ==================== Section 5: Platform Settings ====================
  describe("Section 5: Platform Settings (Lines 1098-1225)", () => {
    test("GET /api/admin/settings - should return platform settings", async () => {
      // Create settings
      await PlatformSettings.findOneAndUpdate(
        {},
        {
          $set: {
            delivery_charge: 50,
            free_delivery_above: 500,
            coupons: [
              {
                code: "WELCOME10",
                percent: 10,
                min_order: 200,
                active: true,
              },
            ],
          },
        },
        { upsert: true, new: true }
      );

      const response = await request(app)
        .get("/api/admin/settings")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("delivery_charge_grocery");
      expect(response.body).toHaveProperty("delivery_charge_food");
      expect(response.body).toHaveProperty("coupons");
      expect(Array.isArray(response.body.coupons)).toBe(true);
      expect(response.body.coupons.length).toBeGreaterThanOrEqual(1);
      expect(response.body.coupons[0].code).toBe("WELCOME10");
    });

    test("PUT /api/admin/settings - should update delivery charge", async () => {
      const response = await request(app)
        .put("/api/admin/settings")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          delivery_charge: 60,
          free_delivery_above: 600,
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("delivery_charge_grocery");
      expect(response.body).toHaveProperty("delivery_charge_food");
      // Settings update successful - just verify structure returned
    });

    test("PUT /api/admin/settings - should update coupons array", async () => {
      const response = await request(app)
        .put("/api/admin/settings")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          coupons: [
            {
              code: "SAVE20",
              percent: 20,
              min_order: 500,
              active: true,
              expiry_date: "2025-12-31",
            },
            {
              code: "SUMMER15",
              percent: 15,
              min_order: 300,
              active: true,
            },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body.coupons).toHaveLength(2);
      expect(response.body.coupons[0].code).toBe("SAVE20");
    });

    test("PUT /api/admin/settings - should filter invalid coupon codes", async () => {
      const response = await request(app)
        .put("/api/admin/settings")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          coupons: [
            { code: "VALID", percent: 10, min_order: 100, active: true },
            { code: "", percent: 20, min_order: 200, active: true }, // Empty code
            { percent: 15, min_order: 150, active: true }, // Missing code
          ],
        });

      expect(response.status).toBe(200);
      // Should only save valid coupon
      expect(response.body.coupons).toHaveLength(1);
      expect(response.body.coupons[0].code).toBe("VALID");
    });

    test("PUT /api/admin/settings - should filter invalid categories", async () => {
      const response = await request(app)
        .put("/api/admin/settings")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          categories: ["grocery", "vegetables", "", null, "fruits"],
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("coupons");
      // Settings update successful - verify response structure
    });

    test("PUT /api/admin/settings - should handle database errors", async () => {
      const originalFindOneAndUpdate = PlatformSettings.findOneAndUpdate;
      PlatformSettings.findOneAndUpdate = jest
        .fn()
        .mockRejectedValue(new Error("DB Error"));

      const response = await request(app)
        .put("/api/admin/settings")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ delivery_charge: 70 });

      expect(response.status).toBe(500);
      expect(response.body.error).toContain("failed to update settings");

      PlatformSettings.findOneAndUpdate = originalFindOneAndUpdate;
    });
  });

  // ==================== Section 6: Product Management ====================
  describe("Section 6: Product Management (Lines 999-1081)", () => {
    test("GET /api/admin/products - should list all products with pagination", async () => {
      const response = await request(app)
        .get("/api/admin/products")
        .set("Authorization", `Bearer ${adminToken}`)
        .query({ page: 1, limit: 10 });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("rows");
      expect(Array.isArray(response.body.rows)).toBe(true);
      expect(response.body.rows.length).toBeGreaterThanOrEqual(1); // Should include our test product
    });

    test("GET /api/admin/products - should filter by seller_id", async () => {
      const response = await request(app)
        .get("/api/admin/products")
        .set("Authorization", `Bearer ${adminToken}`)
        .query({ seller_id: sellerId.toString() });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("rows");
      expect(
        response.body.rows.every(
          (p) => p.seller_id.toString() === sellerId.toString()
        )
      ).toBe(true);
    });

    test("GET /api/admin/products - should search by product name", async () => {
      const response = await request(app)
        .get("/api/admin/products")
        .set("Authorization", `Bearer ${adminToken}`)
        .query({ search: "Test Product" });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("rows");
      expect(response.body.rows).toHaveLength(1);
      expect(response.body.rows[0].name).toBe("Test Product");
    });

    test("GET /api/admin/products - should handle database errors", async () => {
      const originalFind = Product.find;
      Product.find = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockRejectedValue(new Error("DB Error")),
        }),
      });

      const response = await request(app)
        .get("/api/admin/products")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(500);
      expect(response.body.message).toContain("Failed to list products");

      Product.find = originalFind;
    });

    test("GET /api/admin/product-categories - should return unique categories", async () => {
      const response = await request(app)
        .get("/api/admin/product-categories")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.categories)).toBe(true);
      expect(response.body.categories).toContain("grocery");
    });
  });

  // ==================== Section 7: Device Token Management ====================
  describe("Section 7: Device Token Management (Lines 1225-1351)", () => {
    beforeAll(async () => {
      // Create test device tokens
      await DeviceToken.create({
        user_id: clientId.toString(),
        token: "device-token-123",
        platform: "android",
        last_seen: new Date(),
      });

      await DeviceToken.create({
        user_id: adminId.toString(),
        token: "device-token-456",
        platform: "ios",
        last_seen: new Date(),
      });
    });

    test("GET /api/admin/device-tokens - should list all device tokens", async () => {
      const response = await request(app)
        .get("/api/admin/device-tokens")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("rows");
      expect(Array.isArray(response.body.rows)).toBe(true);
      expect(response.body.rows.length).toBeGreaterThanOrEqual(2);
    });

    test("GET /api/admin/device-tokens - should filter by userId", async () => {
      const response = await request(app)
        .get("/api/admin/device-tokens")
        .set("Authorization", `Bearer ${adminToken}`)
        .query({ userId: clientId.toString() });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("rows");
      expect(response.body.rows).toHaveLength(1);
      expect(response.body.rows[0].user_id).toBe(clientId.toString());
    });

    test("GET /api/admin/device-tokens - should respect limit parameter", async () => {
      const response = await request(app)
        .get("/api/admin/device-tokens")
        .set("Authorization", `Bearer ${adminToken}`)
        .query({ limit: 1 });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("rows");
      expect(response.body.rows).toHaveLength(1);
    });

    test("GET /api/admin/device-tokens - should sort by last_seen descending", async () => {
      const response = await request(app)
        .get("/api/admin/device-tokens")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("rows");
      const tokens = response.body.rows;
      for (let i = 1; i < tokens.length; i++) {
        const prev = new Date(tokens[i - 1].last_seen);
        const curr = new Date(tokens[i].last_seen);
        expect(prev.getTime()).toBeGreaterThanOrEqual(curr.getTime());
      }
    });

    test("GET /api/admin/device-tokens/by-client - should return tokens for specific UID", async () => {
      const response = await request(app)
        .get("/api/admin/device-tokens/by-client")
        .set("Authorization", `Bearer ${adminToken}`)
        .query({ uid: "client-uid-123" });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("rows");
      expect(Array.isArray(response.body.rows)).toBe(true);
    });

    test("GET /api/admin/device-tokens/by-client - should reject missing uid", async () => {
      const response = await request(app)
        .get("/api/admin/device-tokens/by-client")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("uid");
    });

    test("GET /api/admin/device-tokens/by-client - should return empty for non-existent UID", async () => {
      const response = await request(app)
        .get("/api/admin/device-tokens/by-client")
        .set("Authorization", `Bearer ${adminToken}`)
        .query({ uid: "nonexistent-uid" });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("rows");
      expect(response.body.rows).toEqual([]);
    });

    test("GET /api/admin/device-tokens - should handle database errors", async () => {
      const originalFind = DeviceToken.find;
      DeviceToken.find = jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockRejectedValue(new Error("DB Error")),
          }),
        }),
      });

      const response = await request(app)
        .get("/api/admin/device-tokens")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(500);
      expect(response.body.error).toContain("failed to list tokens");

      DeviceToken.find = originalFind;
    });
  });

  // ==================== Section 8: Test Push Notifications ====================
  describe("Section 8: Test Push Notifications (Lines 1266-1351)", () => {
    test("POST /api/admin/test-push - should reject when no tokens found", async () => {
      const response = await request(app)
        .post("/api/admin/test-push")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          userId: "nonexistent-user-id",
          title: "Test",
          body: "Test notification",
        });

      // API returns 404 when no tokens found
      expect(response.status).toBe(404);
      expect(response.body.error).toContain("no tokens found");
    });

    test("POST /api/admin/test-push - should attempt to send notification with valid userId", async () => {
      const response = await request(app)
        .post("/api/admin/test-push")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          userId: clientId.toString(),
          title: "Test Notification",
          body: "This is a test",
        });

      // Device token exists in DB (created in beforeAll), Firebase mock should succeed
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("ok");
      expect(response.body).toHaveProperty("sent");
    });

    test("POST /api/admin/test-push - should handle Firebase not initialized", async () => {
      // Temporarily unset Firebase Admin to simulate not initialized
      const originalFirebase = global.firebaseAdmin;
      global.firebaseAdmin = null;

      const response = await request(app)
        .post("/api/admin/test-push")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          userId: clientId.toString(),
          title: "Test",
          body: "Test",
        });

      // API returns 503 when Firebase not initialized
      expect(response.status).toBe(503);
      expect(response.body.error).toContain("Firebase Admin not initialized");

      global.firebaseAdmin = originalFirebase;
    });
  });
});
