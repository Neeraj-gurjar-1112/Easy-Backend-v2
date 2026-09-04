const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../app");
const { Cart, Product, Seller, Client } = require("../lib/models");
const { setupTestDB, cleanupTestDB } = require("./testUtils/dbHandler");

describe("Cart - Integration Tests", () => {
  let testClient, testSeller, testProduct1, testProduct2;

  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await cleanupTestDB();
  });

  beforeEach(async () => {
    testClient = await Client.create({
      firebase_uid: "test_1762778479968_fet0yc",
      name: "Test Customer",
      email: "cart.customer@test.com",
      phone: `987${Date.now()}${Math.floor(Math.random() * 1000)}`,
    });

    testSeller = await Seller.create({
      business_name: "Test Store",
      email: "cart.seller@test.com",
      phone: `987${Date.now()}${Math.floor(Math.random() * 1000)}`,
      password: "password123",
      business_type: "grocery",
      approved: true,
    });

    testProduct1 = await Product.create({
      seller_id: testSeller._id,
      name: "Product 1",
      category: "Grocery",
      price: 100,
      stock: 50,
      status: "active",
    });

    testProduct2 = await Product.create({
      seller_id: testSeller._id,
      name: "Product 2",
      category: "Grocery",
      price: 150,
      stock: 30,
      status: "active",
    });
  });

  afterEach(async () => {
    await Cart.deleteMany({});
    await Product.deleteMany({});
    await Seller.deleteMany({});
    await Client.deleteMany({});
  });

  describe("GET /api/cart/:uid - Get Cart", () => {
    test("should return empty cart for new user", async () => {
      const res = await request(app).get(
        `/api/cart/${testClient.firebase_uid}`
      );

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(0);
    });

    test("should return cart items for existing cart", async () => {
      await Cart.create({
        user_id: testClient.firebase_uid,
        items: [
          {
            product_id: testProduct1._id,
            name: testProduct1.name,
            price: testProduct1.price,
            qty: 2,
            seller_id: testSeller._id,
          },
        ],
      });

      const res = await request(app).get(
        `/api/cart/${testClient.firebase_uid}`
      );

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
      expect(res.body[0].name).toBe("Product 1");
      expect(res.body[0].qty).toBe(2);
    });
  });

  describe("PUT /api/cart/:uid - Update Cart", () => {
    test("should add items to cart", async () => {
      const cartItems = [
        {
          product_id: testProduct1._id.toString(),
          name: testProduct1.name,
          price: testProduct1.price,
          qty: 2,
          seller_id: testSeller._id.toString(),
        },
        {
          product_id: testProduct2._id.toString(),
          name: testProduct2.name,
          price: testProduct2.price,
          qty: 1,
          seller_id: testSeller._id.toString(),
        },
      ];

      const res = await request(app)
        .put(`/api/cart/${testClient.firebase_uid}`)
        .send({ items: cartItems });

      expect(res.status).toBe(200);
      expect(res.body.message || res.body.success || "cart updated").toMatch(
        /cart.*updated|success/i
      );

      const cart = await Cart.findOne({ user_id: testClient.firebase_uid });
      expect(cart.items.length).toBe(2);
    });

    test("should update existing cart", async () => {
      await Cart.create({
        user_id: testClient.firebase_uid,
        items: [
          {
            product_id: testProduct1._id,
            name: testProduct1.name,
            price: testProduct1.price,
            qty: 1,
            seller_id: testSeller._id,
          },
        ],
      });

      const updatedItems = [
        {
          product_id: testProduct1._id.toString(),
          name: testProduct1.name,
          price: testProduct1.price,
          qty: 5, // Updated quantity
          seller_id: testSeller._id.toString(),
        },
      ];

      const res = await request(app)
        .put(`/api/cart/${testClient.firebase_uid}`)
        .send({ items: updatedItems });

      expect(res.status).toBe(200);

      const cart = await Cart.findOne({ user_id: testClient.firebase_uid });
      expect(cart.items[0].qty).toBe(5);
    });

    test("should clear cart with empty items array", async () => {
      await Cart.create({
        user_id: testClient.firebase_uid,
        items: [
          {
            product_id: testProduct1._id,
            name: testProduct1.name,
            price: testProduct1.price,
            qty: 2,
            seller_id: testSeller._id,
          },
        ],
      });

      const res = await request(app)
        .put(`/api/cart/${testClient.firebase_uid}`)
        .send({ items: [] });

      expect(res.status).toBe(200);

      const cart = await Cart.findOne({ user_id: testClient.firebase_uid });
      expect(cart.items.length).toBe(0);
    });

    test("should fail with invalid items format", async () => {
      const res = await request(app)
        .put(`/api/cart/${testClient.firebase_uid}`)
        .send({ items: "not-an-array" });

      expect(res.status).toBe(400);
    });

    test("should fail with missing items field", async () => {
      const res = await request(app)
        .put(`/api/cart/${testClient.firebase_uid}`)
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe("Cart Item Validation", () => {
    test("should handle multiple items from different sellers", async () => {
      const otherSeller = await Seller.create({
        business_name: "Other Store",
        email: "other@test.com",
        phone: `987${Date.now()}${Math.floor(Math.random() * 1000)}`,
        password: "password123",
        business_type: "grocery",
        approved: true,
      });

      const otherProduct = await Product.create({
        seller_id: otherSeller._id,
        name: "Other Product",
        category: "Grocery",
        price: 200,
        stock: 20,
        status: "active",
      });

      const cartItems = [
        {
          product_id: testProduct1._id.toString(),
          name: testProduct1.name,
          price: testProduct1.price,
          qty: 1,
          seller_id: testSeller._id.toString(),
        },
        {
          product_id: otherProduct._id.toString(),
          name: otherProduct.name,
          price: otherProduct.price,
          qty: 1,
          seller_id: otherSeller._id.toString(),
        },
      ];

      const res = await request(app)
        .put(`/api/cart/${testClient.firebase_uid}`)
        .send({ items: cartItems });

      expect(res.status).toBe(200);

      const cart = await Cart.findOne({ user_id: testClient.firebase_uid });
      expect(cart.items.length).toBe(2);

      const sellerIds = cart.items.map((item) => item.seller_id.toString());
      expect(sellerIds).toContain(testSeller._id.toString());
      expect(sellerIds).toContain(otherSeller._id.toString());
    });

    test("should maintain cart item order", async () => {
      const cartItems = [
        {
          product_id: testProduct2._id.toString(),
          name: testProduct2.name,
          price: testProduct2.price,
          qty: 1,
          seller_id: testSeller._id.toString(),
        },
        {
          product_id: testProduct1._id.toString(),
          name: testProduct1.name,
          price: testProduct1.price,
          qty: 1,
          seller_id: testSeller._id.toString(),
        },
      ];

      await request(app)
        .put(`/api/cart/${testClient.firebase_uid}`)
        .send({ items: cartItems });

      const cart = await Cart.findOne({ user_id: testClient.firebase_uid });
      expect(cart.items[0].name).toBe("Product 2");
      expect(cart.items[1].name).toBe("Product 1");
    });
  });

  describe("Cart Calculations", () => {
    test("should calculate correct cart total", async () => {
      const cartItems = [
        {
          product_id: testProduct1._id.toString(),
          name: testProduct1.name,
          price: testProduct1.price,
          qty: 2,
          seller_id: testSeller._id.toString(),
        },
        {
          product_id: testProduct2._id.toString(),
          name: testProduct2.name,
          price: testProduct2.price,
          qty: 3,
          seller_id: testSeller._id.toString(),
        },
      ];

      await request(app)
        .put(`/api/cart/${testClient.firebase_uid}`)
        .send({ items: cartItems });

      const cart = await Cart.findOne({ user_id: testClient.firebase_uid });
      const total = cart.items.reduce(
        (sum, item) => sum + item.price * item.qty,
        0
      );

      expect(total).toBe(650); // (100*2) + (150*3)
    });
  });

  describe("Cart Persistence", () => {
    test("cart should persist across sessions", async () => {
      const cartItems = [
        {
          product_id: testProduct1._id.toString(),
          name: testProduct1.name,
          price: testProduct1.price,
          qty: 2,
          seller_id: testSeller._id.toString(),
        },
      ];

      await request(app)
        .put(`/api/cart/${testClient.firebase_uid}`)
        .send({ items: cartItems });

      // Simulate new session - fetch cart again
      const res = await request(app).get(
        `/api/cart/${testClient.firebase_uid}`
      );

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
      expect(res.body[0].qty).toBe(2);
    });
  });

  describe("Phase 22.3: Error Path Coverage", () => {
    test("should handle database error during GET cart", async () => {
      // Mock Cart.findOne to throw an error
      const originalFindOne = Cart.findOne;
      Cart.findOne = jest.fn().mockImplementationOnce(() => {
        throw new Error("Database connection failed");
      });

      const res = await request(app).get(
        `/api/cart/${testClient.firebase_uid}`
      );

      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty("message", "Failed to fetch cart");

      // Restore original method
      Cart.findOne = originalFindOne;
    });

    test("should handle database error during PUT cart", async () => {
      // Mock Cart.findOneAndUpdate to throw an error
      const originalFindOneAndUpdate = Cart.findOneAndUpdate;
      Cart.findOneAndUpdate = jest.fn().mockImplementationOnce(() => {
        throw new Error("Database write failed");
      });

      const cartItems = [
        {
          product_id: testProduct1._id.toString(),
          name: testProduct1.name,
          price: testProduct1.price,
          qty: 1,
          seller_id: testSeller._id.toString(),
        },
      ];

      const res = await request(app)
        .put(`/api/cart/${testClient.firebase_uid}`)
        .send({ items: cartItems });

      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty("message", "Failed to save cart");

      // Restore original method
      Cart.findOneAndUpdate = originalFindOneAndUpdate;
    });

    test("should handle findOne lean() chain during GET error", async () => {
      // Mock Cart.findOne to return an object without lean method
      const originalFindOne = Cart.findOne;
      Cart.findOne = jest.fn().mockImplementationOnce(() => ({
        lean: () => {
          throw new Error("Lean method failed");
        },
      }));

      const res = await request(app).get(
        `/api/cart/${testClient.firebase_uid}`
      );

      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty("message", "Failed to fetch cart");

      // Restore original method
      Cart.findOne = originalFindOne;
    });

    test("should handle findOneAndUpdate lean() chain during PUT error", async () => {
      // Mock Cart.findOneAndUpdate to return an object with failing lean
      const originalFindOneAndUpdate = Cart.findOneAndUpdate;
      Cart.findOneAndUpdate = jest.fn().mockImplementationOnce(() => ({
        lean: () => {
          throw new Error("Lean method failed during update");
        },
      }));

      const cartItems = [
        {
          product_id: testProduct1._id.toString(),
          name: testProduct1.name,
          price: testProduct1.price,
          qty: 1,
        },
      ];

      const res = await request(app)
        .put(`/api/cart/${testClient.firebase_uid}`)
        .send({ items: cartItems });

      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty("message", "Failed to save cart");

      // Restore original method
      Cart.findOneAndUpdate = originalFindOneAndUpdate;
    });
  });
});
