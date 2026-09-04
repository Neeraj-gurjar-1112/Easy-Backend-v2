/**
 * Admin Routes Extended Test Suite - Priority 5.5
 * Tests for routes/admin.js - Admin controller extensions
 *
 * Focus Areas:
 * - Role management (PATCH/DELETE /roles/:id)
 * - Payout operations (summary, logs)
 * - Export operations (CSV/JSON for sellers, products, orders, agents)
 * - Cascade delete operations (seller/agent cleanup)
 *
 * Target: 46.65% → 55% coverage (+8.35%)
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
  DeviceToken,
} = require("../lib/models");

// Store admin token for authenticated requests
let adminToken;
let testAdminId;
let moderatorToken;
let moderatorId;

beforeAll(async () => {
  await connectTestDB();
}, 30000);

afterAll(async () => {
  await closeTestDB();
});

beforeEach(async () => {
  await clearTestDB();

  // Create test superadmin
  const admin = await Admin.create({
    email: "test.admin@example.com",
    name: "Test Admin",
    password: "admin123456",
    role: "superadmin",
  });

  testAdminId = admin._id;

  // Generate admin JWT token
  adminToken = jwt.sign(
    {
      id: admin._id,
      email: admin.email,
      role: "admin",
      exp: Math.floor(Date.now() / 1000) + 2 * 60 * 60,
    },
    process.env.JWT_SECRET
  );

  // Create test moderator
  const moderator = await Admin.create({
    email: "moderator@example.com",
    name: "Test Moderator",
    password: "moderator123",
    role: "moderator",
  });

  moderatorId = moderator._id;

  // Generate moderator JWT token
  moderatorToken = jwt.sign(
    {
      id: moderator._id,
      email: moderator.email,
      role: "admin",
      exp: Math.floor(Date.now() / 1000) + 2 * 60 * 60,
    },
    process.env.JWT_SECRET
  );

  // Initialize platform settings with commission rates
  await PlatformSettings.findOneAndUpdate(
    {},
    {
      $setOnInsert: {
        platform_commission_rate: 0.1, // 10%
        delivery_agent_share_rate: 0.8, // 80%
        delivery_charge_grocery: 30,
        delivery_charge_food: 40,
      },
    },
    { upsert: true, new: true }
  );
});

// ============================================================================
// ROLE MANAGEMENT TESTS (6 tests)
// Lines: 2060-2123
// ============================================================================

describe("PATCH /api/admin/roles/:id - Update Admin Role", () => {
  test("should update moderator role to superadmin", async () => {
    const response = await request(app)
      .patch(`/api/admin/roles/${moderatorId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ role: "superadmin" })
      .expect(200);

    expect(response.body.id).toBe(moderatorId.toString());
    expect(response.body.email).toBe("moderator@example.com");
    expect(response.body.role).toBe("superadmin");
    expect(response.body.created_at).toBeDefined();

    // Verify database update
    const updated = await Admin.findById(moderatorId);
    expect(updated.role).toBe("superadmin");
  });

  test("should update superadmin role to moderator (when multiple superadmins exist)", async () => {
    // Create second superadmin
    const secondAdmin = await Admin.create({
      email: "second.admin@example.com",
      password: "admin123",
      role: "superadmin",
    });

    const response = await request(app)
      .patch(`/api/admin/roles/${testAdminId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ role: "moderator" })
      .expect(200);

    expect(response.body.role).toBe("moderator");

    // Clean up
    await Admin.findByIdAndDelete(secondAdmin._id);
  });

  test("should reject demotion of last remaining superadmin", async () => {
    const response = await request(app)
      .patch(`/api/admin/roles/${testAdminId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ role: "moderator" })
      .expect(400);

    expect(response.body.error).toMatch(/cannot demote the last superadmin/i);

    // Verify database NOT updated
    const unchanged = await Admin.findById(testAdminId);
    expect(unchanged.role).toBe("superadmin");
  });

  test("should reject invalid role value", async () => {
    const response = await request(app)
      .patch(`/api/admin/roles/${moderatorId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ role: "invalid_role" })
      .expect(400);

    expect(response.body.error).toMatch(/invalid role/i);
  });

  test("should reject invalid admin ID", async () => {
    const response = await request(app)
      .patch(`/api/admin/roles/invalid_id`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ role: "moderator" })
      .expect(400);

    expect(response.body.error).toMatch(/invalid admin id/i);
  });

  test("should return 404 for non-existent admin", async () => {
    const fakeId = new mongoose.Types.ObjectId();

    const response = await request(app)
      .patch(`/api/admin/roles/${fakeId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ role: "moderator" })
      .expect(404);

    expect(response.body.error).toMatch(/admin not found/i);
  });
});

describe("DELETE /api/admin/roles/:id - Delete Admin", () => {
  test("should delete moderator successfully", async () => {
    const response = await request(app)
      .delete(`/api/admin/roles/${moderatorId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(204);

    expect(response.body).toEqual({});

    // Verify database deletion
    const deleted = await Admin.findById(moderatorId);
    expect(deleted).toBeNull();
  });

  test("should reject deletion of last remaining superadmin", async () => {
    const response = await request(app)
      .delete(`/api/admin/roles/${testAdminId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(400);

    expect(response.body.error).toMatch(/cannot delete the last superadmin/i);

    // Verify database NOT deleted
    const unchanged = await Admin.findById(testAdminId);
    expect(unchanged).not.toBeNull();
  });

  test("should allow deletion of superadmin when multiple exist", async () => {
    // Create second superadmin
    const secondAdmin = await Admin.create({
      email: "second.admin@example.com",
      password: "admin123",
      role: "superadmin",
    });

    const response = await request(app)
      .delete(`/api/admin/roles/${testAdminId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(204);

    // Verify database deletion
    const deleted = await Admin.findById(testAdminId);
    expect(deleted).toBeNull();

    // Clean up
    await Admin.findByIdAndDelete(secondAdmin._id);
  });

  test("should reject invalid admin ID", async () => {
    const response = await request(app)
      .delete(`/api/admin/roles/invalid_id`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(400);

    expect(response.body.error).toMatch(/invalid admin id/i);
  });

  test("should return 404 for non-existent admin", async () => {
    const fakeId = new mongoose.Types.ObjectId();

    const response = await request(app)
      .delete(`/api/admin/roles/${fakeId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(404);

    expect(response.body.error).toMatch(/admin not found/i);
  });
});

// ============================================================================
// PAYOUT OPERATIONS TESTS (6 tests)
// Lines: 2971-3061, 3067-3133
// ============================================================================

describe("GET /api/admin/payouts/summary - Payout Summary", () => {
  beforeEach(async () => {
    // Create test seller
    const seller = await Seller.create({
      business_name: "Test Store",
      email: "seller@test.com",
      phone: "+1234567890",
      business_type: "grocery",
      approved: true,
    });

    // Create test product
    const product = await Product.create({
      name: "Test Product",
      price: 50,
      category: "Groceries",
      seller_id: seller._id,
      stock: 100,
      available: true,
    });

    // Create test client
    const client = await Client.create({
      name: "Test Client",
      phone: "+9999999999",
      firebase_uid: "test-client-uid-payout-" + Date.now(),
    });

    // Create delivered orders
    await Order.create([
      {
        client_id: client.firebase_uid,
        seller_id: seller._id,
        order_items: [
          {
            product_id: product._id,
            name_snapshot: "Test Product",
            price_snapshot: 50,
            qty: 2,
          },
        ],
        payment: {
          method: "COD",
          status: "paid",
          amount: 100,
        },
        delivery: {
          delivery_status: "delivered",
          delivery_address: {
            full_address: "123 Test St",
            location: { type: "Point", coordinates: [0, 0] },
          },
        },
        created_at: new Date(),
      },
      {
        client_id: client.firebase_uid,
        seller_id: seller._id,
        order_items: [
          {
            product_id: product._id,
            name_snapshot: "Test Product",
            price_snapshot: 50,
            qty: 4,
          },
        ],
        payment: {
          method: "COD",
          status: "paid",
          amount: 200,
        },
        delivery: {
          delivery_status: "delivered",
          delivery_address: {
            full_address: "456 Test Ave",
            location: { type: "Point", coordinates: [0, 0] },
          },
        },
        created_at: new Date(),
      },
    ]);
  });

  test("should return payout summary with aggregated earnings", async () => {
    const response = await request(app)
      .get("/api/admin/payouts/summary")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.totals).toBeDefined();
    expect(response.body.rows).toBeDefined();
    expect(Array.isArray(response.body.rows)).toBe(true);
    expect(response.body.rows.length).toBeGreaterThan(0);

    // Check aggregated data structure
    const sellerRow = response.body.rows[0];
    expect(sellerRow.seller_id).toBeDefined();
    expect(sellerRow.item_total).toBeDefined();
    expect(sellerRow.orders_count).toBeDefined();
    expect(sellerRow.platform_commission).toBeDefined();
    expect(sellerRow.seller_net).toBeDefined();
  });

  test("should filter payout summary by date range", async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const response = await request(app)
      .get("/api/admin/payouts/summary")
      .query({
        from: yesterday.toISOString(),
        to: tomorrow.toISOString(),
      })
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.rows).toBeDefined();
    expect(response.body.totals).toBeDefined();
  });

  test("should return empty rows array when no payouts exist", async () => {
    await clearTestDB();

    const response = await request(app)
      .get("/api/admin/payouts/summary")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.rows).toEqual([]);
    expect(response.body.totals.orders_count).toBe(0);
  });
});

describe("GET /api/admin/payouts/logs - Payout Logs", () => {
  beforeEach(async () => {
    // Create test seller
    const seller = await Seller.create({
      business_name: "Test Store",
      email: "seller@test.com",
      phone: "+1234567890",
      business_type: "grocery",
      approved: true,
    });

    // Create earning logs
    for (let i = 0; i < 15; i++) {
      await EarningLog.create({
        role: "seller",
        seller_id: seller._id,
        order_id: new mongoose.Types.ObjectId(),
        item_total: 100 + i * 10,
        platform_commission: 10 + i,
        net_earning: 90 + i * 9,
        created_at: new Date(Date.now() - i * 1000 * 60 * 60), // Spread over time
      });
    }
  });

  test("should return payout logs with pagination", async () => {
    const response = await request(app)
      .get("/api/admin/payouts/logs")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.rows).toBeDefined();
    expect(Array.isArray(response.body.rows)).toBe(true);
    expect(response.body.page).toBe(1);
    expect(response.body.limit).toBeDefined();
    expect(response.body.total).toBeGreaterThan(0);
  });

  test("should support pagination with page and limit", async () => {
    const response = await request(app)
      .get("/api/admin/payouts/logs")
      .query({ page: 2, limit: 5 })
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.page).toBe(2);
    expect(response.body.limit).toBe(5);
    expect(response.body.rows.length).toBeLessThanOrEqual(5);
  });

  test("should filter payout logs by seller_id", async () => {
    const seller = await Seller.findOne({ email: "seller@test.com" });

    const response = await request(app)
      .get("/api/admin/payouts/logs")
      .query({ sellerId: seller._id.toString() })
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.rows).toBeDefined();
    expect(response.body.rows.length).toBeGreaterThan(0);
    // All logs should be for this seller
    response.body.rows.forEach((log) => {
      expect(log.seller_id.toString()).toBe(seller._id.toString());
    });
  });
});

// ============================================================================
// SELLER CASCADE DELETE TESTS (4 tests)
// Lines: 1019-1077 (_deleteSellerCascade function)
// ============================================================================

describe("DELETE /api/admin/sellers/:id - Cascade Delete", () => {
  let testSeller;
  let testProduct;
  let testOrder;

  beforeEach(async () => {
    // Create test seller
    testSeller = await Seller.create({
      business_name: "Test Store to Delete",
      email: "delete@test.com",
      phone: "+1234567890",
      business_type: "grocery",
      approved: true,
      firebase_uid: "seller-to-delete-uid",
    });

    // Create product for this seller
    testProduct = await Product.create({
      name: "Product to Delete",
      price: 10.99,
      category: "Groceries",
      seller_id: testSeller._id,
      stock: 100,
      available: true,
    });

    // Create order for this seller
    const client = await Client.create({
      name: "Test Client",
      phone: "+9999999999",
      firebase_uid: "test-client-uid-" + Date.now(),
    });

    testOrder = await Order.create({
      client_id: client.firebase_uid,
      seller_id: testSeller._id,
      order_items: [
        {
          product_id: testProduct._id,
          name_snapshot: "Product to Delete",
          price_snapshot: 10.99,
          qty: 1,
        },
      ],
      payment: {
        method: "COD",
        status: "pending",
        amount: 10.99,
      },
      delivery: {
        delivery_status: "pending",
        delivery_address: {
          full_address: "123 Test St",
          location: { type: "Point", coordinates: [0, 0] },
        },
      },
    });

    // Create earning log for this seller
    await EarningLog.create({
      role: "seller",
      seller_id: testSeller._id,
      order_id: testOrder._id,
      item_total: 10.99,
      platform_commission: 1.1,
      net_earning: 9.89,
    });

    // Create device token for this seller
    await DeviceToken.create({
      user_id: testSeller.firebase_uid,
      token: "test-device-token-123",
      device_type: "android",
    });
  });

  test("should cascade delete seller with all related data", async () => {
    const response = await request(app)
      .delete(`/api/admin/sellers/${testSeller._id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.message).toMatch(/seller deleted/i);
    expect(response.body.cascade).toBeDefined();
    expect(response.body.cascade.productsDeleted).toBeGreaterThan(0);
    expect(response.body.cascade.ordersDeleted).toBeGreaterThan(0);
    expect(response.body.cascade.earningsDeleted).toBeGreaterThan(0);
    expect(response.body.cascade.deviceTokensDeleted).toBeGreaterThan(0);

    // Verify deletion
    const deletedSeller = await Seller.findById(testSeller._id);
    expect(deletedSeller).toBeNull();

    const deletedProducts = await Product.find({ seller_id: testSeller._id });
    expect(deletedProducts.length).toBe(0);

    const deletedOrders = await Order.find({ seller_id: testSeller._id });
    expect(deletedOrders.length).toBe(0);
  });

  test("should return cascade summary with counts", async () => {
    const response = await request(app)
      .delete(`/api/admin/sellers/${testSeller._id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.cascade.productsDeleted).toBe(1);
    expect(response.body.cascade.ordersDeleted).toBe(1);
    expect(response.body.cascade.earningsDeleted).toBe(1);
    expect(response.body.cascade.deviceTokensDeleted).toBe(1);
  });

  test("should support full delete with Firebase user deletion", async () => {
    const response = await request(app)
      .delete(`/api/admin/sellers/${testSeller._id}`)
      .query({ full: "true" })
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.full).toBe(true);
    expect(response.body.cascade).toBeDefined();
  });

  test("should return 404 for non-existent seller", async () => {
    const fakeId = new mongoose.Types.ObjectId();

    const response = await request(app)
      .delete(`/api/admin/sellers/${fakeId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(404);

    expect(response.body.error).toMatch(/seller not found/i);
  });
});

// ============================================================================
// DELIVERY AGENT CASCADE DELETE TESTS (2 tests)
// Lines: 1049-1077 (_deleteDeliveryAgentCascade function)
// ============================================================================

describe("DELETE /api/admin/delivery-agents/:id - Cascade Delete", () => {
  let testAgent;

  beforeEach(async () => {
    // Create test delivery agent
    testAgent = await DeliveryAgent.create({
      name: "Agent to Delete",
      email: "agent-delete@test.com",
      phone: "+1234567890",
      firebase_uid: "agent-to-delete-uid",
      approved: true,
      available: true,
    });

    // Create device token for this agent
    await DeviceToken.create({
      user_id: testAgent.firebase_uid,
      token: "test-agent-token-456",
      device_type: "ios",
    });

    // Create order assigned to this agent
    const seller = await Seller.create({
      business_name: "Test Store",
      email: "seller@test.com",
      phone: "+9999999999",
      business_type: "grocery",
      approved: true,
    });

    const client = await Client.create({
      name: "Test Client",
      phone: "+8888888888",
      firebase_uid: "test-client-uid-" + Date.now(),
    });

    await Order.create({
      client_id: client.firebase_uid,
      seller_id: seller._id,
      order_items: [
        {
          product_id: new mongoose.Types.ObjectId(),
          name_snapshot: "Product",
          price_snapshot: 10.99,
          qty: 1,
        },
      ],
      payment: {
        method: "COD",
        status: "pending",
        amount: 10.99,
      },
      delivery: {
        delivery_status: "pending",
        delivery_agent_id: testAgent._id.toString(),
        delivery_address: {
          full_address: "123 Test St",
          location: { type: "Point", coordinates: [0, 0] },
        },
      },
    });
  });

  test("should cascade delete agent and unassign from orders", async () => {
    const response = await request(app)
      .delete(`/api/admin/delivery-agents/${testAgent._id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.message).toMatch(/agent deleted/i);
    expect(response.body.cascade).toBeDefined();
    expect(response.body.cascade.deviceTokensDeleted).toBeGreaterThan(0);
    expect(response.body.cascade.ordersUpdated).toBeGreaterThan(0);

    // Verify deletion
    const deletedAgent = await DeliveryAgent.findById(testAgent._id);
    expect(deletedAgent).toBeNull();

    // Verify orders are unassigned
    const unassignedOrders = await Order.find({
      "delivery.delivery_agent_id": testAgent._id.toString(),
    });
    expect(unassignedOrders.length).toBe(0);
  });

  test("should return 404 for non-existent agent", async () => {
    const fakeId = new mongoose.Types.ObjectId();

    const response = await request(app)
      .delete(`/api/admin/delivery-agents/${fakeId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(404);

    expect(response.body.error).toMatch(/agent not found/i);
  });
});
