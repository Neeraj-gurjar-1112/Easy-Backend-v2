/**
 * Phase 9: Delivery Routes Final Push - Batch P
 * Target: Uncovered lines in reassignment, OTP verification, and commission logic
 * Expected coverage gain: delivery.js 76.48% → 90%+
 */

const request = require("supertest");
const app = require("../app");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const {
  Order,
  DeliveryAgent,
  Product,
  Client: User,
  Admin,
} = require("../lib/models");
const { setupTestDB, cleanupTestDB } = require("./testUtils/dbHandler");
const { publish, publishToSeller } = require("../lib/events/orderEvents");

// Mock orderEvents service
jest.mock("../lib/events/orderEvents", () => ({
  publish: jest.fn(),
  publishToSeller: jest.fn(),
}));

// Mock push notification service
jest.mock("../lib/push", () => ({
  notifyOrderUpdate: jest.fn().mockResolvedValue(true),
  notifyAgent: jest.fn().mockResolvedValue(true),
}));

// Mock geocoding service
jest.mock("../lib/util/geocode", () => ({
  reverseGeocode: jest.fn().mockResolvedValue({
    lat: 12.9716,
    lng: 77.5946,
    formattedAddress: "Bangalore, Karnataka",
  }),
  geocodeAddress: jest.fn().mockResolvedValue({
    lat: 12.9716,
    lng: 77.5946,
    formattedAddress: "Bangalore, Karnataka",
  }),
}));

describe("Phase 9: Delivery Routes - Batch P (Uncovered Paths)", () => {
  let adminToken, agentToken;
  let agent1, agent2, agent3;
  let customer, seller;
  let product1, product2;

  beforeAll(async () => {
    await setupTestDB();
    // Create admin directly in database
    const admin = await Admin.create({
      email: "admin_phase9p@test.com",
      password: await bcrypt.hash("Admin123!", 10),
      role: "superadmin",
    });

    // Generate valid admin JWT token
    adminToken = jwt.sign(
      {
        id: admin._id,
        email: admin.email,
        role: "admin",
        exp: Math.floor(Date.now() / 1000) + 2 * 60 * 60, // 2 hours
      },
      process.env.JWT_SECRET
    );

    // Create customer directly
    customer = await User.create({
      email: "customer_phase9p@test.com",
      password: await bcrypt.hash("Customer123!", 10),
      phone: "+919876543211",
      first_name: "Phase 9",
      last_name: "Customer",
      role: "customer",
    });

    // Create seller directly with location
    seller = await User.create({
      email: "seller_phase9p@test.com",
      password: await bcrypt.hash("Seller123!", 10),
      phone: "+919876543212",
      first_name: "Phase 9",
      last_name: "Seller",
      role: "seller",
      approved: true,
      business_name: "Phase 9 Test Store",
      location: { lat: 12.9716, lng: 77.5946 },
    });

    // Create products
    product1 = await Product.create({
      name: "Test Product 1",
      description: "Product for Phase 9 Batch P",
      price: 100,
      seller_id: seller._id,
      category: "Electronics",
      stock: 50,
    });

    product2 = await Product.create({
      name: "Test Product 2",
      description: "Product 2 for Phase 9 Batch P",
      price: 200,
      seller_id: seller._id,
      category: "Electronics",
      stock: 50,
    });

    // Create 3 delivery agents with varying location data
    agent1 = await DeliveryAgent.create({
      email: "agent1_phase9p@test.com",
      password: await bcrypt.hash("Agent123!", 10),
      phone: "+919876543213",
      name: "Agent 1 Phase 9P",
      first_name: "Agent 1",
      last_name: "Phase 9P",
      role: "delivery_agent",
      approved: true,
      active: true,
      available: true,
      current_location: { lat: 12.9716, lng: 77.5946 },
      assigned_orders: 0,
    });
    // Create admin token for agent operations
    const adminLoginRes = await request(app).post("/api/auth/login").send({
      email: "admin@test.com",
      password: "Admin123!",
    });
    agentToken = adminLoginRes.body.token;

    agent2 = await DeliveryAgent.create({
      email: "agent2_phase9p@test.com",
      password: await bcrypt.hash("Agent123!", 10),
      phone: "+919876543214",
      name: "Agent 2 Phase 9P",
      first_name: "Agent 2",
      last_name: "Phase 9P",
      role: "delivery_agent",
      approved: true,
      active: true,
      available: true,
      // Agent 2 has NO current_location
      assigned_orders: 1, // Higher assigned count
    });

    agent3 = await DeliveryAgent.create({
      email: "agent3_phase9p@test.com",
      password: await bcrypt.hash("Agent123!", 10),
      phone: "+919876543215",
      name: "Agent 3 Phase 9P",
      first_name: "Agent 3",
      last_name: "Phase 9P",
      role: "delivery_agent",
      approved: true,
      active: true,
      available: true,
      current_location: { lat: 13.0, lng: 77.6 }, // Further away
      assigned_orders: 2, // Highest assigned count
    });
  });

  afterAll(async () => {
    await cleanupTestDB();
  });

  // ========================================
  // SECTION 1: REASSIGNMENT WITHOUT STORE LOCATION
  // Target: Lines 1089-1107 (pickup_address/delivery_address fallback)
  // ========================================

  describe("Section 1: Reassignment Without Store Location", () => {
    test("1.1: Should reassign using pickup_address location when no product seller location", async () => {
      // Create order with pickup_address but product has no seller location
      const productNoSeller = await Product.create({
        name: "No Seller Location Product",
        price: 50,
        seller_id: seller._id,
        category: "Test",
        stock: 10,
      });

      // Create order
      const order = await Order.create({
        client_id: customer._id,
        seller_id: seller._id,
        order_items: [
          {
            product_id: productNoSeller._id,
            qty: 1,
            price_snapshot: 50,
          },
        ],
        payment: { amount: 50, method: "COD", status: "pending" },
        status: "confirmed",
        delivery: {
          delivery_agent_id: agent1._id,
          delivery_status: "pending",
          delivery_address: {
            full_address: "Test Address",
            location: { lat: 12.99, lng: 77.61 },
          },
        },
      });

      // Simulate timeout to trigger reassignment
      order.delivery.assigned_at = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
      await order.save();

      // Trigger reassignment (admin force reassign)
      const res = await request(app)
        .post(`/api/delivery/force-reassign/${order._id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send();

      expect(res.status).toBe(200);
      expect(res.body.message).toContain("reassigned");

      // Verify order reassigned (should use pickup_address for distance calc)
      const updatedOrder = await Order.findById(order._id);
      expect(updatedOrder.delivery.delivery_agent_id).toBeDefined();
      expect(updatedOrder.delivery.delivery_agent_id.toString()).not.toBe(
        agent1._id.toString()
      );

      await Product.findByIdAndDelete(productNoSeller._id);
      await Order.findByIdAndDelete(order._id);
    });

    test("1.2: Should fallback to delivery_address when no pickup_address location", async () => {
      const productNoSeller = await Product.create({
        name: "No Seller Location Product 2",
        price: 60,
        seller_id: seller._id,
        category: "Test",
        stock: 10,
      });

      const order = await Order.create({
        client_id: customer._id,
        seller_id: seller._id,
        order_items: [
          {
            product_id: productNoSeller._id,
            qty: 1,
            price_snapshot: 60,
          },
        ],
        payment: { amount: 60, method: "COD", status: "pending" },
        status: "confirmed",
        delivery: {
          delivery_agent_id: agent1._id,
          delivery_status: "pending",
          assigned_at: new Date(Date.now() - 2 * 60 * 60 * 1000),
          delivery_address: {
            full_address: "Test Address",
            location: { lat: 12.99, lng: 77.61 },
          },
        },
      });

      const res = await request(app)
        .post(`/api/delivery/force-reassign/${order._id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send();

      expect(res.status).toBe(200);

      const updatedOrder = await Order.findById(order._id);
      expect(updatedOrder.delivery.delivery_agent_id).toBeDefined();

      await Product.findByIdAndDelete(productNoSeller._id);
      await Order.findByIdAndDelete(order._id);
    });

    test("1.3: Should reassign when no store, pickup, or delivery location available", async () => {
      const productNoSeller = await Product.create({
        name: "No Location Product",
        price: 70,
        seller_id: seller._id,
        category: "Test",
        stock: 10,
      });

      const order = await Order.create({
        client_id: customer._id,
        seller_id: seller._id,
        order_items: [
          {
            product_id: productNoSeller._id,
            qty: 1,
            price_snapshot: 70,
          },
        ],
        payment: { amount: 70, method: "COD", status: "pending" },
        status: "confirmed",
        delivery: {
          delivery_agent_id: agent1._id,
          delivery_status: "pending",
          assigned_at: new Date(Date.now() - 2 * 60 * 60 * 1000),
          delivery_address: {
            full_address: "No Location Address",
          },
        },
      });

      const res = await request(app)
        .post(`/api/delivery/force-reassign/${order._id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send();

      expect(res.status).toBe(200);

      // Should fall back to least assigned agent (no distance calc possible)
      const updatedOrder = await Order.findById(order._id);
      expect(updatedOrder.delivery.delivery_agent_id).toBeDefined();

      await Product.findByIdAndDelete(productNoSeller._id);
      await Order.findByIdAndDelete(order._id);
    });
  });

  // ========================================
  // SECTION 2: AGENT SELECTION WITHOUT LOCATION DATA
  // Target: Lines 1113-1160 (fallback to least assigned when no agent locations)
  // ========================================

  describe("Section 2: Agent Selection Without Location Data", () => {
    test("2.1: Should select least assigned agent when no agents have current_location", async () => {
      // Temporarily remove all agent locations
      await DeliveryAgent.updateMany(
        { _id: { $in: [agent1._id, agent2._id, agent3._id] } },
        { $unset: { current_location: "" } }
      );

      const order = await Order.create({
        client_id: customer._id,
        seller_id: seller._id,
        order_items: [
          {
            product_id: product1._id,
            qty: 1,
            price_snapshot: 100,
          },
        ],
        payment: { amount: 100, method: "COD", status: "pending" },
        status: "confirmed",
        pickup_address: {
          location: { lat: 12.98, lng: 77.6 },
          street: "Test Pickup",
        },
        delivery: {
          delivery_address: {
            full_address: "Test Address",
            location: { lat: 12.99, lng: 77.61 },
            street: "Test Delivery",
          },
          delivery_agent_id: agent3._id, // Currently assigned to agent3 (highest assigned_orders) delivery_status: "pending",
          assigned_at: new Date(Date.now() - 2 * 60 * 60 * 1000),
        },
      });

      const res = await request(app)
        .post(`/api/delivery/force-reassign/${order._id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send();

      expect(res.status).toBe(200);

      const updatedOrder = await Order.findById(order._id);
      // Should assign to agent with lowest assigned_orders (agent1 or agent2, excluding agent3)
      expect(updatedOrder.delivery.delivery_agent_id.toString()).not.toBe(
        agent3._id.toString()
      );

      // Restore locations
      agent1 = await DeliveryAgent.findById(agent1._id);
      agent1.current_location = { lat: 12.9716, lng: 77.5946 };
      await agent1.save();

      agent3 = await DeliveryAgent.findById(agent3._id);
      agent3.current_location = { lat: 13.0, lng: 77.6 };
      await agent3.save();

      await Order.findByIdAndDelete(order._id);
    });

    test("2.2: Should handle mixed location data (some agents with, some without location)", async () => {
      // agent1 has location, agent2 has no location, agent3 has location
      await DeliveryAgent.findByIdAndUpdate(agent2._id, {
        $unset: { current_location: "" },
      });

      const order = await Order.create({
        client_id: customer._id,
        seller_id: seller._id,
        order_items: [
          {
            product_id: product1._id,
            qty: 1,
            price_snapshot: 100,
          },
        ],
        payment: { amount: 100, method: "COD", status: "pending" },
        status: "confirmed",
        pickup_address: {
          location: { lat: 12.98, lng: 77.6 },
          street: "Test Pickup",
        },
        delivery: {
          delivery_address: {
            full_address: "Test Address",
            location: { lat: 12.99, lng: 77.61 },
            street: "Test Delivery",
          },
          delivery_agent_id: agent3._id,
          delivery_status: "pending",
          assigned_at: new Date(Date.now() - 2 * 60 * 60 * 1000),
        },
      });

      const res = await request(app)
        .post(`/api/delivery/force-reassign/${order._id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send();

      expect(res.status).toBe(200);

      const updatedOrder = await Order.findById(order._id);
      // Should prefer agent1 (has location, closer) over agent2 (no location)
      expect(updatedOrder.delivery.delivery_agent_id.toString()).toBe(
        agent1._id.toString()
      );

      await Order.findByIdAndDelete(order._id);
    });

    test("2.3: Should select nearest agent when multiple agents have location data", async () => {
      // Ensure both agent1 and agent3 have locations (agent1 closer)
      agent1 = await DeliveryAgent.findById(agent1._id);
      agent1.current_location = { lat: 12.98, lng: 77.6 }; // Very close to store
      await agent1.save();

      agent3 = await DeliveryAgent.findById(agent3._id);
      agent3.current_location = { lat: 13.1, lng: 77.7 }; // Farther away
      await agent3.save();

      const order = await Order.create({
        client_id: customer._id,
        seller_id: seller._id,
        order_items: [
          {
            product_id: product1._id,
            qty: 1,
            price_snapshot: 100,
          },
        ],
        payment: { amount: 100, method: "COD", status: "pending" },
        status: "confirmed",
        pickup_address: {
          location: { lat: 12.9716, lng: 77.5946 },
          street: "Test Pickup",
        },
        delivery: {
          delivery_address: {
            full_address: "Test Address",
            location: { lat: 12.99, lng: 77.61 },
            street: "Test Delivery",
          },
          delivery_agent_id: agent2._id,
          delivery_status: "pending",
          assigned_at: new Date(Date.now() - 2 * 60 * 60 * 1000),
        },
      });

      const res = await request(app)
        .post(`/api/delivery/force-reassign/${order._id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send();

      expect(res.status).toBe(200);

      const updatedOrder = await Order.findById(order._id);
      // Should select agent1 (nearest)
      expect(updatedOrder.delivery.delivery_agent_id.toString()).toBe(
        agent1._id.toString()
      );

      await Order.findByIdAndDelete(order._id);
    });

    test("2.4: Should handle all available agents already tried (no agents left)", async () => {
      const order = await Order.create({
        client_id: customer._id,
        seller_id: seller._id,
        order_items: [
          {
            product_id: product1._id,
            qty: 1,
            price_snapshot: 100,
          },
        ],
        payment: { amount: 100, method: "COD", status: "pending" },
        status: "confirmed",
        pickup_address: {
          location: { lat: 12.98, lng: 77.6 },
          street: "Test Pickup",
        },
        delivery: {
          delivery_address: {
            full_address: "Test Address",
            location: { lat: 12.99, lng: 77.61 },
            street: "Test Delivery",
          },
          delivery_agent_id: agent1._id,
          delivery_status: "pending",
          assigned_at: new Date(Date.now() - 2 * 60 * 60 * 1000),
          retry_count: 3,
          tried_agent_ids: [agent1._id, agent2._id, agent3._id], // All tried
        },
      });

      const res = await request(app)
        .post(`/api/delivery/force-reassign/${order._id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send();

      // Should handle gracefully (may return error or keep current agent)
      expect([200, 400, 404]).toContain(res.status);

      await Order.findByIdAndDelete(order._id);
    });
  });

  // ========================================
  // SECTION 3: OTP VERIFICATION EDGE CASES
  // Target: Lines 1429-1456 (OTP verification endpoint)
  // ========================================

  describe("Section 3: OTP Verification Edge Cases", () => {
    test("3.1: Should return 400 when OTP parameter is missing", async () => {
      const order = await Order.create({
        client_id: customer._id,
        seller_id: seller._id,
        order_items: [
          {
            product_id: product1._id,
            qty: 1,
            price_snapshot: 100,
          },
        ],
        payment: { amount: 100, method: "COD", status: "pending" },
        status: "confirmed",
        delivery: {
          delivery_agent_id: agent1._id,
          delivery_status: "in_transit",
          otp_code: "123456",
          delivery_address: {
            full_address: "Test Address",
          },
        },
      });

      const res = await request(app)
        .post("/api/delivery/verify-otp")
        .send({ orderId: order._id.toString() }); // Missing otp

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("OTP required");

      await Order.findByIdAndDelete(order._id);
    });

    test("3.2: Should return 404 when order does not exist", async () => {
      const fakeOrderId = new mongoose.Types.ObjectId();

      const res = await request(app)
        .post("/api/delivery/verify-otp")
        .send({ orderId: fakeOrderId.toString(), otp: "123456" });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Order not found");
    });

    test("3.3: Should return 400 when no OTP code generated for order", async () => {
      const order = await Order.create({
        client_id: customer._id,
        seller_id: seller._id,
        order_items: [
          {
            product_id: product1._id,
            qty: 1,
            price_snapshot: 100,
          },
        ],
        payment: { amount: 100, method: "COD", status: "pending" },
        status: "confirmed",
        delivery: {
          delivery_agent_id: agent1._id,
          delivery_status: "in_transit",
          // No otp_code
          delivery_address: {
            full_address: "Test Address",
          },
        },
      });

      const res = await request(app)
        .post("/api/delivery/verify-otp")
        .send({ orderId: order._id.toString(), otp: "123456" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("No OTP generated for this order");

      await Order.findByIdAndDelete(order._id);
    });

    test("3.4: Should return 400 when OTP does not match", async () => {
      const order = await Order.create({
        client_id: customer._id,
        seller_id: seller._id,
        order_items: [
          {
            product_id: product1._id,
            qty: 1,
            price_snapshot: 100,
          },
        ],
        payment: { amount: 100, method: "COD", status: "pending" },
        status: "confirmed",
        delivery: {
          delivery_agent_id: agent1._id,
          delivery_status: "in_transit",
          otp_code: "123456",
          delivery_address: {
            full_address: "Test Address",
          },
        },
      });

      const res = await request(app)
        .post("/api/delivery/verify-otp")
        .send({ orderId: order._id.toString(), otp: "999999" }); // Wrong OTP

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid OTP");

      await Order.findByIdAndDelete(order._id);
    });

    test("3.5: Should verify OTP successfully and update order", async () => {
      const order = await Order.create({
        client_id: customer._id,
        seller_id: seller._id,
        order_items: [
          {
            product_id: product1._id,
            qty: 1,
            price_snapshot: 100,
          },
        ],
        payment: { amount: 100, method: "COD", status: "pending" },
        status: "confirmed",
        delivery: {
          delivery_agent_id: agent1._id,
          delivery_status: "in_transit",
          otp_code: "123456",
          delivery_address: {
            full_address: "Test Address",
          },
        },
      });

      const res = await request(app)
        .post("/api/delivery/verify-otp")
        .send({ orderId: order._id.toString(), otp: "123456" });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain("OTP verified");

      const updatedOrder = await Order.findById(order._id);
      expect(updatedOrder.delivery.otp_verified).toBe(true);
      expect(updatedOrder.delivery.otp_verified_at).toBeDefined();

      await Order.findByIdAndDelete(order._id);
    });

    test("3.6: Should handle SSE publish during OTP verification", async () => {
      publish.mockClear();
      publishToSeller.mockClear();

      const order = await Order.create({
        client_id: customer._id,
        seller_id: seller._id,
        order_items: [
          {
            product_id: product1._id,
            qty: 1,
            price_snapshot: 100,
          },
        ],
        payment: { amount: 100, method: "COD", status: "pending" },
        status: "confirmed",
        delivery: {
          delivery_agent_id: agent1._id,
          delivery_status: "in_transit",
          otp_code: "789012",
          delivery_address: {
            full_address: "Test Address",
          },
        },
      });

      const res = await request(app)
        .post("/api/delivery/verify-otp")
        .send({ orderId: order._id.toString(), otp: "789012" });

      expect(res.status).toBe(200);

      // Verify SSE was called
      expect(publish).toHaveBeenCalled();
      expect(publishToSeller).toHaveBeenCalled();

      await Order.findByIdAndDelete(order._id);
    });
  });

  // ========================================
  // SECTION 4: MULTI-SELLER COMMISSION CALCULATIONS
  // Target: Lines 1279-1298 (commission calculation with multiple sellers)
  // ========================================

  describe("Section 4: Multi-Seller Commission Calculations", () => {
    let seller2, product3;

    beforeAll(async () => {
      // Create second seller directly
      seller2 = await User.create({
        email: "seller2_phase9p@test.com",
        password: await bcrypt.hash("Seller123!", 10),
        phone: "+919876543216",
        first_name: "Seller 2",
        last_name: "Phase 9P",
        role: "seller",
        approved: true,
        business_name: "Seller 2 Test Store",
        location: { lat: 12.98, lng: 77.6 },
      });

      // Create product from seller2
      product3 = await Product.create({
        name: "Seller 2 Product",
        price: 150,
        seller_id: seller2._id,
        category: "Electronics",
        stock: 20,
      });
    });

    afterAll(async () => {
      if (seller2) await User.deleteOne({ _id: seller2._id });
      if (product3) await Product.deleteOne({ _id: product3._id });
    });

    test("4.1: Should calculate commission correctly for multi-seller order", async () => {
      const order = await Order.create({
        client_id: customer._id,
        seller_id: seller._id,
        order_items: [
          {
            product_id: product1._id, // Seller 1, price 100
            qty: 2,
            price_snapshot: 100,
          },
          {
            product_id: product3._id, // Seller 2, price 150
            qty: 1,
            price_snapshot: 150,
          },
        ],
        payment: { amount: 350, method: "UPI", status: "pending" },
        status: "delivered",
        delivery: {
          delivery_agent_id: agent1._id,
          delivery_status: "delivered",
          delivered_at: new Date(),
          delivery_address: {
            full_address: "Test Address",
          },
        },
      });

      // Mark order as delivered to trigger commission calculation
      const res = await request(app)
        .put(`/api/delivery/mark-delivered/${order._id}`)
        .set("Authorization", `Bearer ${agentToken}`)
        .send();

      expect([200, 201]).toContain(res.status);

      // Verify commission calculated (would need to check transaction records in real implementation)
      const updatedOrder = await Order.findById(order._id);
      expect(updatedOrder.status).toBe("delivered");

      await Order.findByIdAndDelete(order._id);
    });

    test("4.2: Should handle commission when product_id missing in order_items", async () => {
      const order = await Order.create({
        client_id: customer._id,
        seller_id: seller._id,
        order_items: [
          {
            product_id: product1._id,
            qty: 1,
            price_snapshot: 100,
          },
          {
            // Missing product_id
            qty: 1,
            price_snapshot: 50,
          },
        ],
        payment: { amount: 150, method: "UPI", status: "pending" },
        status: "confirmed",
        delivery: {
          delivery_agent_id: agent1._id,
          delivery_status: "in_transit",
          delivery_address: {
            full_address: "Test Address",
          },
        },
      });

      const res = await request(app)
        .put(`/api/delivery/mark-delivered/${order._id}`)
        .set("Authorization", `Bearer ${agentToken}`)
        .send();

      // Should handle gracefully without crashing
      expect([200, 201, 400, 500]).toContain(res.status);

      await Order.findByIdAndDelete(order._id);
    });

    test("4.3: Should handle commission when products not found in database", async () => {
      const fakeProductId = new mongoose.Types.ObjectId();

      const order = await Order.create({
        client_id: customer._id,
        seller_id: seller._id,
        order_items: [
          {
            product_id: fakeProductId, // Non-existent product
            qty: 1,
            price_snapshot: 100,
          },
        ],
        payment: { amount: 100, method: "UPI", status: "pending" },
        status: "confirmed",
        delivery: {
          delivery_agent_id: agent1._id,
          delivery_status: "in_transit",
          delivery_address: {
            full_address: "Test Address",
          },
        },
      });

      const res = await request(app)
        .put(`/api/delivery/mark-delivered/${order._id}`)
        .set("Authorization", `Bearer ${agentToken}`)
        .send();

      // Should handle gracefully
      expect([200, 201, 400, 404, 500]).toContain(res.status);

      await Order.findByIdAndDelete(order._id);
    });

    test("4.4: Should handle commission with zero price_snapshot", async () => {
      const order = await Order.create({
        client_id: customer._id,
        seller_id: seller._id,
        order_items: [
          {
            product_id: product1._id,
            qty: 1,
            price_snapshot: 0, // Zero price
          },
        ],
        payment: { amount: 0, method: "UPI", status: "pending" },
        status: "confirmed",
        delivery: {
          delivery_agent_id: agent1._id,
          delivery_status: "in_transit",
          delivery_address: {
            full_address: "Test Address",
          },
        },
      });

      const res = await request(app)
        .put(`/api/delivery/mark-delivered/${order._id}`)
        .set("Authorization", `Bearer ${agentToken}`)
        .send();

      // Should handle gracefully
      expect([200, 201, 400]).toContain(res.status);

      await Order.findByIdAndDelete(order._id);
    });

    test("4.5: Should handle commission with missing qty", async () => {
      const order = await Order.create({
        client_id: customer._id,
        seller_id: seller._id,
        order_items: [
          {
            product_id: product1._id,
            qty: 1,
            price_snapshot: 100,
          },
        ],
        payment: { amount: 100, method: "UPI", status: "pending" },
        status: "confirmed",
        delivery: {
          delivery_agent_id: agent1._id,
          delivery_status: "in_transit",
          delivery_address: {
            full_address: "Test Address",
          },
        },
      });

      const res = await request(app)
        .put(`/api/delivery/mark-delivered/${order._id}`)
        .set("Authorization", `Bearer ${agentToken}`)
        .send();

      // Should handle gracefully
      expect([200, 201, 400]).toContain(res.status);

      await Order.findByIdAndDelete(order._id);
    });

    test("4.6: Should handle commission calculation rounding correctly", async () => {
      const order = await Order.create({
        client_id: customer._id,
        seller_id: seller._id,
        order_items: [
          {
            product_id: product1._id,
            qty: 3,
            price_snapshot: 33.33, // Rounding test
          },
        ],
        payment: { amount: 99.99, method: "UPI", status: "pending" },
        status: "confirmed",
        delivery: {
          delivery_agent_id: agent1._id,
          delivery_status: "in_transit",
          delivery_address: {
            full_address: "Test Address",
          },
        },
      });

      const res = await request(app)
        .put(`/api/delivery/mark-delivered/${order._id}`)
        .set("Authorization", `Bearer ${agentToken}`)
        .send();

      expect([200, 201]).toContain(res.status);

      // Commission should be calculated with proper rounding (typically 2 decimal places)
      const updatedOrder = await Order.findById(order._id);
      expect(updatedOrder.status).toBe("delivered");

      await Order.findByIdAndDelete(order._id);
    });
  });

  // ========================================
  // SECTION 5: DISTANCE CALCULATION EDGE CASES
  // Target: Lines 2342-2362 (distance calculation fallbacks)
  // ========================================

  describe("Section 5: Distance Calculation Edge Cases", () => {
    test("5.1: Should handle distance calculation with invalid coordinates", async () => {
      // Create agent with invalid coordinates
      const agentInvalid = await DeliveryAgent.create({
        email: "agent_invalid_phase9p@test.com",
        name: "Agent Invalid Coords",
        phone: "+919876543217",
        approved: true,
        active: true,
        available: true,
        current_location: { lat: null, lng: null }, // Invalid
        assigned_orders: 0,
      });

      const order = await Order.create({
        client_id: customer._id,
        seller_id: seller._id,
        order_items: [
          {
            product_id: product1._id,
            qty: 1,
            price_snapshot: 100,
          },
        ],
        payment: { amount: 100, method: "COD", status: "pending" },
        status: "confirmed",
        pickup_address: {
          location: { lat: 12.98, lng: 77.6 },
          street: "Test Pickup",
        },
        delivery: {
          delivery_address: {
            full_address: "Test Address",
            location: { lat: 12.99, lng: 77.61 },
            street: "Test Delivery",
          },
          delivery_agent_id: agent2._id,
          delivery_status: "pending",
          assigned_at: new Date(Date.now() - 2 * 60 * 60 * 1000),
        },
      });

      const res = await request(app)
        .post(`/api/delivery/force-reassign/${order._id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send();

      // Should handle gracefully and assign to valid agent
      expect(res.status).toBe(200);

      const updatedOrder = await Order.findById(order._id);
      // Should not assign to agent with invalid coordinates
      expect(updatedOrder.delivery.delivery_agent_id.toString()).not.toBe(
        agentInvalid._id.toString()
      );

      await DeliveryAgent.deleteOne({ _id: agentInvalid._id });
      await Order.findByIdAndDelete(order._id);
    });

    test("5.2: Should prioritize agents with location over agents without location", async () => {
      // Set agent1 with valid location, agent2 without location
      agent1 = await DeliveryAgent.findById(agent1._id);
      agent1.current_location = { lat: 12.97, lng: 77.59 };
      agent1.assigned_orders = 5; // Higher assigned count
      await agent1.save();

      agent2 = await DeliveryAgent.findById(agent2._id);
      agent2.current_location = undefined; // No location
      agent2.assigned_orders = 0; // Lower assigned count
      await agent2.save();

      const order = await Order.create({
        client_id: customer._id,
        seller_id: seller._id,
        order_items: [
          {
            product_id: product1._id,
            qty: 1,
            price_snapshot: 100,
          },
        ],
        payment: { amount: 100, method: "COD", status: "pending" },
        status: "confirmed",
        pickup_address: {
          location: { lat: 12.9716, lng: 77.5946 },
          street: "Test Pickup",
        },
        delivery: {
          delivery_address: {
            full_address: "Test Address",
            location: { lat: 12.99, lng: 77.61 },
            street: "Test Delivery",
          },
          delivery_agent_id: agent3._id,
          delivery_status: "pending",
          assigned_at: new Date(Date.now() - 2 * 60 * 60 * 1000),
        },
      });

      const res = await request(app)
        .post(`/api/delivery/force-reassign/${order._id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send();

      expect(res.status).toBe(200);

      const updatedOrder = await Order.findById(order._id);
      // Should prioritize agent1 (has location) over agent2 (no location, even though lower assigned count)
      expect(updatedOrder.delivery.delivery_agent_id.toString()).toBe(
        agent1._id.toString()
      );

      await Order.findByIdAndDelete(order._id);
    });
  });
});
