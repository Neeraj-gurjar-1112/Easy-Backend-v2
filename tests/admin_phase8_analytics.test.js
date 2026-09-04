/**
 * PHASE 8 SECTION 4: Advanced Analytics & Reporting Tests
 *
 * Tests for admin analytics and reporting endpoints
 * Covers:
 * - GET /api/admin/reporting/overview - Revenue trends, top products
 * - GET /api/admin/metrics - Platform-wide metrics dashboard
 */

const request = require("supertest");
const app = require("../app");
const {
  connectTestDB,
  clearTestDB,
  closeTestDB,
} = require("./testUtils/dbHandler");
const {
  Order,
  Product,
  Client,
  Seller,
  DeliveryAgent,
  EarningLog,
  Admin,
  PlatformSettings,
} = require("../lib/models");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

describe("PHASE 8 SECTION 4: Advanced Analytics & Reporting", () => {
  let adminToken;

  // Helper to create test order
  const createTestOrder = async (data) => {
    return Order.create({
      client_id: data.client_id || "test_client",
      status: data.status || "delivered",
      order_items: data.order_items || [
        { product_id: data.product_id, qty: 1, price_snapshot: data.amount },
      ],
      delivery: data.delivery || {
        delivery_status: "delivered",
        delivery_address: { full_address: "Test St" },
      },
      payment: {
        amount: data.amount || 100,
        method: data.method || "UPI",
        status: "paid",
      },
      created_at: data.created_at || new Date(),
    });
  };

  beforeAll(async () => {
    await connectTestDB();

    // Create admin token
    adminToken = jwt.sign(
      { uid: "admin_test_uid", role: "admin" },
      process.env.JWT_SECRET || "test_secret",
      { expiresIn: "1h" }
    );
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();

    // Recreate admin
    await Admin.create({
      email: "admin@test.com",
      password: "hashed_password",
      firebase_uid: "test_admin_uid",
      role: "superadmin",
    });

    // Create platform settings
    await PlatformSettings.create({
      platform_commission_rate: 0.1,
      coupons: [],
      delivery_fees: {
        grocery: { base_fee: 30, free_delivery_threshold: 500 },
        food: { base_fee: 50, free_delivery_threshold: 300 },
      },
      commission_rates: {
        grocery: 0.1,
        food: 0.15,
      },
    });
  });

  // =========================
  // 1. Reporting Overview
  // =========================
  describe("Reporting Overview (GET /api/admin/reporting/overview)", () => {
    test("should return revenue overview with metrics and trends", async () => {
      // Create test seller and product
      const seller = await Seller.create({
        firebase_uid: "seller_uid",
        email: "seller@test.com",
        phone: "1234567890",
        business_name: "Test Seller",
        approved: true,
      });

      const product = await Product.create({
        name: "Test Product",
        price: 100,
        seller_id: seller._id,
        category: "Groceries",
        stock: 50,
        status: "active",
      });

      // Create orders over 7 days
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      const twoDaysAgo = new Date(today);
      twoDaysAgo.setDate(today.getDate() - 2);

      await createTestOrder({
        product_id: product._id,
        amount: 200,
        created_at: today,
      });
      await createTestOrder({
        product_id: product._id,
        amount: 150,
        created_at: yesterday,
      });
      await createTestOrder({
        product_id: product._id,
        amount: 100,
        created_at: twoDaysAgo,
      });

      const response = await request(app)
        .get("/api/admin/reporting/overview?from=2024-01-01&to=2099-12-31")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.metrics).toBeDefined();
      expect(response.body.metrics.totalRevenue).toBe(450);
      expect(response.body.metrics.orderCount).toBe(3);
      expect(response.body.metrics.averageOrderValue).toBeCloseTo(150, 0);
      expect(response.body.trend).toBeDefined();
      expect(Array.isArray(response.body.trend)).toBe(true);
      expect(response.body.topProducts).toBeDefined();
      expect(Array.isArray(response.body.topProducts)).toBe(true);
    });

    test("should filter by date range", async () => {
      const seller = await Seller.create({
        firebase_uid: "seller_uid",
        email: "seller@test.com",
        phone: "1234567890",
        business_name: "Test Seller",
        approved: true,
      });

      const product = await Product.create({
        name: "Test Product",
        price: 100,
        seller_id: seller._id,
        category: "Groceries",
        stock: 50,
        status: "active",
      });

      // Orders outside date range
      await createTestOrder({
        product_id: product._id,
        amount: 1000,
        created_at: new Date("2020-01-01"),
      });

      // Orders inside date range
      await createTestOrder({
        product_id: product._id,
        amount: 200,
        created_at: new Date("2024-06-15"),
      });

      const response = await request(app)
        .get("/api/admin/reporting/overview?from=2024-01-01&to=2024-12-31")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.metrics.totalRevenue).toBe(200);
      expect(response.body.metrics.orderCount).toBe(1);
    });

    test("should exclude cancelled orders from revenue", async () => {
      const seller = await Seller.create({
        firebase_uid: "seller_uid",
        email: "seller@test.com",
        phone: "1234567890",
        business_name: "Test Seller",
        approved: true,
      });

      const product = await Product.create({
        name: "Test Product",
        price: 100,
        seller_id: seller._id,
        category: "Groceries",
        stock: 50,
        status: "active",
      });

      // Delivered order
      await createTestOrder({
        product_id: product._id,
        amount: 200,
        status: "delivered",
      });

      // Cancelled order (should be excluded)
      await createTestOrder({
        product_id: product._id,
        amount: 500,
        status: "cancelled",
      });

      const response = await request(app)
        .get("/api/admin/reporting/overview?from=2024-01-01&to=2099-12-31")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.metrics.totalRevenue).toBe(200);
      expect(response.body.metrics.orderCount).toBe(1);
    });

    test("should return top products ranked by revenue", async () => {
      const seller = await Seller.create({
        firebase_uid: "seller_uid",
        email: "seller@test.com",
        phone: "1234567890",
        business_name: "Test Seller",
        approved: true,
      });

      const product1 = await Product.create({
        name: "High Revenue Product",
        price: 500,
        seller_id: seller._id,
        category: "Electronics",
        stock: 20,
        status: "active",
      });

      const product2 = await Product.create({
        name: "Low Revenue Product",
        price: 50,
        seller_id: seller._id,
        category: "Groceries",
        stock: 100,
        status: "active",
      });

      // Product 1: 3 orders x 500 = 1500 revenue
      await createTestOrder({ product_id: product1._id, amount: 500 });
      await createTestOrder({ product_id: product1._id, amount: 500 });
      await createTestOrder({ product_id: product1._id, amount: 500 });

      // Product 2: 2 orders x 50 = 100 revenue
      await createTestOrder({ product_id: product2._id, amount: 50 });
      await createTestOrder({ product_id: product2._id, amount: 50 });

      const response = await request(app)
        .get("/api/admin/reporting/overview?from=2024-01-01&to=2099-12-31")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.topProducts).toBeDefined();
      expect(response.body.topProducts.length).toBeGreaterThanOrEqual(2);
      // First product should be highest revenue
      expect(response.body.topProducts[0].revenue).toBeGreaterThan(
        response.body.topProducts[1].revenue
      );
      expect(response.body.topProducts[0].name).toBe("High Revenue Product");
    });

    test("should return empty data when no orders exist", async () => {
      const response = await request(app)
        .get("/api/admin/reporting/overview?from=2024-01-01&to=2024-12-31")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.metrics.totalRevenue).toBe(0);
      expect(response.body.metrics.orderCount).toBe(0);
      expect(response.body.topProducts).toEqual([]);
    });

    test("should use default date range (30 days) when not specified", async () => {
      const response = await request(app)
        .get("/api/admin/reporting/overview")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.range).toBeDefined();
      expect(response.body.range.from).toBeDefined();
      expect(response.body.range.to).toBeDefined();
      expect(response.body.metrics).toBeDefined();
    });

    test("should require admin authentication", async () => {
      await request(app).get("/api/admin/reporting/overview").expect(401);
    });
  });

  // =========================
  // 2. Platform Metrics
  // =========================
  describe("Platform Metrics (GET /api/admin/metrics)", () => {
    test("should return comprehensive platform metrics", async () => {
      // Create test data
      await Client.create({
        firebase_uid: "client1",
        email: "client1@test.com",
        phone: "1111111111",
        first_name: "Client",
        last_name: "One",
      });

      await Seller.create({
        firebase_uid: "seller1",
        email: "seller1@test.com",
        phone: "2222222222",
        business_name: "Seller One",
        business_type: "grocery",
        approved: true,
      });

      await Seller.create({
        firebase_uid: "restaurant1",
        email: "restaurant1@test.com",
        phone: "3333333333",
        business_name: "Restaurant One",
        business_type: "restaurant",
        approved: true,
      });

      await Seller.create({
        firebase_uid: "seller_pending",
        email: "pending@test.com",
        phone: "4444444444",
        business_name: "Pending Seller",
        business_type: "grocery",
        approved: false,
      });

      const product = await Product.create({
        name: "Test Product",
        price: 100,
        seller_id: new mongoose.Types.ObjectId(),
        category: "Groceries",
        stock: 50,
        status: "active",
      });

      await DeliveryAgent.create({
        firebase_uid: "agent1",
        name: "Agent One",
        email: "agent1@test.com",
        phone: "5555555555",
        first_name: "Agent",
        last_name: "One",
      });

      await createTestOrder({
        product_id: product._id,
        amount: 500,
      });

      await EarningLog.create({
        role: "seller",
        seller_id: new mongoose.Types.ObjectId(),
        order_id: new mongoose.Types.ObjectId(),
        earnings: 450,
        platform_commission: 50,
        created_at: new Date(),
      });

      const response = await request(app)
        .get("/api/admin/metrics")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.orders).toBeDefined();
      expect(response.body.active_products).toBe(1);
      expect(response.body.clients).toBeDefined();
      expect(response.body.sellers_pending).toBe(1);
      expect(response.body.restaurants).toBe(1);
      expect(response.body.sellers).toBe(2); // grocery + pending
      expect(response.body.delivery_agents).toBe(1);
      expect(response.body.total_sales).toBe(500);
      expect(response.body.platform_commission_total).toBe(50);
    });

    test("should distinguish between clients, sellers, and restaurants", async () => {
      // Pure client (not a seller)
      await Client.create({
        firebase_uid: "pure_client",
        email: "client@test.com",
        phone: "1111111111",
        first_name: "Pure",
        last_name: "Client",
      });

      // Client who is also a seller (should not be counted as pure client)
      await Client.create({
        firebase_uid: "seller_client",
        email: "sellerclient@test.com",
        phone: "2222222222",
        first_name: "Seller",
        last_name: "Client",
      });

      await Seller.create({
        firebase_uid: "seller_client",
        email: "sellerclient@test.com",
        phone: "2222222222",
        business_name: "Seller Client",
        business_type: "grocery",
        approved: true,
      });

      const response = await request(app)
        .get("/api/admin/metrics")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.clients).toBe(1); // Only pure client
      expect(response.body.sellers).toBe(1);
    });

    test("should count restaurants separately from sellers", async () => {
      await Seller.create({
        firebase_uid: "seller1",
        email: "seller1@test.com",
        phone: "1111111111",
        business_name: "Grocery Store",
        business_type: "grocery",
        approved: true,
      });

      await Seller.create({
        firebase_uid: "restaurant1",
        email: "restaurant1@test.com",
        phone: "2222222222",
        business_name: "Pizza Place",
        business_type: "restaurant",
        approved: true,
      });

      await Seller.create({
        firebase_uid: "restaurant2",
        email: "restaurant2@test.com",
        phone: "3333333333",
        business_name: "Burger Joint",
        business_type: "restaurant", // Case-insensitive match in metrics
        approved: true,
      });

      const response = await request(app)
        .get("/api/admin/metrics")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.restaurants).toBe(2);
      expect(response.body.sellers).toBe(1);
    });

    test("should calculate total platform commission from earning logs", async () => {
      // Create multiple earning logs
      await EarningLog.create({
        role: "seller",
        seller_id: new mongoose.Types.ObjectId(),
        order_id: new mongoose.Types.ObjectId(),
        earnings: 900,
        platform_commission: 100,
        created_at: new Date(),
      });

      await EarningLog.create({
        role: "seller",
        seller_id: new mongoose.Types.ObjectId(),
        order_id: new mongoose.Types.ObjectId(),
        earnings: 450,
        platform_commission: 50,
        created_at: new Date(),
      });

      // Delivery agent commission (should not be counted)
      await EarningLog.create({
        role: "delivery",
        agent_id: new mongoose.Types.ObjectId(),
        order_id: new mongoose.Types.ObjectId(),
        earnings: 80,
        platform_commission: 20,
        created_at: new Date(),
      });

      const response = await request(app)
        .get("/api/admin/metrics")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.platform_commission_total).toBe(150); // Only seller commissions
    });

    test("should calculate total discounts from orders", async () => {
      const product = await Product.create({
        name: "Test Product",
        price: 100,
        seller_id: new mongoose.Types.ObjectId(),
        category: "Groceries",
        stock: 50,
        status: "active",
      });

      // Order with discount
      await Order.create({
        client_id: "client1",
        status: "delivered",
        order_items: [{ product_id: product._id, qty: 1, price_snapshot: 100 }],
        payment: { amount: 80, method: "UPI", status: "paid" },
        applied_discount_amount: 20,
        delivery: {
          delivery_status: "delivered",
          delivery_address: { full_address: "Test St" },
        },
      });

      // Order with larger discount
      await Order.create({
        client_id: "client2",
        status: "delivered",
        order_items: [{ product_id: product._id, qty: 1, price_snapshot: 100 }],
        payment: { amount: 50, method: "UPI", status: "paid" },
        applied_discount_amount: 50,
        delivery: {
          delivery_status: "delivered",
          delivery_address: { full_address: "Test St" },
        },
      });

      const response = await request(app)
        .get("/api/admin/metrics")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.total_discounts_given).toBe(70);
    });

    test("should return zero values when no data exists", async () => {
      const response = await request(app)
        .get("/api/admin/metrics")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.orders).toBe(0);
      expect(response.body.active_products).toBe(0);
      expect(response.body.clients).toBe(0);
      expect(response.body.sellers_pending).toBe(0);
      expect(response.body.restaurants).toBe(0);
      expect(response.body.sellers).toBe(0);
      expect(response.body.delivery_agents).toBe(0);
      expect(response.body.total_sales).toBe(0);
      expect(response.body.platform_commission_total).toBe(0);
      expect(response.body.total_discounts_given).toBe(0);
    });

    test("should require admin authentication", async () => {
      await request(app).get("/api/admin/metrics").expect(401);
    });
  });
});
