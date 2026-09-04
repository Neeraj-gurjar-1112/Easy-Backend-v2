const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../app");
const {
  Order,
  DeliveryAgent,
  Seller,
  Product,
  PlatformSettings,
  Client,
  EarningLog,
} = require("../lib/models");

// Mock Firebase Admin
jest.mock("firebase-admin", () => ({
  apps: [{ name: "mock" }],
  auth: () => ({
    verifyIdToken: jest.fn().mockResolvedValue({
      uid: "test-uid",
      email: "test@example.com",
    }),
  }),
}));

// Mock geocoding service
jest.mock("../lib/util/geocode", () => ({
  reverseGeocode: jest.fn().mockResolvedValue("123 Test St, City"),
  placeDetails: jest.fn().mockResolvedValue("Store Location from Place ID"),
  ENABLED: true,
}));

// Mock SSE/push services
jest.mock("../lib/events/orderEvents", () => ({
  publish: jest.fn(),
  publishToSeller: jest.fn(),
}));
jest.mock("../lib/push", () => ({
  notifyOrderUpdate: jest.fn(),
}));

describe("Phase 21.6: Delivery.js Branch Coverage Tests", () => {
  let mongoServer;

  beforeAll(async () => {
    // Setup test database
    await mongoose.disconnect();
    const { MongoMemoryServer } = require("mongodb-memory-server");
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  beforeEach(async () => {
    // Clear all collections
    await Order.deleteMany({});
    await DeliveryAgent.deleteMany({});
    await Seller.deleteMany({});
    await Product.deleteMany({});
    await Client.deleteMany({});
    await EarningLog.deleteMany({});

    // Reset mocks
    jest.clearAllMocks();
  });

  // ==========================================================================
  // BATCH 1: Pending Orders Branch Coverage
  // Target: Lines 154-223 (kindsSet logic, seller fallback, geocoding branches)
  // ==========================================================================
  describe("Phase 21.6: Pending Orders - Branch Coverage", () => {
    it("Lines 154-174: should derive kinds from product category (vegetables)", async () => {
      // Create seller
      const seller = await Seller.create({
        business_name: "Test Store",
        email: "teststore@example.com",
        phone: "1234567890",
        address: "Store Address",
        location: { lat: 40.7128, lng: -74.006 },
        business_type: "grocery",
      });

      // Create product with vegetable category
      const product = await Product.create({
        name: "Test Vegetable",
        category: "Fresh Vegetables",
        seller_id: seller._id,
        price: 50,
        stock: 10,
      });

      // Create agent
      const agent = await DeliveryAgent.create({
        name: "Test Agent",
        phone: "9876543210",
        email: "agent1@example.com",
        approved: true,
        active: true,
        available: true,
      });

      // Create order with vegetable item
      await Order.create({
        client_id: new mongoose.Types.ObjectId(),
        seller_id: seller._id,
        order_items: [
          {
            product_id: product._id,
            qty: 2,
            price_snapshot: 50,
            category: "Fresh Vegetables",
          },
        ],
        delivery: {
          delivery_address: {
            full_address: "123 Test St",
            location: { lat: 40.7, lng: -74.0 },
          },
          delivery_status: "pending",
        },
        payment: {
          status: "paid",
          method: "COD",
          amount: 100,
        },
      });

      // Request pending orders
      const res = await request(app)
        .get(`/api/delivery/pending-orders/${agent._id}`)
        .set("Authorization", "Bearer mockToken");

      expect(res.status).toBe(200);
      expect(res.body.orders).toHaveLength(1);
      expect(res.body.orders[0].kinds).toContain("vegetables");
      // Lines 154-158: product category check, kindsSet.add("vegetables")
    });

    it("Lines 158-160: should derive kinds from product category (grocery)", async () => {
      const seller = await Seller.create({
        business_name: "Grocery Store",
        email: "grocery@example.com",
        phone: "1234567890",
        address: "Store Address",
        business_type: "grocery",
      });

      const product = await Product.create({
        name: "Grocery Item",
        category: "Grocery Essentials",
        seller_id: seller._id,
        price: 30,
        stock: 10,
      });

      const agent = await DeliveryAgent.create({
        name: "Agent",
        phone: "9876543210",
        email: "agent2@example.com",
        approved: true,
        active: true,
        available: true,
      });

      await Order.create({
        client_id: new mongoose.Types.ObjectId(),
        seller_id: seller._id,
        order_items: [
          {
            product_id: product._id,
            qty: 1,
            price_snapshot: 30,
            category: "Grocery Essentials",
          },
        ],
        delivery: {
          delivery_address: {
            full_address: "123 Test St",
            location: { lat: 40.7, lng: -74.0 },
          },
          delivery_status: "pending",
        },
        payment: {
          status: "paid",
          method: "COD",
          amount: 30,
        },
      });

      const res = await request(app)
        .get(`/api/delivery/pending-orders/${agent._id}`)
        .set("Authorization", "Bearer mockToken");

      expect(res.status).toBe(200);
      expect(res.body.orders).toHaveLength(1);
      expect(res.body.orders[0].kinds).toContain("grocery");
      // Lines 158-160: category includes "grocery" → kindsSet.add("grocery")
    });

    it("Lines 161-163: should derive kinds from product category (food/restaurant)", async () => {
      const seller = await Seller.create({
        business_name: "Restaurant",
        email: "restaurant@example.com",
        phone: "1234567890",
        business_type: "restaurant",
      });

      const product = await Product.create({
        name: "Pizza",
        category: "Restaurant Food",
        seller_id: seller._id,
        price: 150,
        stock: 10,
      });

      const agent = await DeliveryAgent.create({
        name: "Agent",
        phone: "9876543210",
        email: "agent3@example.com",
        approved: true,
        active: true,
        available: true,
      });

      await Order.create({
        client_id: new mongoose.Types.ObjectId(),
        seller_id: seller._id,
        order_items: [
          {
            product_id: product._id,
            qty: 1,
            price_snapshot: 150,
            category: "Restaurant Food",
          },
        ],
        delivery: {
          delivery_address: {
            full_address: "123 Test St",
            location: { lat: 40.7, lng: -74.0 },
          },
          delivery_status: "pending",
        },
        payment: {
          status: "paid",
          method: "COD",
          amount: 150,
        },
      });

      const res = await request(app)
        .get(`/api/delivery/pending-orders/${agent._id}`)
        .set("Authorization", "Bearer mockToken");

      expect(res.status).toBe(200);
      expect(res.body.orders).toHaveLength(1);
      expect(res.body.orders[0].kinds).toContain("food");
      // Lines 161-163: category includes "food" or "restaurant" → kindsSet.add("food")
    });

    it("Lines 165-174: should fallback to business_type when kindsSet empty", async () => {
      const seller = await Seller.create({
        business_name: "Store",
        email: "store@example.com",
        phone: "1234567890",
        business_type: "grocery",
      });

      const product = await Product.create({
        name: "Item",
        category: "Electronics", // Not in kindsSet categories
        seller_id: seller._id,
        price: 100,
        stock: 10,
      });

      const agent = await DeliveryAgent.create({
        name: "Agent",
        phone: "9876543210",
        email: "agent4@example.com",
        approved: true,
        active: true,
        available: true,
      });

      await Order.create({
        client_id: new mongoose.Types.ObjectId(),
        seller_id: seller._id,
        order_items: [
          {
            product_id: product._id,
            qty: 1,
            price_snapshot: 100,
            category: "Electronics",
          },
        ],
        delivery: {
          delivery_address: {
            full_address: "123 Test St",
            location: { lat: 40.7, lng: -74.0 },
          },
          delivery_status: "pending",
        },
        payment: {
          status: "paid",
          method: "COD",
          amount: 100,
        },
      });

      const res = await request(app)
        .get(`/api/delivery/pending-orders/${agent._id}`)
        .set("Authorization", "Bearer mockToken");

      expect(res.status).toBe(200);
      expect(res.body.orders).toHaveLength(1);
      expect(res.body.orders[0].kinds).toContain("grocery");
      // Lines 165-174: kindsSet empty → fallback to seller.business_type
    });

    it("Lines 169-172: should use business_type with 'restaurant' keyword", async () => {
      const seller = await Seller.create({
        business_name: "Restaurant",
        email: "finedining@example.com",
        phone: "1234567890",
        business_type: "restaurant",
      });

      const product = await Product.create({
        name: "Item",
        category: "Other", // Not recognized
        seller_id: seller._id,
        price: 100,
        stock: 10,
      });

      const agent = await DeliveryAgent.create({
        name: "Agent",
        phone: "9876543210",
        email: "agent5@example.com",
        approved: true,
        active: true,
        available: true,
      });

      await Order.create({
        client_id: new mongoose.Types.ObjectId(),
        seller_id: seller._id,
        order_items: [
          {
            product_id: product._id,
            qty: 1,
            price_snapshot: 100,
            category: "Other",
          },
        ],
        delivery: {
          delivery_address: {
            full_address: "123 Test St",
            location: { lat: 40.7, lng: -74.0 },
          },
          delivery_status: "pending",
        },
        payment: {
          status: "paid",
          method: "COD",
          amount: 100,
        },
      });

      const res = await request(app)
        .get(`/api/delivery/pending-orders/${agent._id}`)
        .set("Authorization", "Bearer mockToken");

      expect(res.status).toBe(200);
      expect(res.body.orders).toHaveLength(1);
      expect(res.body.orders[0].kinds).toContain("food");
      // Lines 169-172: business_type includes "restaurant" → add "food"
    });

    it("Lines 182-189: should use fallback seller from product when order.seller_id missing", async () => {
      const seller = await Seller.create({
        business_name: "Test Seller",
        email: "testseller@example.com",
        phone: "1234567890",
        address: "Seller Address",
        business_type: "grocery",
      });

      const product = await Product.create({
        name: "Product",
        category: "Grocery",
        seller_id: seller._id,
        price: 50,
        stock: 10,
      });

      const agent = await DeliveryAgent.create({
        name: "Agent",
        phone: "9876543210",
        email: "agent6@example.com",
        approved: true,
        active: true,
        available: true,
      });

      await Order.create({
        client_id: new mongoose.Types.ObjectId(),
        // NOTE: seller_id intentionally omitted to test fallback
        order_items: [
          {
            product_id: product._id,
            qty: 1,
            price_snapshot: 50,
            category: "Grocery",
          },
        ],
        delivery: {
          delivery_address: {
            full_address: "123 Test St",
            location: { lat: 40.7, lng: -74.0 },
          },
          delivery_status: "pending",
        },
        payment: {
          status: "paid",
          method: "COD",
          amount: 50,
        },
      });

      const res = await request(app)
        .get(`/api/delivery/pending-orders/${agent._id}`)
        .set("Authorization", "Bearer mockToken");

      expect(res.status).toBe(200);
      expect(res.body.orders).toHaveLength(1);
      // Lines 182-189: order.seller_id null → use product.seller_id
    });

    it("Lines 197-223: should use place_id geocoding when available", async () => {
      const { placeDetails } = require("../lib/util/geocode");
      placeDetails.mockResolvedValueOnce("Place ID Address Result");

      const seller = await Seller.create({
        business_name: "Seller",
        email: "seller1@example.com",
        phone: "1234567890",
        place_id: "ChIJ_test_place_id",
        location: { lat: 40.7, lng: -74.0 },
        business_type: "grocery",
      });

      const product = await Product.create({
        name: "Product",
        category: "Grocery",
        seller_id: seller._id,
        price: 50,
        stock: 10,
      });

      const agent = await DeliveryAgent.create({
        name: "Agent",
        phone: "9876543210",
        email: "agent7@example.com",
        approved: true,
        active: true,
        available: true,
      });

      await Order.create({
        client_id: new mongoose.Types.ObjectId(),
        seller_id: seller._id,
        order_items: [
          {
            product_id: product._id,
            qty: 1,
            price_snapshot: 50,
            category: "Grocery",
          },
        ],
        delivery: {
          delivery_address: {
            full_address: "123 Test St",
            location: { lat: 40.7, lng: -74.0 },
          },
          delivery_status: "pending",
        },
        payment: {
          status: "paid",
          method: "COD",
          amount: 50,
        },
      });

      const res = await request(app)
        .get(`/api/delivery/pending-orders/${agent._id}`)
        .set("Authorization", "Bearer mockToken");

      expect(res.status).toBe(200);
      expect(placeDetails).toHaveBeenCalledWith("ChIJ_test_place_id");
      // Lines 197-223: seller.place_id exists → call placeDetails
    });

    it("Lines 206-218: should use reverseGeocode when no place_id but has location", async () => {
      const { reverseGeocode, placeDetails } = require("../lib/util/geocode");
      placeDetails.mockResolvedValueOnce(null); // No place_id result
      reverseGeocode.mockResolvedValueOnce("Reverse Geocoded Address");

      const seller = await Seller.create({
        business_name: "Seller",
        email: "seller2@example.com",
        phone: "1234567890",
        // NO place_id
        location: { lat: 40.7128, lng: -74.006 },
        business_type: "grocery",
      });

      const product = await Product.create({
        name: "Product",
        category: "Grocery",
        seller_id: seller._id,
        price: 50,
        stock: 10,
      });

      const agent = await DeliveryAgent.create({
        name: "Agent",
        phone: "9876543210",
        email: "agent8@example.com",
        approved: true,
        active: true,
        available: true,
      });

      await Order.create({
        client_id: new mongoose.Types.ObjectId(),
        seller_id: seller._id,
        order_items: [
          {
            product_id: product._id,
            qty: 1,
            price_snapshot: 50,
            category: "Grocery",
          },
        ],
        delivery: {
          delivery_address: {
            full_address: "123 Test St",
            location: { lat: 40.7, lng: -74.0 },
          },
          delivery_status: "pending",
        },
        payment: {
          status: "paid",
          method: "COD",
          amount: 50,
        },
      });

      const res = await request(app)
        .get(`/api/delivery/pending-orders/${agent._id}`)
        .set("Authorization", "Bearer mockToken");

      expect(res.status).toBe(200);
      expect(reverseGeocode).toHaveBeenCalledWith(40.7128, -74.006);
      // Lines 206-218: no place_id but has location → reverseGeocode
    });

    it("Lines 220-223: should use coordinate fallback when geocoding disabled", async () => {
      // Temporarily disable geocoding
      jest.mock("../lib/util/geocode", () => ({
        reverseGeocode: jest.fn(),
        placeDetails: jest.fn(),
        ENABLED: false, // DISABLED
      }));

      const seller = await Seller.create({
        business_name: "Seller",
        email: "seller3@example.com",
        phone: "1234567890",
        location: { lat: 40.7128, lng: -74.006 },
        business_type: "grocery",
      });

      const product = await Product.create({
        name: "Product",
        category: "Grocery",
        seller_id: seller._id,
        price: 50,
        stock: 10,
      });

      const agent = await DeliveryAgent.create({
        name: "Agent",
        phone: "9876543210",
        email: "agent9@example.com",
        approved: true,
        active: true,
        available: true,
      });

      await Order.create({
        client_id: new mongoose.Types.ObjectId(),
        seller_id: seller._id,
        order_items: [
          {
            product_id: product._id,
            qty: 1,
            price_snapshot: 50,
            category: "Grocery",
          },
        ],
        delivery: {
          delivery_address: {
            full_address: "123 Test St",
            location: { lat: 40.7, lng: -74.0 },
          },
          delivery_status: "pending",
        },
        payment: {
          status: "paid",
          method: "COD",
          amount: 50,
        },
      });

      const res = await request(app)
        .get(`/api/delivery/pending-orders/${agent._id}`)
        .set("Authorization", "Bearer mockToken");

      expect(res.status).toBe(200);
      expect(res.body.orders).toHaveLength(1);
      // Lines 220-223: ENABLED=false → use coordinates as fallback
    });
  });

  // ==========================================================================
  // BATCH 2: Retry Pending Orders Branch Coverage
  // Target: Lines 2460-2730 (early returns, capacity, cooldown, distance selection)
  // ==========================================================================
  describe("Phase 21.6: Retry Pending Orders - Branch Coverage", () => {
    it("Lines 2460-2470: should return early when no pending orders", async () => {
      // No orders created - empty database
      const res = await request(app)
        .post("/api/delivery/retry-pending-orders")
        .set("Authorization", "Bearer mockToken");

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("No pending orders to retry");
      // Lines 2460-2470: pendingOrders.length === 0 → early return
    });

    it("Lines 2480-2490: should return early when no agents available", async () => {
      const seller = await Seller.create({
        business_name: "Store",
        email: "store1@example.com",
        phone: "1234567890",
        location: { lat: 40.7, lng: -74.0 },
        business_type: "grocery",
      });

      // Create pending order
      await Order.create({
        client_id: new mongoose.Types.ObjectId(),
        seller_id: seller._id,
        order_items: [
          {
            product_id: new mongoose.Types.ObjectId(),
            qty: 1,
            price_snapshot: 50,
          },
        ],
        delivery: {
          delivery_address: {
            full_address: "123 Test St",
            location: { lat: 40.7, lng: -74.0 },
          },
          delivery_status: "pending",
        },
        payment: {
          status: "paid",
          method: "COD",
          amount: 50,
        },
      });

      // NO agents created
      const res = await request(app)
        .post("/api/delivery/retry-pending-orders")
        .set("Authorization", "Bearer mockToken");

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("No agents available");
      // Lines 2480-2490: early return when allAgents === 0
    });

    it("Lines 2600-2608: should skip orders when all agents at capacity", async () => {
      const seller = await Seller.create({
        business_name: "Store",
        email: "store2@example.com",
        phone: "1234567890",
        location: { lat: 40.7, lng: -74.0 },
        business_type: "grocery",
      });

      const agent = await DeliveryAgent.create({
        name: "Agent",
        phone: "9876543210",
        email: "agent10@example.com",
        approved: true,
        active: true,
        available: true,
        current_location: { lat: 40.71, lng: -74.01 },
      });

      // Create 3 active orders (MAX capacity)
      for (let i = 0; i < 3; i++) {
        await Order.create({
          client_id: new mongoose.Types.ObjectId(),
          seller_id: seller._id,
          order_items: [
            {
              product_id: new mongoose.Types.ObjectId(),
              qty: 1,
              price_snapshot: 50,
            },
          ],
          delivery: {
            delivery_address: {
              full_address: "123 Test St",
              location: { lat: 40.7, lng: -74.0 },
            },
            delivery_status: "assigned",
            delivery_agent_id: agent._id,
          },
          payment: {
            status: "paid",
            method: "COD",
            amount: 50,
          },
        });
      }

      // Create pending order (should be skipped - agent at capacity)
      await Order.create({
        client_id: new mongoose.Types.ObjectId(),
        seller_id: seller._id,
        order_items: [
          {
            product_id: new mongoose.Types.ObjectId(),
            qty: 1,
            price_snapshot: 50,
          },
        ],
        delivery: {
          delivery_address: {
            full_address: "123 Test St",
            location: { lat: 40.7, lng: -74.0 },
          },
          delivery_status: "pending",
        },
        payment: {
          status: "paid",
          method: "COD",
          amount: 50,
        },
      });

      const res = await request(app)
        .post("/api/delivery/retry-pending-orders")
        .set("Authorization", "Bearer mockToken");

      expect(res.status).toBe(200);
      expect(res.body.skipped).toBe(1); // Order skipped (agent at capacity)
      // Lines 2600-2608: skip when availableAgentsWithCapacity.length === 0
    });

    it("Lines 2625-2638: should skip agents within cooldown period", async () => {
      const seller = await Seller.create({
        business_name: "Store",
        email: "store3@example.com",
        phone: "1234567890",
        location: { lat: 40.7, lng: -74.0 },
        business_type: "grocery",
      });

      const agent = await DeliveryAgent.create({
        name: "Agent",
        phone: "9876543210",
        email: "agent11@example.com",
        approved: true,
        active: true,
        available: true,
        current_location: { lat: 40.71, lng: -74.01 },
      });

      // Create pending order with recent retry (within cooldown)
      const recentTime = new Date(Date.now() - 3 * 60 * 1000); // 3 minutes ago (within 5 min cooldown)
      await Order.create({
        client_id: new mongoose.Types.ObjectId(),
        seller_id: seller._id,
        order_items: [
          {
            product_id: new mongoose.Types.ObjectId(),
            qty: 1,
            price_snapshot: 50,
          },
        ],
        delivery: {
          delivery_address: {
            full_address: "123 Test St",
            location: { lat: 40.7, lng: -74.0 },
          },
          delivery_status: "pending",
          assignment_history: [
            {
              agent_id: agent._id,
              assigned_at: recentTime,
              rejected: false,
            },
          ],
        },
        payment: {
          status: "paid",
          method: "COD",
          amount: 50,
        },
      });

      const res = await request(app)
        .post("/api/delivery/retry-pending-orders")
        .set("Authorization", "Bearer mockToken");

      expect(res.status).toBe(200);
      expect(res.body.skipped).toBe(1); // Agent in cooldown
      // Lines 2625-2638: filter out recently-tried agents
    });

    it("Lines 2645-2665: should select nearest agent by distance calculation", async () => {
      const seller = await Seller.create({
        business_name: "Store",
        email: "store4@example.com",
        phone: "1234567890",
        location: { lat: 40.7, lng: -74.0 },
        business_type: "grocery",
      });

      // Create 2 agents at different distances
      const nearAgent = await DeliveryAgent.create({
        name: "Near Agent",
        phone: "1111111111",
        email: "near.agent@example.com",
        approved: true,
        active: true,
        available: true,
        current_location: { lat: 40.71, lng: -74.01 }, // NEAR (0.015 degrees away)
      });

      const farAgent = await DeliveryAgent.create({
        name: "Far Agent",
        phone: "2222222222",
        email: "far.agent@example.com",
        approved: true,
        active: true,
        available: true,
        current_location: { lat: 40.75, lng: -74.05 }, // FAR (0.06 degrees away)
      });

      await Order.create({
        client_id: new mongoose.Types.ObjectId(),
        seller_id: seller._id,
        order_items: [
          {
            product_id: new mongoose.Types.ObjectId(),
            qty: 1,
            price_snapshot: 50,
          },
        ],
        delivery: {
          delivery_address: {
            full_address: "123 Test St",
            location: { lat: 40.7, lng: -74.0 }, // Order at seller location
          },
          delivery_status: "pending",
        },
        payment: {
          status: "paid",
          method: "COD",
          amount: 50,
        },
      });

      const res = await request(app)
        .post("/api/delivery/retry-pending-orders")
        .set("Authorization", "Bearer mockToken");

      expect(res.status).toBe(200);
      expect(res.body.assigned).toBe(1);

      // Verify nearest agent was selected
      const updatedOrder = await Order.findOne();
      expect(updatedOrder.delivery.delivery_agent_id.toString()).toBe(
        nearAgent._id.toString()
      );
      // Lines 2645-2665: nearest agent selection by distance
    });

    it("Lines 2667-2672: should fallback to least-assigned agent when no location", async () => {
      const seller = await Seller.create({
        business_name: "Store",
        email: "store5@example.com",
        phone: "1234567890",
        business_type: "grocery",
        // NO location
      });

      const busyAgent = await DeliveryAgent.create({
        name: "Busy Agent",
        phone: "1111111111",
        email: "busy.agent@example.com",
        approved: true,
        active: true,
        available: true,
        assigned_orders: 2, // Has 2 active orders
      });

      const freeAgent = await DeliveryAgent.create({
        name: "Free Agent",
        phone: "2222222222",
        email: "free.agent@example.com",
        approved: true,
        active: true,
        available: true,
        assigned_orders: 0, // Has 0 orders
      });

      // busyAgent has 2 orders
      for (let i = 0; i < 2; i++) {
        await Order.create({
          client_id: new mongoose.Types.ObjectId(),
          seller_id: seller._id,
          order_items: [
            {
              product_id: new mongoose.Types.ObjectId(),
              qty: 1,
              price_snapshot: 50,
            },
          ],
          delivery: {
            delivery_address: {
              full_address: "123 Test St",
              location: { lat: 40.7, lng: -74.0 },
            },
            delivery_status: "assigned",
            delivery_agent_id: busyAgent._id,
          },
          payment: {
            status: "paid",
            method: "COD",
            amount: 50,
          },
        });
      }

      // Pending order (should go to freeAgent - least assigned)
      await Order.create({
        client_id: new mongoose.Types.ObjectId(),
        seller_id: seller._id,
        order_items: [
          {
            product_id: new mongoose.Types.ObjectId(),
            qty: 1,
            price_snapshot: 50,
          },
        ],
        delivery: {
          delivery_address: {
            full_address: "123 Test St",
            location: { lat: 40.7, lng: -74.0 },
          },
          delivery_status: "pending",
        },
        payment: {
          status: "paid",
          method: "COD",
          amount: 50,
        },
      });

      const res = await request(app)
        .post("/api/delivery/retry-pending-orders")
        .set("Authorization", "Bearer mockToken");

      expect(res.status).toBe(200);
      expect(res.body.assigned).toBe(1);

      // Verify least-assigned agent selected (find the order that was just assigned)
      const allOrders = await Order.find({}).sort({ created_at: 1 });
      const pendingOrder = allOrders[allOrders.length - 1]; // Last created order (was pending)
      expect(pendingOrder.delivery.delivery_agent_id.toString()).toBe(
        freeAgent._id.toString()
      );
      // Lines 2667-2672: least-assigned fallback when no location
    });
  });
});
