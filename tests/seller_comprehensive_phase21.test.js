const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../app");
const {
  Seller,
  Product,
  Order,
  Client,
  DeliveryAgent,
} = require("../lib/models");
const { setupTestDB, cleanupTestDB } = require("./testUtils/dbHandler");

describe("Seller Routes - Phase 21.4: Error Paths & Edge Cases", () => {
  let testSeller, testProduct, testClient;

  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await cleanupTestDB();
  });

  beforeEach(async () => {
    // Create test seller
    testSeller = await Seller.create({
      business_name: "Test Store Phase 21.4",
      email: `seller${Date.now()}@test.com`,
      phone: `987${Date.now()}${Math.floor(Math.random() * 1000)}`,
      password: "password123",
      business_type: "grocery",
      approved: true,
      is_open: true,
    });

    // Create test product
    testProduct = await Product.create({
      seller_id: testSeller._id,
      name: "Test Product Phase 21.4",
      category: "Grocery",
      price: 100,
      stock: 50,
      status: "active",
    });

    // Create test client
    testClient = await Client.create({
      name: "Test Client Phase 21.4",
      phone: `555${Date.now()}${Math.floor(Math.random() * 1000)}`,
      firebase_uid: `firebase_${Date.now()}`,
    });
  });

  afterEach(async () => {
    await Order.deleteMany({});
    await Product.deleteMany({});
    await Seller.deleteMany({});
    await Client.deleteMany({});
    await DeliveryAgent.deleteMany({});
  });

  // ========================================
  // Section 1: POST /toggle-open Error Paths
  // ========================================
  describe("POST /api/seller/toggle-open - Error Handling", () => {
    test("should handle database error when updating seller", async () => {
      // Mock findByIdAndUpdate to throw error
      jest
        .spyOn(Seller, "findByIdAndUpdate")
        .mockRejectedValueOnce(new Error("Database error"));

      const response = await request(app)
        .post("/api/seller/toggle-open")
        .set("x-seller-id", testSeller._id.toString())
        .send({ open: true });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe("failed to update open state");

      // Restore original
      Seller.findByIdAndUpdate.mockRestore();
    });
  });

  // ========================================
  // Section 2: POST /products Error Paths
  // ========================================
  describe("POST /api/seller/products - Error Handling", () => {
    test("should handle database error during product creation", async () => {
      // Mock Product.create to throw error
      jest
        .spyOn(Product, "create")
        .mockRejectedValueOnce(new Error("Database error"));

      const response = await request(app)
        .post("/api/seller/products")
        .set("x-seller-id", testSeller._id.toString())
        .send({
          name: "New Product",
          category: "Grocery",
          price: 150,
          stock: 100,
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe("failed to create product");

      // Restore original
      Product.create.mockRestore();
    });
  });

  // ========================================
  // Section 3: PUT /products/:id Error Paths
  // ========================================
  describe("PUT /api/seller/products/:id - Error Handling", () => {
    test("should handle database error during product update", async () => {
      // Mock findOneAndUpdate to throw error
      jest
        .spyOn(Product, "findOneAndUpdate")
        .mockRejectedValueOnce(new Error("Database error"));

      const response = await request(app)
        .put(`/api/seller/products/${testProduct._id}`)
        .set("x-seller-id", testSeller._id.toString())
        .send({
          name: "Updated Product",
          price: 200,
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe("failed to update product");

      // Restore original
      Product.findOneAndUpdate.mockRestore();
    });
  });

  // ========================================
  // Section 4: PATCH /products/:id Error Paths
  // ========================================
  describe("PATCH /api/seller/products/:id - Error Handling", () => {
    test("should handle database error during product patch", async () => {
      // Mock findOneAndUpdate to throw error
      jest
        .spyOn(Product, "findOneAndUpdate")
        .mockRejectedValueOnce(new Error("Database error"));

      const response = await request(app)
        .patch(`/api/seller/products/${testProduct._id}`)
        .set("x-seller-id", testSeller._id.toString())
        .send({ price: 150 });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe("failed to patch product");

      // Restore original
      Product.findOneAndUpdate.mockRestore();
    });
  });

  // ========================================
  // Section 5: DELETE /products/:id Error Paths
  // ========================================
  describe("DELETE /api/seller/products/:id - Error Handling", () => {
    test("should handle database error during soft delete", async () => {
      // Mock findOneAndUpdate to throw error
      jest
        .spyOn(Product, "findOneAndUpdate")
        .mockRejectedValueOnce(new Error("Database error"));

      const response = await request(app)
        .delete(`/api/seller/products/${testProduct._id}`)
        .set("x-seller-id", testSeller._id.toString());

      expect(response.status).toBe(500);
      expect(response.body.error).toBe("failed to delete product");

      // Restore original
      Product.findOneAndUpdate.mockRestore();
    });

    test("should handle database error during permanent delete", async () => {
      // Mock findOneAndDelete to throw error
      jest
        .spyOn(Product, "findOneAndDelete")
        .mockRejectedValueOnce(new Error("Database error"));

      const response = await request(app)
        .delete(`/api/seller/products/${testProduct._id}?permanent=true`)
        .set("x-seller-id", testSeller._id.toString());

      expect(response.status).toBe(500);
      expect(response.body.error).toBe("failed to delete product");

      // Restore original
      Product.findOneAndDelete.mockRestore();
    });
  });

  // ========================================
  // Section 6: GET /products Error Paths
  // ========================================
  describe("GET /api/seller/products - Error Handling", () => {
    test("should handle database error when listing products", async () => {
      // Mock find to throw error
      jest.spyOn(Product, "find").mockReturnValueOnce({
        lean: jest.fn().mockRejectedValueOnce(new Error("Database error")),
      });

      const response = await request(app)
        .get("/api/seller/products")
        .set("x-seller-id", testSeller._id.toString());

      expect(response.status).toBe(500);
      expect(response.body.error).toBe("failed to list products");

      // Restore original
      Product.find.mockRestore();
    });
  });

  // ========================================
  // Section 7: GET /orders Error Paths
  // ========================================
  describe("GET /api/seller/orders - Error Handling", () => {
    test("should handle database error during order aggregation", async () => {
      // Mock aggregate to throw error
      jest
        .spyOn(Order, "aggregate")
        .mockRejectedValueOnce(new Error("Database error"));

      const response = await request(app)
        .get("/api/seller/orders")
        .set("x-seller-id", testSeller._id.toString());

      expect(response.status).toBe(500);
      expect(response.body.error).toBe("failed to list seller orders");

      // Restore original
      Order.aggregate.mockRestore();
    });
  });

  // ========================================
  // Section 8: GET /orders/pending Error Paths
  // ========================================
  describe("GET /api/seller/orders/pending - Error Handling", () => {
    test("should handle database error during pending orders aggregation", async () => {
      // Mock aggregate to throw error
      jest
        .spyOn(Order, "aggregate")
        .mockRejectedValueOnce(new Error("Database error"));

      const response = await request(app)
        .get("/api/seller/orders/pending")
        .set("x-seller-id", testSeller._id.toString());

      expect(response.status).toBe(500);
      expect(response.body.error).toBe("Failed to fetch pending orders");

      // Restore original
      Order.aggregate.mockRestore();
    });
  });

  // ========================================
  // Section 9: GET /orders/:id Error Paths
  // ========================================
  describe("GET /api/seller/orders/:id - Error Handling", () => {
    test("should return 400 for invalid order ID", async () => {
      const response = await request(app)
        .get("/api/seller/orders/invalid-id")
        .set("x-seller-id", testSeller._id.toString());

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Invalid order ID");
    });

    test("should return 404 for non-existent order", async () => {
      const fakeOrderId = new mongoose.Types.ObjectId();

      const response = await request(app)
        .get(`/api/seller/orders/${fakeOrderId}`)
        .set("x-seller-id", testSeller._id.toString());

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("Order not found");
    });

    test("should return 403 when order has no items", async () => {
      // Create order with no items
      const emptyOrder = await Order.create({
        client_id: testClient._id,
        order_items: [],
        payment: {
          method: "COD",
          status: "pending",
          amount: 0,
        },
        delivery: {
          delivery_address: {
            full_address: "123 Test St",
            latitude: 0,
            longitude: 0,
          },
          delivery_status: "pending",
        },
      });

      const response = await request(app)
        .get(`/api/seller/orders/${emptyOrder._id}`)
        .set("x-seller-id", testSeller._id.toString());

      expect(response.status).toBe(403);
      expect(response.body.error).toBe(
        "Order has no items to validate for seller"
      );

      await Order.findByIdAndDelete(emptyOrder._id);
    });

    test("should return 403 when order does not include seller items", async () => {
      // Create another seller
      const otherSeller = await Seller.create({
        business_name: "Other Store",
        email: `other${Date.now()}@test.com`,
        phone: `988${Date.now()}${Math.floor(Math.random() * 1000)}`,
        password: "password123",
        business_type: "grocery",
        approved: true,
      });

      // Create product for other seller
      const otherProduct = await Product.create({
        seller_id: otherSeller._id,
        name: "Other Product",
        category: "Grocery",
        price: 50,
        stock: 10,
        status: "active",
      });

      // Create order with other seller's product
      const otherOrder = await Order.create({
        client_id: testClient._id,
        order_items: [
          {
            product_id: otherProduct._id,
            qty: 1,
            price_snapshot: 50,
          },
        ],
        payment: {
          method: "COD",
          status: "pending",
          amount: 50,
        },
        delivery: {
          delivery_address: {
            full_address: "123 Test St",
            latitude: 0,
            longitude: 0,
          },
          delivery_status: "pending",
        },
      });

      const response = await request(app)
        .get(`/api/seller/orders/${otherOrder._id}`)
        .set("x-seller-id", testSeller._id.toString());

      expect(response.status).toBe(403);
      expect(response.body.error).toBe(
        "Order does not include any items from this seller"
      );

      // Cleanup
      await Order.findByIdAndDelete(otherOrder._id);
      await Product.findByIdAndDelete(otherProduct._id);
      await Seller.findByIdAndDelete(otherSeller._id);
    });

    test("should handle database error when fetching order", async () => {
      // Mock findById to throw error
      jest.spyOn(Order, "findById").mockReturnValueOnce({
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockRejectedValueOnce(new Error("Database error")),
      });

      const fakeOrderId = new mongoose.Types.ObjectId();

      const response = await request(app)
        .get(`/api/seller/orders/${fakeOrderId}`)
        .set("x-seller-id", testSeller._id.toString());

      expect(response.status).toBe(500);
      expect(response.body.error).toBe("Failed to fetch order");

      // Restore original
      Order.findById.mockRestore();
    });
  });

  // ========================================
  // Section 11: POST /orders/accept Error Paths
  // ========================================
  describe("POST /api/seller/orders/accept - Error Handling", () => {
    test("should return 400 for invalid order ID", async () => {
      const response = await request(app)
        .post("/api/seller/orders/accept")
        .set("x-seller-id", testSeller._id.toString())
        .send({ orderId: "invalid-id" });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Invalid order ID");
    });

    test("should return 404 for non-existent order", async () => {
      const fakeOrderId = new mongoose.Types.ObjectId();

      const response = await request(app)
        .post("/api/seller/orders/accept")
        .set("x-seller-id", testSeller._id.toString())
        .send({ orderId: fakeOrderId.toString() });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("Order not found");
    });

    test("should return 403 when order does not include seller items", async () => {
      // Create another seller
      const otherSeller = await Seller.create({
        business_name: "Other Store Accept",
        email: `accept${Date.now()}@test.com`,
        phone: `989${Date.now()}${Math.floor(Math.random() * 1000)}`,
        password: "password123",
        business_type: "grocery",
        approved: true,
      });

      // Create product for other seller
      const otherProduct = await Product.create({
        seller_id: otherSeller._id,
        name: "Other Product Accept",
        category: "Grocery",
        price: 50,
        stock: 10,
        status: "active",
      });

      // Create order with other seller's product
      const otherOrder = await Order.create({
        client_id: testClient._id,
        order_items: [
          {
            product_id: otherProduct._id,
            qty: 1,
            price_snapshot: 50,
          },
        ],
        payment: {
          method: "COD",
          status: "pending",
          amount: 50,
        },
        delivery: {
          delivery_address: {
            full_address: "123 Test St",
            latitude: 0,
            longitude: 0,
          },
          delivery_status: "pending",
        },
      });

      const response = await request(app)
        .post("/api/seller/orders/accept")
        .set("x-seller-id", testSeller._id.toString())
        .send({ orderId: otherOrder._id.toString() });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe(
        "Order does not include any items from this seller"
      );

      // Cleanup
      await Order.findByIdAndDelete(otherOrder._id);
      await Product.findByIdAndDelete(otherProduct._id);
      await Seller.findByIdAndDelete(otherSeller._id);
    });

    test("should handle database error during order acceptance", async () => {
      // Create valid order
      const validOrder = await Order.create({
        client_id: testClient._id,
        order_items: [
          {
            product_id: testProduct._id,
            qty: 1,
            price_snapshot: 100,
          },
        ],
        payment: {
          method: "COD",
          status: "pending",
          amount: 100,
        },
        delivery: {
          delivery_address: {
            full_address: "123 Test St",
            latitude: 0,
            longitude: 0,
          },
          delivery_status: "pending",
        },
      });

      // Mock findByIdAndUpdate to throw error (this happens after initial findById verification)
      jest
        .spyOn(Order, "findByIdAndUpdate")
        .mockRejectedValueOnce(new Error("Database error"));

      const response = await request(app)
        .post("/api/seller/orders/accept")
        .set("x-seller-id", testSeller._id.toString())
        .send({ orderId: validOrder._id.toString() });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe("Failed to accept order");

      // Restore and cleanup
      Order.findByIdAndUpdate.mockRestore();
      await Order.findByIdAndDelete(validOrder._id);
    });
  });
});
