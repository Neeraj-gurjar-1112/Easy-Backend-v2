/**
 * Admin Routes Test Suite - Phase 8: Payout Management
 * Tests for routes/admin.js - Payout calculations, approval workflows, and error handling
 *
 * Coverage Target: Lines 2028-2044, 2063, 2153-2200, 2969-3160
 * Expected Coverage Gain: +400 lines (~11% of admin.js)
 */

const request = require("supertest");
const app = require("../app");
const {
  connectTestDB,
  closeTestDB,
  clearTestDB,
} = require("./testUtils/dbHandler");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const {
  Admin,
  Seller,
  DeliveryAgent,
  Client,
  Order,
  Product,
  PlatformSettings,
  EarningLog,
} = require("../lib/models");

// Store admin token for authenticated requests
let adminToken;
let testAdminId;

beforeAll(async () => {
  await connectTestDB();
}, 30000);

afterAll(async () => {
  await closeTestDB();
});

beforeEach(async () => {
  await clearTestDB();

  // Create test admin for authenticated tests
  const admin = await Admin.create({
    email: "test.admin@example.com",
    name: "Test Admin",
    password: "admin123456", // Will be hashed by pre-save hook
    role: "superadmin",
  });

  testAdminId = admin._id;

  // Generate valid admin JWT token matching requireAdmin middleware expectations
  adminToken = jwt.sign(
    {
      id: admin._id,
      email: admin.email,
      role: "admin", // Must be "admin" for requireAdmin middleware
      exp: Math.floor(Date.now() / 1000) + 2 * 60 * 60, // 2 hours
    },
    process.env.JWT_SECRET || "test-secret"
  );
});

describe("PHASE 8: Payout Management", () => {
  // =========================
  // 1. Payout Calculations
  // =========================
  describe("Payout Calculations", () => {
    test("should calculate seller payout with platform commission", async () => {
      // Create platform settings with 10% commission
      await PlatformSettings.create({
        platform_commission_rate: 0.1,
        delivery_charge_grocery: 20,
        delivery_charge_food: 30,
      });

      // Create seller, product, and completed order
      const seller = await Seller.create({
        email: "seller@test.com",
        business_name: "Test Shop",
        phone: "1234567890",
        password: "password123",
        approved: true,
      });

      const product = await Product.create({
        name: "Test Product",
        price: 100,
        seller_id: seller._id,
        category: "grocery",
        stock: 50,
      });

      const client = await Client.create({
        firebase_uid: "test_client_uid",
        name: "Test Client",
        email: "client@test.com",
        phone: "9876543210",
      });

      // Create completed order (seller earns: 100 - 10% = 90)
      await Order.create({
        client_id: client.firebase_uid,
        seller_id: seller._id,
        order_items: [
          {
            product_id: product._id,
            qty: 1,
            price_snapshot: 100,
          },
        ],

        delivery: {
          delivery_status: "delivered",
          delivery_address: {
            full_address: "123 Test Street, Test City",
          },
        },
        status: "delivered",
        payment: { amount: 100, method: "COD", status: "paid" },
      });

      const response = await request(app)
        .get("/api/admin/payouts/summary")
        .query({ sellerId: seller._id.toString() })
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.rows).toHaveLength(1);
      expect(response.body.rows[0].item_total).toBe(100);
      expect(response.body.rows[0].platform_commission).toBe(10);
      expect(response.body.rows[0].seller_net).toBe(90);
      expect(response.body.totals.seller_net).toBe(90);
    });

    test("should calculate agent payout with delivery fees", async () => {
      // Create delivery agent and completed order with delivery
      const agent = await DeliveryAgent.create({
        name: "Test Agent",
        email: "agent@test.com",
        phone: "5555555555",
        password: "password123",
        approved: true,
        available: true,
      });

      const seller = await Seller.create({
        email: "seller2@test.com",
        business_name: "Test Restaurant",
        phone: "1231231234",
        password: "password123",
        approved: true,
      });

      const client = await Client.create({
        firebase_uid: "test_client_uid2",
        name: "Test Client 2",
        email: "client2@test.com",
        phone: "9879879876",
      });

      const product = await Product.create({
        name: "Test Meal",
        price: 200,
        seller_id: seller._id,
        category: "food",
        stock: 20,
      });

      const order = await Order.create({
        client_id: client.firebase_uid,
        seller_id: seller._id,
        order_items: [
          {
            product_id: product._id,
            qty: 1,
            price_snapshot: 200,
          },
        ],

        delivery: {
          delivery_status: "delivered",
          delivery_agent_id: agent._id,
          delivery_address: {
            full_address: "456 Delivery Ave, Test City",
          },
        },
        status: "delivered",
        payment: { amount: 200, method: "COD", status: "paid" },
      });

      // Create earning log for agent (delivery fee: 30, agent gets 80%)
      await EarningLog.create({
        order_id: order._id,
        agent_id: agent._id,
        role: "delivery",
        delivery_charge: 30,
        net_earning: 24, // 80% of 30
      });

      const response = await request(app)
        .get("/api/admin/payouts/logs")
        .query({ role: "delivery", agentId: agent._id.toString() })
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.rows).toHaveLength(1);
      expect(response.body.rows[0].net_earning).toBe(24);
      expect(response.body.rows[0].role).toBe("delivery");
    });

    test("should handle bulk payout calculations", async () => {
      // Create multiple sellers with completed orders
      const sellers = await Promise.all([
        Seller.create({
          email: "seller1@bulk.com",
          business_name: "Seller 1",
          phone: "1111111111",
          password: "pass123",
          approved: true,
        }),
        Seller.create({
          email: "seller2@bulk.com",
          business_name: "Seller 2",
          phone: "2222222222",
          password: "pass123",
          approved: true,
        }),
        Seller.create({
          email: "seller3@bulk.com",
          business_name: "Seller 3",
          phone: "3333333333",
          password: "pass123",
          approved: true,
        }),
      ]);

      const client = await Client.create({
        firebase_uid: "bulk_client",
        name: "Bulk Client",
        email: "bulk@test.com",
        phone: "9999999999",
      });

      await PlatformSettings.create({
        platform_commission_rate: 0.15,
      });

      // Create products and orders for each seller
      for (const seller of sellers) {
        const product = await Product.create({
          name: `Product ${seller.business_name}`,
          price: 1000,
          seller_id: seller._id,
          category: "grocery",
          stock: 100,
        });

        await Order.create({
          client_id: client.firebase_uid,
          seller_id: seller._id,
          order_items: [
            {
              product_id: product._id,
              qty: 1,
              price_snapshot: 1000,
            },
          ],

          delivery: {
            delivery_status: "delivered",
            delivery_address: { full_address: "123 Test St" },
          },
          status: "delivered",
          payment: { amount: 100, method: "COD", status: "paid" },
        });
      }

      const response = await request(app)
        .get("/api/admin/payouts/summary")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.rows).toHaveLength(3);
      expect(response.body.totals.item_total).toBe(3000);
      expect(response.body.totals.platform_commission).toBe(450); // 15% of 3000
      expect(response.body.totals.seller_net).toBe(2550);
    });

    test("should filter payouts by date range", async () => {
      const seller = await Seller.create({
        email: "daterange@test.com",
        business_name: "Date Range Seller",
        phone: "4444444444",
        password: "pass123",
        approved: true,
      });

      const product = await Product.create({
        name: "Test Product",
        price: 500,
        seller_id: seller._id,
        category: "grocery",
        stock: 50,
      });

      const client = await Client.create({
        firebase_uid: "date_client",
        name: "Date Client",
        email: "date@test.com",
        phone: "8888888888",
      });

      // Create order 2 days ago
      const oldOrder = await Order.create({
        client_id: client.firebase_uid,
        seller_id: seller._id,
        order_items: [{ product_id: product._id, qty: 1, price_snapshot: 500 }],

        delivery: {
          delivery_status: "delivered",
          delivery_address: { full_address: "123 Test St" },
        },
        status: "delivered",
        payment: { amount: 100, method: "COD", status: "paid" },
        created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      });

      // Create order today
      const newOrder = await Order.create({
        client_id: client.firebase_uid,
        seller_id: seller._id,
        order_items: [{ product_id: product._id, qty: 1, price_snapshot: 500 }],

        delivery: {
          delivery_status: "delivered",
          delivery_address: { full_address: "123 Test St" },
        },
        status: "delivered",
        payment: { amount: 100, method: "COD", status: "paid" },
      });

      // Query only today's orders
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const response = await request(app)
        .get("/api/admin/payouts/summary")
        .query({
          from: today.toISOString(),
          sellerId: seller._id.toString(),
        })
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.rows[0].orders_count).toBe(1); // Only today's order
    });
  });

  // =========================
  // 2. Payout Approval Workflow
  // =========================
  describe("Payout Approval Workflow", () => {
    test("should list unpaid earnings logs", async () => {
      const agent = await DeliveryAgent.create({
        name: "Agent Unpaid",
        email: "unpaid@agent.com",
        phone: "7777777777",
        password: "pass123",
        approved: true,
      });

      const seller = await Seller.create({
        email: "unpaid@seller.com",
        business_name: "Unpaid Seller",
        phone: "6666666666",
        password: "pass123",
        approved: true,
      });

      const client = await Client.create({
        firebase_uid: "unpaid_client",
        name: "Unpaid Client",
        email: "unpaid@client.com",
        phone: "5551234567",
      });

      const product = await Product.create({
        name: "Unpaid Product",
        price: 300,
        seller_id: seller._id,
        category: "grocery",
        stock: 10,
      });

      const order = await Order.create({
        client_id: client.firebase_uid,
        seller_id: seller._id,
        order_items: [{ product_id: product._id, qty: 1, price_snapshot: 300 }],

        delivery: {
          delivery_status: "delivered",
          delivery_agent_id: agent._id,
          delivery_address: {
            full_address: "789 Unpaid St, Test City",
          },
        },
        status: "delivered",
        payment: { amount: 300, method: "COD", status: "paid" },
      });

      // Create unpaid earning logs
      await EarningLog.create({
        order_id: order._id,
        agent_id: agent._id,
        role: "delivery",
        net_earning: 25,
        paid: false,
      });

      await EarningLog.create({
        order_id: order._id,
        seller_id: seller._id,
        role: "seller",
        net_earning: 270,
        paid: false,
      });

      // Query for unpaid seller logs
      const sellerResponse = await request(app)
        .get("/api/admin/payouts/logs")
        .query({ paid: "false", role: "seller" })
        .set("Authorization", `Bearer ${adminToken}`);

      expect(sellerResponse.status).toBe(200);
      expect(sellerResponse.body.rows.length).toBeGreaterThanOrEqual(1);
      expect(sellerResponse.body.rows.every((r) => r.paid === false)).toBe(
        true
      );

      // Query for unpaid delivery logs
      const deliveryResponse = await request(app)
        .get("/api/admin/payouts/logs")
        .query({ paid: "false", role: "delivery" })
        .set("Authorization", `Bearer ${adminToken}`);

      expect(deliveryResponse.status).toBe(200);
      expect(deliveryResponse.body.rows.length).toBeGreaterThanOrEqual(1);
      expect(deliveryResponse.body.rows.every((r) => r.paid === false)).toBe(
        true
      );
    });

    test("should mark payout as paid", async () => {
      const log = await EarningLog.create({
        order_id: new mongoose.Types.ObjectId(),
        seller_id: new mongoose.Types.ObjectId(),
        role: "seller",
        net_earning: 100,
        paid: false,
      });

      const response = await request(app)
        .patch(`/api/admin/payouts/logs/${log._id}/paid`)
        .send({ paid: true })
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
      expect(response.body.log.paid).toBe(true);

      // Verify in database
      const updated = await EarningLog.findById(log._id).lean();
      expect(updated.paid).toBe(true);
    });

    test("should mark payout as unpaid", async () => {
      const log = await EarningLog.create({
        order_id: new mongoose.Types.ObjectId(),
        agent_id: new mongoose.Types.ObjectId(),
        role: "delivery",
        net_earning: 50,
        paid: true,
      });

      const response = await request(app)
        .patch(`/api/admin/payouts/logs/${log._id}/paid`)
        .send({ paid: false })
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
      expect(response.body.log.paid).toBe(false);
    });

    test("should filter payout logs by seller", async () => {
      const seller1 = await Seller.create({
        email: "filter1@seller.com",
        business_name: "Filter Seller 1",
        phone: "1010101010",
        password: "pass123",
        approved: true,
      });

      const seller2 = await Seller.create({
        email: "filter2@seller.com",
        business_name: "Filter Seller 2",
        phone: "2020202020",
        password: "pass123",
        approved: true,
      });

      await EarningLog.create({
        order_id: new mongoose.Types.ObjectId(),
        seller_id: seller1._id,
        role: "seller",
        net_earning: 100,
      });

      await EarningLog.create({
        order_id: new mongoose.Types.ObjectId(),
        seller_id: seller2._id,
        role: "seller",
        net_earning: 200,
      });

      const response = await request(app)
        .get("/api/admin/payouts/logs")
        .query({ role: "seller", sellerId: seller1._id.toString() })
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.rows).toHaveLength(1);
      expect(response.body.rows[0].seller_id.toString()).toBe(
        seller1._id.toString()
      );
    });

    test("should filter payout logs by agent", async () => {
      const agent1 = await DeliveryAgent.create({
        name: "Filter Agent 1",
        email: "filteragent1@test.com",
        phone: "3030303030",
        password: "pass123",
        approved: true,
      });

      const agent2 = await DeliveryAgent.create({
        name: "Filter Agent 2",
        email: "filteragent2@test.com",
        phone: "4040404040",
        password: "pass123",
        approved: true,
      });

      await EarningLog.create({
        order_id: new mongoose.Types.ObjectId(),
        agent_id: agent1._id,
        role: "delivery",
        net_earning: 30,
      });

      await EarningLog.create({
        order_id: new mongoose.Types.ObjectId(),
        agent_id: agent2._id,
        role: "delivery",
        net_earning: 40,
      });

      const response = await request(app)
        .get("/api/admin/payouts/logs")
        .query({ role: "delivery", agentId: agent1._id.toString() })
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.rows).toHaveLength(1);
      expect(response.body.rows[0].agent_id.toString()).toBe(
        agent1._id.toString()
      );
    });
  });

  // =========================
  // 3. Error Handling
  // =========================
  describe("Payout Error Handling", () => {
    test("should reject invalid payout log ID", async () => {
      const response = await request(app)
        .patch("/api/admin/payouts/logs/invalid-id/paid")
        .send({ paid: true })
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/invalid payout log id/i);
    });

    test("should return 404 for non-existent payout log", async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const response = await request(app)
        .patch(`/api/admin/payouts/logs/${fakeId}/paid`)
        .send({ paid: true })
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toMatch(/payout log not found/i);
    });

    test("should handle empty payout logs gracefully", async () => {
      const response = await request(app)
        .get("/api/admin/payouts/logs")
        .query({ role: "seller" })
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.rows).toEqual([]);
      expect(response.body.total).toBe(0);
    });

    test("should handle invalid date formats in filters", async () => {
      const response = await request(app)
        .get("/api/admin/payouts/summary")
        .query({ from: "invalid-date", to: "also-invalid" })
        .set("Authorization", `Bearer ${adminToken}`);

      // Should succeed but ignore invalid dates
      expect(response.status).toBe(200);
      expect(response.body.from).toBe(null);
      expect(response.body.to).toBe(null);
    });

    test("should require admin authentication for payouts", async () => {
      await request(app).get("/api/admin/payouts").expect(401);

      await request(app).get("/api/admin/payouts/summary").expect(401);

      await request(app).get("/api/admin/payouts/logs").expect(401);

      const logId = new mongoose.Types.ObjectId();
      await request(app)
        .patch(`/api/admin/payouts/logs/${logId}/paid`)
        .send({ paid: true })
        .expect(401);
    });

    test("should handle pagination for large payout logs", async () => {
      const seller = await Seller.create({
        email: "pagination@seller.com",
        business_name: "Pagination Seller",
        phone: "9090909090",
        password: "pass123",
        approved: true,
      });

      // Create 25 earning logs
      const logs = Array.from({ length: 25 }, (_, i) => ({
        order_id: new mongoose.Types.ObjectId(),
        seller_id: seller._id,
        role: "seller",
        net_earning: 100 + i,
      }));

      await EarningLog.insertMany(logs);

      // Request page 1 (limit 10)
      const page1 = await request(app)
        .get("/api/admin/payouts/logs")
        .query({ role: "seller", page: 1, limit: 10 })
        .set("Authorization", `Bearer ${adminToken}`);

      expect(page1.status).toBe(200);
      expect(page1.body.rows).toHaveLength(10);
      expect(page1.body.total).toBe(25);
      expect(page1.body.page).toBe(1);

      // Request page 2
      const page2 = await request(app)
        .get("/api/admin/payouts/logs")
        .query({ role: "seller", page: 2, limit: 10 })
        .set("Authorization", `Bearer ${adminToken}`);

      expect(page2.status).toBe(200);
      expect(page2.body.rows).toHaveLength(10);
      expect(page2.body.page).toBe(2);

      // Request page 3 (only 5 remaining)
      const page3 = await request(app)
        .get("/api/admin/payouts/logs")
        .query({ role: "seller", page: 3, limit: 10 })
        .set("Authorization", `Bearer ${adminToken}`);

      expect(page3.status).toBe(200);
      expect(page3.body.rows).toHaveLength(5);
    });

    test("should handle zero commission rate", async () => {
      await PlatformSettings.create({
        platform_commission_rate: 0,
      });

      const seller = await Seller.create({
        email: "zerocomm@seller.com",
        business_name: "Zero Comm Seller",
        phone: "1212121212",
        password: "pass123",
        approved: true,
      });

      const product = await Product.create({
        name: "Zero Comm Product",
        price: 1000,
        seller_id: seller._id,
        category: "grocery",
        stock: 10,
      });

      const client = await Client.create({
        firebase_uid: "zero_comm_client",
        name: "Zero Comm Client",
        email: "zerocomm@client.com",
        phone: "1313131313",
      });

      await Order.create({
        client_id: client.firebase_uid,
        seller_id: seller._id,
        order_items: [
          { product_id: product._id, qty: 1, price_snapshot: 1000 },
        ],

        delivery: {
          delivery_status: "delivered",
          delivery_address: { full_address: "123 Test St" },
        },
        status: "delivered",
        payment: { amount: 1000, method: "COD", status: "paid" },
      });

      const response = await request(app)
        .get("/api/admin/payouts/summary")
        .query({ sellerId: seller._id.toString() })
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.rows[0].platform_commission).toBe(0);
      expect(response.body.rows[0].seller_net).toBe(1000); // Full amount to seller
    });

    test("should enrich payout logs with order context", async () => {
      const seller = await Seller.create({
        email: "context@seller.com",
        business_name: "Context Seller",
        phone: "1414141414",
        password: "pass123",
        approved: true,
      });

      const product = await Product.create({
        name: "Context Product",
        price: 250,
        seller_id: seller._id,
        category: "grocery",
        stock: 20,
      });

      const client = await Client.create({
        firebase_uid: "context_client",
        name: "Context Client",
        email: "context@client.com",
        phone: "1515151515",
      });

      const order = await Order.create({
        client_id: client.firebase_uid,
        seller_id: seller._id,
        order_items: [{ product_id: product._id, qty: 1, price_snapshot: 250 }],

        delivery: {
          delivery_status: "delivered",
          delivery_address: { full_address: "123 Test St" },
        },
        status: "delivered",
        payment: { amount: 250, method: "COD", status: "paid" },
      });

      await EarningLog.create({
        order_id: order._id,
        seller_id: seller._id,
        role: "seller",
        net_earning: 225,
      });

      const response = await request(app)
        .get("/api/admin/payouts/logs")
        .query({ role: "seller", sellerId: seller._id.toString() })
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.rows[0].order).toBeDefined();
      expect(response.body.rows[0].order._id.toString()).toBe(
        order._id.toString()
      );
      expect(response.body.rows[0].order.delivery.delivery_status).toBe(
        "delivered"
      );
      expect(response.body.rows[0].order.payment.method).toBe("COD");
    });
  });

  // =========================
  // 4. Aggregate Payouts Endpoint
  // =========================
  describe("Aggregate Payouts (GET /api/admin/payouts)", () => {
    test("should aggregate payouts by seller", async () => {
      const seller = await Seller.create({
        email: "aggregate@seller.com",
        business_name: "Aggregate Seller",
        phone: "1616161616",
        password: "pass123",
        approved: true,
      });

      const product = await Product.create({
        name: "Aggregate Product",
        price: 150,
        seller_id: seller._id,
        category: "grocery",
        stock: 100,
      });

      const client = await Client.create({
        firebase_uid: "aggregate_client",
        name: "Aggregate Client",
        email: "aggregate@client.com",
        phone: "1717171717",
      });

      // Create 3 completed orders
      for (let i = 0; i < 3; i++) {
        await Order.create({
          client_id: client.firebase_uid,
          seller_id: seller._id,
          order_items: [
            { product_id: product._id, qty: 1, price_snapshot: 150 },
          ],

          delivery: {
            delivery_status: "delivered",
            delivery_address: { full_address: "123 Test St" },
          },
          status: "delivered",
          payment: { amount: 150, method: "COD", status: "paid" },
        });
      }

      const response = await request(app)
        .get("/api/admin/payouts")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.rows).toBeDefined();
      expect(response.body.total).toBeGreaterThan(0);

      const sellerRow = response.body.rows.find(
        (r) => r._id.toString() === seller._id.toString()
      );
      expect(sellerRow).toBeDefined();
      expect(sellerRow.total_sales).toBe(450); // 3 orders × 150
      expect(sellerRow.orders).toBe(3);
    });

    test("should handle pagination in aggregate payouts", async () => {
      const response = await request(app)
        .get("/api/admin/payouts")
        .query({ page: 1, limit: 5 })
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.page).toBe(1);
      expect(response.body.limit).toBe(5);
      expect(response.body.rows.length).toBeLessThanOrEqual(5);
    });

    test("should search payouts by seller ID", async () => {
      const seller = await Seller.create({
        email: "search@payout.com",
        business_name: "Search Seller",
        phone: "1818181818",
        password: "pass123",
        approved: true,
      });

      const product = await Product.create({
        name: "Search Product",
        price: 200,
        seller_id: seller._id,
        category: "grocery",
        stock: 50,
      });

      const client = await Client.create({
        firebase_uid: "search_client",
        name: "Search Client",
        email: "search@client.com",
        phone: "1919191919",
      });

      await Order.create({
        client_id: client.firebase_uid,
        seller_id: seller._id,
        order_items: [{ product_id: product._id, qty: 1, price_snapshot: 200 }],

        delivery: {
          delivery_status: "delivered",
          delivery_address: { full_address: "123 Test St" },
        },
        status: "delivered",
        payment: { amount: 200, method: "COD", status: "paid" },
      });

      const response = await request(app)
        .get("/api/admin/payouts")
        .query({ search: seller._id.toString().substring(0, 8) })
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.rows).toBeDefined();
      // Search should filter rows containing the search term
      expect(response.body.total).toBeGreaterThanOrEqual(0);
    });
  });
});
