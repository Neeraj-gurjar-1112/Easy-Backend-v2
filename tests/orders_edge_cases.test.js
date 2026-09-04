const request = require("supertest");
const app = require("../app");
const {
  connectTestDB,
  closeTestDB,
  clearTestDB,
} = require("./testUtils/dbHandler");
const {
  generateMockClient,
  generateMockSeller,
  generateMockProduct,
  generateMockDeliveryAgent,
  generateJWT,
} = require("./testUtils/mockData");
const {
  Order,
  Client,
  Seller,
  Product,
  PlatformSettings,
  DeliveryAgent,
  EarningLog,
  UserAddress,
} = require("../lib/models");

describe("Orders Controller - Edge Cases & Advanced Features", () => {
  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    // Initialize platform settings with delivery charges
    await PlatformSettings.findOneAndUpdate(
      {},
      {
        $setOnInsert: {
          coupons: [],
          delivery_charge_grocery: 30,
          delivery_charge_food: 40,
          min_total_for_delivery_charge: 100,
          platform_commission_rate: 0.1,
          delivery_agent_share_rate: 0.8,
        },
      },
      { upsert: true, new: true }
    );
  });

  describe("PATCH /api/orders/:id/delivery - Status Transitions", () => {
    let mockClient, mockSeller, mockProduct, mockOrder;

    beforeEach(async () => {
      mockClient = await Client.create({
        ...generateMockClient(),
        firebase_uid: "test-client-uid-" + Date.now(),
      });
      mockSeller = await Seller.create(generateMockSeller());
      mockProduct = await Product.create({
        ...generateMockProduct(mockSeller._id),
        category: "Grocery",
      });

      // Create order
      mockOrder = await Order.create({
        client_id: mockClient.firebase_uid,
        seller_id: mockSeller._id,
        order_items: [
          {
            product_id: mockProduct._id,
            qty: 2,
            price_snapshot: 50,
            name_snapshot: mockProduct.name,
          },
        ],
        payment: {
          method: "COD",
          amount: 130, // 100 items + 30 delivery
          status: "pending",
        },
        delivery: {
          delivery_status: "pending",
          delivery_address: {
            full_address: "123 Test St, City",
            location: { type: "Point", coordinates: [0, 0] },
          },
        },
      });
    });

    test("should transition to 'dispatched' and set delivery_start_time", async () => {
      const response = await request(app)
        .patch(`/api/orders/${mockOrder._id}/delivery`)
        .send({ status: "dispatched" });

      expect(response.status).toBe(200);
      expect(response.body.delivery.delivery_status).toBe("dispatched");
      expect(response.body.delivery.delivery_start_time).toBeDefined();

      // Verify in database
      const updated = await Order.findById(mockOrder._id);
      expect(updated.delivery.delivery_status).toBe("dispatched");
      expect(updated.delivery.delivery_start_time).toBeInstanceOf(Date);
    });

    test("should calculate delivery charge on dispatch for grocery (30)", async () => {
      const response = await request(app)
        .patch(`/api/orders/${mockOrder._id}/delivery`)
        .send({ status: "dispatched" });

      expect(response.status).toBe(200);
      expect(response.body.delivery.delivery_charge).toBe(30); // grocery base
    });

    test("should calculate delivery charge on dispatch for food (40)", async () => {
      // Create food product
      const foodProduct = await Product.create({
        ...generateMockProduct(mockSeller._id),
        category: "Restaurant",
      });

      const foodOrder = await Order.create({
        client_id: mockClient.firebase_uid,
        seller_id: mockSeller._id,
        order_items: [
          {
            product_id: foodProduct._id,
            qty: 1,
            price_snapshot: 80,
            name_snapshot: foodProduct.name,
          },
        ],
        payment: { method: "COD", amount: 120, status: "pending" },
        delivery: {
          delivery_status: "pending",
          delivery_address: {
            full_address: "123 Test St",
            location: { type: "Point", coordinates: [0, 0] },
          },
        },
      });

      const response = await request(app)
        .patch(`/api/orders/${foodOrder._id}/delivery`)
        .send({ status: "dispatched" });

      expect(response.status).toBe(200);
      expect(response.body.delivery.delivery_charge).toBe(40); // food base
    });

    test("should waive delivery charge when subtotal exceeds threshold", async () => {
      // Create order with subtotal > 100 (threshold)
      const highValueOrder = await Order.create({
        client_id: mockClient.firebase_uid,
        seller_id: mockSeller._id,
        order_items: [
          {
            product_id: mockProduct._id,
            qty: 3,
            price_snapshot: 50,
            name_snapshot: mockProduct.name,
          },
        ],
        payment: { method: "COD", amount: 150, status: "pending" },
        delivery: {
          delivery_status: "pending",
          delivery_address: {
            full_address: "123 Test St",
            location: { type: "Point", coordinates: [0, 0] },
          },
        },
      });

      const response = await request(app)
        .patch(`/api/orders/${highValueOrder._id}/delivery`)
        .send({ status: "dispatched" });

      expect(response.status).toBe(200);
      expect(response.body.delivery.delivery_charge).toBe(0); // waived
    });

    test("should not recalculate delivery charge if already set", async () => {
      // Pre-set delivery charge
      mockOrder.delivery.delivery_charge = 25;
      await mockOrder.save();

      const response = await request(app)
        .patch(`/api/orders/${mockOrder._id}/delivery`)
        .send({ status: "dispatched" });

      expect(response.status).toBe(200);
      expect(response.body.delivery.delivery_charge).toBe(25); // preserved
    });

    test("should transition to 'delivered' and set delivery_end_time", async () => {
      const response = await request(app)
        .patch(`/api/orders/${mockOrder._id}/delivery`)
        .send({ status: "delivered" });

      expect(response.status).toBe(200);
      expect(response.body.delivery.delivery_status).toBe("delivered");
      expect(response.body.delivery.delivery_end_time).toBeDefined();

      const updated = await Order.findById(mockOrder._id);
      expect(updated.delivery.delivery_end_time).toBeInstanceOf(Date);
    });

    test("should increment agent completed_orders on delivery", async () => {
      const agent = await DeliveryAgent.create({
        ...generateMockDeliveryAgent(),
        completed_orders: 5,
        available: false,
      });

      mockOrder.delivery.delivery_agent_id = agent._id;
      await mockOrder.save();

      const response = await request(app)
        .patch(`/api/orders/${mockOrder._id}/delivery`)
        .send({ status: "delivered" });

      expect(response.status).toBe(200);

      // Verify agent updated
      const updatedAgent = await DeliveryAgent.findById(agent._id);
      expect(updatedAgent.completed_orders).toBe(6);
      expect(updatedAgent.available).toBe(true);
    });

    test("should create EarningLog entries on delivery (seller + agent)", async () => {
      const agent = await DeliveryAgent.create(generateMockDeliveryAgent());
      mockOrder.delivery.delivery_agent_id = agent._id;
      mockOrder.delivery.delivery_charge = 30;
      await mockOrder.save();

      const response = await request(app)
        .patch(`/api/orders/${mockOrder._id}/delivery`)
        .send({ status: "delivered" });

      expect(response.status).toBe(200);

      // Verify seller earning log
      const sellerLog = await EarningLog.findOne({
        role: "seller",
        order_id: mockOrder._id,
      });
      expect(sellerLog).toBeDefined();
      expect(sellerLog.item_total).toBe(100); // 2 * 50
      expect(sellerLog.platform_commission).toBe(10); // 10% of 100
      expect(sellerLog.net_earning).toBe(90);

      // Verify agent earning log
      const agentLog = await EarningLog.findOne({
        role: "delivery",
        order_id: mockOrder._id,
      });
      expect(agentLog).toBeDefined();
      expect(agentLog.delivery_charge).toBe(30);
      expect(agentLog.net_earning).toBe(24); // 80% of 30
    });

    test("should reject invalid delivery status", async () => {
      const response = await request(app)
        .patch(`/api/orders/${mockOrder._id}/delivery`)
        .send({ status: "invalid_status" });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain("Invalid delivery status");
    });

    test("should update delivery status independently without ETA", async () => {
      // Test that we can update just the status
      const response = await request(app)
        .patch(`/api/orders/${mockOrder._id}/delivery`)
        .send({ status: "dispatched" });

      expect(response.status).toBe(200);

      const updated = await Order.findById(mockOrder._id);
      expect(updated.delivery.delivery_status).toBe("dispatched");
      expect(updated.delivery.delivery_start_time).toBeDefined();
    });
  });

  describe("GET /api/orders/:id/admin-detail - Admin Analytics", () => {
    let mockClient, mockSeller, mockProduct, mockOrder;

    beforeEach(async () => {
      mockClient = await Client.create({
        ...generateMockClient(),
        firebase_uid: "test-client-uid-" + Date.now(),
      });
      mockSeller = await Seller.create(generateMockSeller());
      mockProduct = await Product.create(generateMockProduct(mockSeller._id));

      mockOrder = await Order.create({
        client_id: mockClient.firebase_uid,
        seller_id: mockSeller._id,
        order_items: [
          {
            product_id: mockProduct._id,
            qty: 2,
            price_snapshot: 50,
            name_snapshot: mockProduct.name,
          },
        ],
        payment: { method: "COD", amount: 130, status: "pending" },
        delivery: {
          delivery_status: "pending",
          delivery_charge: 30,
          delivery_address: {
            full_address: "123 Test St",
            location: { lat: 0, lng: 0 },
          },
        },
      });
    });

    test("should return admin detail with earnings breakdown", async () => {
      const response = await request(app).get(
        `/api/orders/${mockOrder._id}/admin-detail`
      );

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("order_id");
      expect(response.body).toHaveProperty("earnings_sellers");
      expect(response.body.earnings_sellers).toHaveLength(1);

      const sellerEarning = response.body.earnings_sellers[0];
      expect(sellerEarning.item_total).toBe(100);
      expect(sellerEarning.platform_commission).toBe(10);
      expect(sellerEarning.net_earning).toBe(90);
    });

    test("should calculate agent earnings when agent assigned", async () => {
      const agent = await DeliveryAgent.create(generateMockDeliveryAgent());
      mockOrder.delivery.delivery_agent_id = agent._id;
      await mockOrder.save();

      const response = await request(app).get(
        `/api/orders/${mockOrder._id}/admin-detail`
      );

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("earnings_agent");
      expect(response.body.earnings_agent.delivery_charge).toBe(30);
      expect(response.body.earnings_agent.net_earning).toBe(24); // 80% of 30
    });

    test("should return 404 for non-existent order", async () => {
      const response = await request(app).get(
        "/api/orders/507f1f77bcf86cd799439011/admin-detail"
      );

      expect(response.status).toBe(404);
      expect(response.body.message).toContain("Order not found");
    });

    test("should prefer EarningLog values when available (post-delivery)", async () => {
      // Create custom earning logs (simulating post-delivery state)
      await EarningLog.create({
        role: "seller",
        order_id: mockOrder._id,
        seller_id: mockSeller._id,
        item_total: 100,
        platform_commission: 15, // Custom value (15% instead of 10%)
        net_earning: 85,
        created_at: new Date(),
      });

      const response = await request(app).get(
        `/api/orders/${mockOrder._id}/admin-detail`
      );

      expect(response.status).toBe(200);
      expect(response.body.earnings_sellers[0].platform_commission).toBe(15); // From log, not computed
      expect(response.body.earnings_sellers[0].net_earning).toBe(85);
    });
  });

  describe("POST /api/orders/:orderId/cancel - Order Cancellation", () => {
    let mockClient, mockSeller, mockProduct, mockOrder, mockAgent;

    beforeEach(async () => {
      mockClient = await Client.create({
        ...generateMockClient(),
        firebase_uid: "test-client-uid-" + Date.now(),
      });
      mockSeller = await Seller.create(generateMockSeller());
      mockProduct = await Product.create(generateMockProduct(mockSeller._id));
      mockAgent = await DeliveryAgent.create({
        ...generateMockDeliveryAgent(),
        available: false,
        assigned_orders: 1,
      });

      mockOrder = await Order.create({
        client_id: mockClient.firebase_uid,
        seller_id: mockSeller._id,
        order_items: [
          {
            product_id: mockProduct._id,
            qty: 1,
            price_snapshot: 50,
            name_snapshot: mockProduct.name,
          },
        ],
        payment: { method: "COD", amount: 80, status: "pending" },
        delivery: {
          delivery_status: "pending",
          delivery_agent_id: mockAgent._id,
          delivery_address: {
            full_address: "123 Test St",
            location: { type: "Point", coordinates: [0, 0] },
          },
        },
      });
    });

    test("should cancel order successfully with reason", async () => {
      const response = await request(app)
        .post(`/api/orders/${mockOrder._id}/cancel`)
        .send({
          cancelled_by: mockClient.firebase_uid,
          cancellation_reason: "Changed my mind",
        });

      expect(response.status).toBe(200);
      expect(response.body.message).toContain("cancelled successfully");
      expect(response.body.order.status).toBe("cancelled");
      expect(response.body.order.cancelled_by).toBe(mockClient.firebase_uid);
      expect(response.body.order.cancellation_reason).toBe("Changed my mind");

      // Verify in database
      const updated = await Order.findById(mockOrder._id);
      expect(updated.status).toBe("cancelled");
      expect(updated.cancelled_at).toBeInstanceOf(Date);
    });

    test("should set agent to null properly when order created without agent", async () => {
      // This test checks that orders without agents can be cancelled without errors
      const orderWithoutAgent = await Order.create({
        client_id: mockClient.firebase_uid,
        seller_id: mockSeller._id,
        order_items: [
          {
            product_id: mockProduct._id,
            qty: 1,
            price_snapshot: 50,
            name_snapshot: mockProduct.name,
          },
        ],
        payment: { method: "COD", amount: 80, status: "pending" },
        delivery: {
          delivery_status: "pending",
          delivery_address: {
            full_address: "123 Test St",
            location: { type: "Point", coordinates: [0, 0] },
          },
        },
      });

      const response = await request(app)
        .post(`/api/orders/${orderWithoutAgent._id}/cancel`)
        .send({ cancelled_by: mockSeller._id });

      expect(response.status).toBe(200);
      expect(response.body.order.status).toBe("cancelled");
    });

    test("should reject cancellation without cancelled_by", async () => {
      const response = await request(app)
        .post(`/api/orders/${mockOrder._id}/cancel`)
        .send({ cancellation_reason: "Test" });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("cancelled_by is required");
    });

    test("should reject cancellation of already delivered order", async () => {
      mockOrder.status = "delivered";
      await mockOrder.save();

      const response = await request(app)
        .post(`/api/orders/${mockOrder._id}/cancel`)
        .send({ cancelled_by: mockClient.firebase_uid });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("Cannot cancel delivered orders");
    });

    test("should reject cancellation of already cancelled order", async () => {
      mockOrder.status = "cancelled";
      await mockOrder.save();

      const response = await request(app)
        .post(`/api/orders/${mockOrder._id}/cancel`)
        .send({ cancelled_by: mockClient.firebase_uid });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("already cancelled");
    });

    test("should provide default cancellation reason if not specified", async () => {
      const response = await request(app)
        .post(`/api/orders/${mockOrder._id}/cancel`)
        .send({ cancelled_by: mockClient.firebase_uid });

      expect(response.status).toBe(200);
      expect(response.body.order.cancellation_reason).toBe(
        "No reason provided"
      );
    });
  });

  describe("POST /api/orders/:id/verify - Payment Verification", () => {
    let mockClient, mockSeller, mockProduct, mockOrder;

    beforeEach(async () => {
      mockClient = await Client.create({
        ...generateMockClient(),
        firebase_uid: "test-client-uid-" + Date.now(),
      });
      mockSeller = await Seller.create(generateMockSeller());
      mockProduct = await Product.create(generateMockProduct(mockSeller._id));

      mockOrder = await Order.create({
        client_id: mockClient.firebase_uid,
        seller_id: mockSeller._id,
        order_items: [
          {
            product_id: mockProduct._id,
            qty: 1,
            price_snapshot: 50,
            name_snapshot: mockProduct.name,
          },
        ],
        payment: { method: "COD", amount: 80, status: "pending" },
        delivery: {
          delivery_status: "pending",
          delivery_address: {
            full_address: "123 Test St",
            location: { type: "Point", coordinates: [0, 0] },
          },
        },
      });
    });

    test("should verify payment and update status to 'paid'", async () => {
      const response = await request(app)
        .post(`/api/orders/${mockOrder._id}/verify`)
        .send({
          status: "paid",
          verified_by: "admin123",
          note: "Payment confirmed",
        });

      expect(response.status).toBe(200);
      expect(response.body.payment.status).toBe("paid");
      expect(response.body.payment.verified.by).toBe("admin123");
      expect(response.body.payment.verified.note).toBe("Payment confirmed");
    });

    test("should reject verification with invalid status", async () => {
      const response = await request(app)
        .post(`/api/orders/${mockOrder._id}/verify`)
        .send({ status: "invalid_status", verified_by: "admin789" });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain("Invalid status");
    });

    test("should mark payment as failed when status is 'failed'", async () => {
      const response = await request(app)
        .post(`/api/orders/${mockOrder._id}/verify`)
        .send({
          status: "failed",
          verified_by: "admin456",
          note: "Payment rejected",
        });

      expect(response.status).toBe(200);
      expect(response.body.payment.status).toBe("failed");
      expect(response.body.payment.verified.note).toBe("Payment rejected");
    });
  });
});
