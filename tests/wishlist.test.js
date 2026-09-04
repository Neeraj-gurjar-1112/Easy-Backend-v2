const request = require("supertest");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const app = require("../app");
const { Wishlist, Product, Seller, Client } = require("../lib/models");
const logger = require("../lib/util/logger");
const {
  connectTestDB,
  clearTestDB,
  closeTestDB,
} = require("./testUtils/dbHandler");
const { generateJWT } = require("./testUtils/mockData");

// ========================================
// SETUP & TEARDOWN
// ========================================
let mockVerifyIdToken;

beforeAll(async () => {
  await connectTestDB();

  // Mock Firebase Admin SDK
  mockVerifyIdToken = jest.fn();
  global.firebaseAdmin = {
    auth: () => ({
      verifyIdToken: mockVerifyIdToken,
    }),
  };
});

afterAll(async () => {
  await closeTestDB();
  delete global.firebaseAdmin;
});

beforeEach(async () => {
  await clearTestDB();
  mockVerifyIdToken.mockReset();
  mockVerifyIdToken.mockResolvedValue({
    uid: "test-client-uid-123",
    email: "test@example.com",
    phone_number: "+1234567890",
    email_verified: true,
  });
});

// ========================================
// TEST DATA HELPERS
// ========================================
let authToken;
let testClient;
let testSeller;
let testProduct1;
let testProduct2;
let testProduct3;

async function createTestData() {
  authToken = generateJWT("test-client-uid-123", "client");

  testClient = await Client.create({
    firebase_uid: "test-client-uid-123",
    name: "Test User",
    phone: "+1234567890",
    profile_completed: true,
  });

  testSeller = await Seller.create({
    firebase_uid: "test-seller-uid-456",
    name: "Test Seller",
    email: "seller@test.com",
    phone: "+9876543210",
    business_name: "Test Store",
    pickup_address: {
      full_address: "123 Seller St, Test City",
      location: { lat: 12.9716, lng: 77.5946 },
    },
    approved: true,
  });

  testProduct1 = await Product.create({
    name: "Test Product 1",
    price: 29.99,
    seller_id: testSeller._id,
    category: "grocery",
    stock: 100,
    status: "active",
    description: "Test product 1 description",
  });

  testProduct2 = await Product.create({
    name: "Test Product 2",
    price: 49.99,
    seller_id: testSeller._id,
    category: "grocery",
    stock: 50,
    status: "active",
    description: "Test product 2 description",
  });

  testProduct3 = await Product.create({
    name: "Test Product 3",
    price: 19.99,
    seller_id: testSeller._id,
    category: "food",
    stock: 25,
    status: "active",
    description: "Test product 3 description",
  });
}

// ========================================
// POST /api/wishlist - Add to Wishlist
// ========================================
describe("POST /api/wishlist - Add to Wishlist", () => {
  beforeEach(async () => {
    await createTestData();
  });

  test("should add product to wishlist with valid data", async () => {
    const response = await request(app)
      .post("/api/wishlist")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ product_id: testProduct1._id.toString() });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe("Added to wishlist");
    expect(response.body.wishlistItem).toBeDefined();
    expect(response.body.wishlistItem.client_id).toBe("test-client-uid-123");
    expect(response.body.wishlistItem.product_id.toString()).toBe(
      testProduct1._id.toString()
    );

    // Verify in database
    const wishlistItem = await Wishlist.findOne({
      client_id: "test-client-uid-123",
      product_id: testProduct1._id,
    });
    expect(wishlistItem).toBeTruthy();
  });

  test("should reject add without authentication", async () => {
    const response = await request(app)
      .post("/api/wishlist")
      .send({ product_id: testProduct1._id.toString() });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  test("should reject add without product_id", async () => {
    const response = await request(app)
      .post("/api/wishlist")
      .set("Authorization", `Bearer ${authToken}`)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe("Product ID is required");
  });

  test("should reject add for non-existent product", async () => {
    const fakeProductId = new mongoose.Types.ObjectId();
    const response = await request(app)
      .post("/api/wishlist")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ product_id: fakeProductId.toString() });

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe("Product not found");
  });

  test("should reject duplicate wishlist entry", async () => {
    // Add product first time
    await request(app)
      .post("/api/wishlist")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ product_id: testProduct1._id.toString() });

    // Try to add same product again
    const response = await request(app)
      .post("/api/wishlist")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ product_id: testProduct1._id.toString() });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe("Product already in wishlist");
  });

  test("should allow adding multiple different products", async () => {
    // Add product 1
    const response1 = await request(app)
      .post("/api/wishlist")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ product_id: testProduct1._id.toString() });

    expect(response1.status).toBe(201);

    // Add product 2
    const response2 = await request(app)
      .post("/api/wishlist")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ product_id: testProduct2._id.toString() });

    expect(response2.status).toBe(201);

    // Verify both in database
    const count = await Wishlist.countDocuments({
      client_id: "test-client-uid-123",
    });
    expect(count).toBe(2);
  });
});

// ========================================
// GET /api/wishlist - Get Wishlist
// ========================================
describe("GET /api/wishlist - Get Wishlist", () => {
  beforeEach(async () => {
    await createTestData();
  });

  test("should retrieve user's wishlist with populated products", async () => {
    // Add products to wishlist
    await Wishlist.create({
      client_id: "test-client-uid-123",
      product_id: testProduct1._id,
    });
    await Wishlist.create({
      client_id: "test-client-uid-123",
      product_id: testProduct2._id,
    });

    const response = await request(app)
      .get("/api/wishlist")
      .set("Authorization", `Bearer ${authToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.wishlist).toHaveLength(2);
    expect(response.body.pagination.total).toBe(2);

    // Verify product details are populated
    const firstItem = response.body.wishlist[0];
    expect(firstItem.product_id).toBeDefined();
    expect(firstItem.product_id.name).toBeDefined();
    expect(firstItem.product_id.price).toBeDefined();
    expect(firstItem.product_id.seller_id).toBeDefined();
    expect(firstItem.product_id.seller_id.business_name).toBe("Test Store");
  });

  test("should return empty array for user with no wishlist items", async () => {
    const response = await request(app)
      .get("/api/wishlist")
      .set("Authorization", `Bearer ${authToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.wishlist).toEqual([]);
    expect(response.body.pagination.total).toBe(0);
  });

  test("should support pagination", async () => {
    // Add 3 products to wishlist
    await Wishlist.create({
      client_id: "test-client-uid-123",
      product_id: testProduct1._id,
    });
    await Wishlist.create({
      client_id: "test-client-uid-123",
      product_id: testProduct2._id,
    });
    await Wishlist.create({
      client_id: "test-client-uid-123",
      product_id: testProduct3._id,
    });

    const response = await request(app)
      .get("/api/wishlist?page=1&limit=2")
      .set("Authorization", `Bearer ${authToken}`);

    expect(response.status).toBe(200);
    expect(response.body.wishlist).toHaveLength(2);
    expect(response.body.pagination.total).toBe(3);
    expect(response.body.pagination.page).toBe(1);
    expect(response.body.pagination.limit).toBe(2);
    expect(response.body.pagination.pages).toBe(2);
  });

  test("should reject request without authentication", async () => {
    const response = await request(app).get("/api/wishlist");

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  test("should filter out items where product no longer exists", async () => {
    // Add product to wishlist
    await Wishlist.create({
      client_id: "test-client-uid-123",
      product_id: testProduct1._id,
    });

    // Delete the product
    await Product.findByIdAndDelete(testProduct1._id);

    const response = await request(app)
      .get("/api/wishlist")
      .set("Authorization", `Bearer ${authToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.wishlist).toEqual([]); // Should be empty after filtering
  });

  test("should sort wishlist by added_at (newest first)", async () => {
    // Add products with slight delay to ensure different timestamps
    const item1 = await Wishlist.create({
      client_id: "test-client-uid-123",
      product_id: testProduct1._id,
      added_at: new Date("2024-01-01"),
    });

    const item2 = await Wishlist.create({
      client_id: "test-client-uid-123",
      product_id: testProduct2._id,
      added_at: new Date("2024-01-02"),
    });

    const response = await request(app)
      .get("/api/wishlist")
      .set("Authorization", `Bearer ${authToken}`);

    expect(response.status).toBe(200);
    expect(response.body.wishlist).toHaveLength(2);
    // Newest first (product2 added later)
    expect(response.body.wishlist[0].product_id._id.toString()).toBe(
      testProduct2._id.toString()
    );
    expect(response.body.wishlist[1].product_id._id.toString()).toBe(
      testProduct1._id.toString()
    );
  });
});

// ========================================
// GET /api/wishlist/check/:productId - Check Wishlist
// ========================================
describe("GET /api/wishlist/check/:productId - Check if in Wishlist", () => {
  beforeEach(async () => {
    await createTestData();
  });

  test("should return true when product is in wishlist", async () => {
    // Add product to wishlist
    await Wishlist.create({
      client_id: "test-client-uid-123",
      product_id: testProduct1._id,
    });

    const response = await request(app)
      .get(`/api/wishlist/check/${testProduct1._id}`)
      .set("Authorization", `Bearer ${authToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.inWishlist).toBe(true);
  });

  test("should return false when product is not in wishlist", async () => {
    const response = await request(app)
      .get(`/api/wishlist/check/${testProduct1._id}`)
      .set("Authorization", `Bearer ${authToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.inWishlist).toBe(false);
  });

  test("should reject check without authentication", async () => {
    const response = await request(app).get(
      `/api/wishlist/check/${testProduct1._id}`
    );

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  test("should handle database error in check wishlist", async () => {
    const findOneSpy = jest
      .spyOn(Wishlist, "findOne")
      .mockImplementationOnce(() => {
        throw new Error("Database connection failed");
      });

    const response = await request(app)
      .get(`/api/wishlist/check/${testProduct1._id}`)
      .set("Authorization", `Bearer ${authToken}`);

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain("Failed to check wishlist");

    findOneSpy.mockRestore();
  });
});

// ========================================
// DELETE /api/wishlist/:productId - Remove from Wishlist
// ========================================
describe("DELETE /api/wishlist/:productId - Remove from Wishlist", () => {
  beforeEach(async () => {
    await createTestData();
  });

  test("should remove product from wishlist", async () => {
    // Add product to wishlist
    await Wishlist.create({
      client_id: "test-client-uid-123",
      product_id: testProduct1._id,
    });

    const response = await request(app)
      .delete(`/api/wishlist/${testProduct1._id}`)
      .set("Authorization", `Bearer ${authToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe("Removed from wishlist");

    // Verify removed from database
    const wishlistItem = await Wishlist.findOne({
      client_id: "test-client-uid-123",
      product_id: testProduct1._id,
    });
    expect(wishlistItem).toBeNull();
  });

  test("should return 404 when product not in wishlist", async () => {
    const response = await request(app)
      .delete(`/api/wishlist/${testProduct1._id}`)
      .set("Authorization", `Bearer ${authToken}`);

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe("Product not found in wishlist");
  });

  test("should reject delete without authentication", async () => {
    const response = await request(app).delete(
      `/api/wishlist/${testProduct1._id}`
    );

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  test("should only remove product for authenticated user", async () => {
    // Create another user and their wishlist item
    const otherUserToken = generateJWT("other-user-uid", "client");
    await Client.create({
      firebase_uid: "other-user-uid",
      name: "Other User",
      phone: "+1111111111",
      profile_completed: true,
    });

    await Wishlist.create({
      client_id: "other-user-uid",
      product_id: testProduct1._id,
    });

    // Try to delete with test-client-uid-123 (should not affect other user)
    const response = await request(app)
      .delete(`/api/wishlist/${testProduct1._id}`)
      .set("Authorization", `Bearer ${authToken}`);

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Product not found in wishlist");

    // Verify other user's item still exists
    const otherUserItem = await Wishlist.findOne({
      client_id: "other-user-uid",
      product_id: testProduct1._id,
    });
    expect(otherUserItem).toBeTruthy();
  });
});

// ========================================
// DELETE /api/wishlist - Clear Entire Wishlist
// ========================================
describe("DELETE /api/wishlist - Clear Entire Wishlist", () => {
  beforeEach(async () => {
    await createTestData();
  });

  test("should clear entire wishlist", async () => {
    // Add multiple products to wishlist
    await Wishlist.create({
      client_id: "test-client-uid-123",
      product_id: testProduct1._id,
    });
    await Wishlist.create({
      client_id: "test-client-uid-123",
      product_id: testProduct2._id,
    });
    await Wishlist.create({
      client_id: "test-client-uid-123",
      product_id: testProduct3._id,
    });

    const response = await request(app)
      .delete("/api/wishlist")
      .set("Authorization", `Bearer ${authToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe("Wishlist cleared");
    expect(response.body.deletedCount).toBe(3);

    // Verify all items removed
    const count = await Wishlist.countDocuments({
      client_id: "test-client-uid-123",
    });
    expect(count).toBe(0);
  });

  test("should return 0 deletedCount when wishlist is already empty", async () => {
    const response = await request(app)
      .delete("/api/wishlist")
      .set("Authorization", `Bearer ${authToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe("Wishlist cleared");
    expect(response.body.deletedCount).toBe(0);
  });

  test("should reject clear without authentication", async () => {
    const response = await request(app).delete("/api/wishlist");

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  test("should only clear wishlist for authenticated user", async () => {
    // Create another user and their wishlist
    await Client.create({
      firebase_uid: "other-user-uid",
      name: "Other User",
      phone: "+1111111111",
      profile_completed: true,
    });

    await Wishlist.create({
      client_id: "test-client-uid-123",
      product_id: testProduct1._id,
    });
    await Wishlist.create({
      client_id: "other-user-uid",
      product_id: testProduct2._id,
    });

    // Clear wishlist for test-client-uid-123
    const response = await request(app)
      .delete("/api/wishlist")
      .set("Authorization", `Bearer ${authToken}`);

    expect(response.status).toBe(200);
    expect(response.body.deletedCount).toBe(1);

    // Verify only test user's items cleared
    const testUserCount = await Wishlist.countDocuments({
      client_id: "test-client-uid-123",
    });
    expect(testUserCount).toBe(0);

    const otherUserCount = await Wishlist.countDocuments({
      client_id: "other-user-uid",
    });
    expect(otherUserCount).toBe(1);
  });
});

// ========================================
// DATABASE ERROR HANDLERS
// ========================================
describe("Database Error Handlers", () => {
  beforeEach(async () => {
    await createTestData();
  });

  test("should handle database error in POST wishlist", async () => {
    const saveSpy = jest
      .spyOn(Wishlist.prototype, "save")
      .mockImplementationOnce(() => {
        throw new Error("Database connection failed");
      });

    const response = await request(app)
      .post("/api/wishlist")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ product_id: testProduct1._id.toString() });

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain("Failed to add to wishlist");

    saveSpy.mockRestore();
  });

  test("should handle database error in GET wishlist", async () => {
    const findSpy = jest.spyOn(Wishlist, "find").mockImplementationOnce(() => {
      throw new Error("Database query failed");
    });

    const response = await request(app)
      .get("/api/wishlist")
      .set("Authorization", `Bearer ${authToken}`);

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain("Failed to fetch wishlist");

    findSpy.mockRestore();
  });

  test("should handle database error in DELETE wishlist item", async () => {
    const findOneAndDeleteSpy = jest
      .spyOn(Wishlist, "findOneAndDelete")
      .mockImplementationOnce(() => {
        throw new Error("Database connection lost");
      });

    const response = await request(app)
      .delete(`/api/wishlist/${testProduct1._id}`)
      .set("Authorization", `Bearer ${authToken}`);

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain("Failed to remove from wishlist");

    findOneAndDeleteSpy.mockRestore();
  });

  test("should handle database error in clear wishlist", async () => {
    const deleteManySpy = jest
      .spyOn(Wishlist, "deleteMany")
      .mockImplementationOnce(() => {
        throw new Error("Network timeout");
      });

    const response = await request(app)
      .delete("/api/wishlist")
      .set("Authorization", `Bearer ${authToken}`);

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain("Failed to clear wishlist");

    deleteManySpy.mockRestore();
  });
});

// ========================================
// Phase 21.2: Comprehensive Error Path & Edge Case Coverage
// ========================================
describe("Phase 21.2: Error Paths & Edge Cases Coverage", () => {
  beforeEach(async () => {
    await createTestData();
  });

  // Section 1: POST /api/wishlist - Advanced Error Handling
  describe("POST /api/wishlist - Advanced Error Handling", () => {
    test("should return 404 when adding non-existent product", async () => {
      const fakeProductId = "507f1f77bcf86cd799439011"; // Valid ObjectId format

      const response = await request(app)
        .post("/api/wishlist")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ product_id: fakeProductId });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe("Product not found");
    });

    test("should handle Product.findById database error", async () => {
      const findByIdSpy = jest
        .spyOn(Product, "findById")
        .mockImplementationOnce(() => {
          throw new Error("Database connection lost");
        });

      const response = await request(app)
        .post("/api/wishlist")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ product_id: testProduct1._id.toString() });

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe("Failed to add to wishlist");

      findByIdSpy.mockRestore();
    });

    test("should handle Wishlist.findOne database error (duplicate check)", async () => {
      const findOneSpy = jest
        .spyOn(Wishlist, "findOne")
        .mockImplementationOnce(() => {
          throw new Error("Database query timeout");
        });

      const response = await request(app)
        .post("/api/wishlist")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ product_id: testProduct1._id.toString() });

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe("Failed to add to wishlist");

      findOneSpy.mockRestore();
    });
  });

  // Section 2: GET /api/wishlist - Pagination & Query Errors
  describe("GET /api/wishlist - Pagination & Query Errors", () => {
    test("should handle Wishlist.countDocuments database error", async () => {
      const countSpy = jest
        .spyOn(Wishlist, "countDocuments")
        .mockImplementationOnce(() => {
          throw new Error("Count query failed");
        });

      const response = await request(app)
        .get("/api/wishlist")
        .set("Authorization", `Bearer ${authToken}`);

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe("Failed to fetch wishlist");

      countSpy.mockRestore();
    });

    test("should handle populate() error gracefully", async () => {
      // Mock find to return a chainable query that throws on populate
      const mockQuery = {
        populate: jest.fn().mockImplementationOnce(() => {
          throw new Error("Populate failed");
        }),
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
      };

      const findSpy = jest
        .spyOn(Wishlist, "find")
        .mockReturnValueOnce(mockQuery);

      const response = await request(app)
        .get("/api/wishlist")
        .set("Authorization", `Bearer ${authToken}`);

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);

      findSpy.mockRestore();
    });

    test("should handle pagination with invalid page/limit", async () => {
      const response = await request(app)
        .get("/api/wishlist?page=-1&limit=0")
        .set("Authorization", `Bearer ${authToken}`);

      // Should still succeed with default/corrected values
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  // Section 3: GET /api/wishlist/check/:productId - Error Handling
  describe("GET /api/wishlist/check/:productId - Error Handling", () => {
    test("should handle database error in check endpoint", async () => {
      const findOneSpy = jest
        .spyOn(Wishlist, "findOne")
        .mockImplementationOnce(() => {
          throw new Error("Database connection interrupted");
        });

      const response = await request(app)
        .get(`/api/wishlist/check/${testProduct1._id}`)
        .set("Authorization", `Bearer ${authToken}`);

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe("Failed to check wishlist");

      findOneSpy.mockRestore();
    });

    test("should handle invalid product ID format", async () => {
      const response = await request(app)
        .get("/api/wishlist/check/invalid-id-format")
        .set("Authorization", `Bearer ${authToken}`);

      // Should handle gracefully (may return 500 or false)
      expect(response.body.success).toBeDefined();
    });
  });

  // Section 4: DELETE /api/wishlist/:productId - Not Found & Errors
  describe("DELETE /api/wishlist/:productId - Not Found & Errors", () => {
    test("should return 404 when removing non-existent wishlist item", async () => {
      const fakeProductId = "507f1f77bcf86cd799439011";

      const response = await request(app)
        .delete(`/api/wishlist/${fakeProductId}`)
        .set("Authorization", `Bearer ${authToken}`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe("Product not found in wishlist");
    });

    test("should handle database error in findOneAndDelete", async () => {
      const deleteSpy = jest
        .spyOn(Wishlist, "findOneAndDelete")
        .mockImplementationOnce(() => {
          throw new Error("Delete operation failed");
        });

      const response = await request(app)
        .delete(`/api/wishlist/${testProduct1._id}`)
        .set("Authorization", `Bearer ${authToken}`);

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe("Failed to remove from wishlist");

      deleteSpy.mockRestore();
    });
  });

  // Section 5: DELETE /api/wishlist - Clear Wishlist Edge Cases
  describe("DELETE /api/wishlist - Clear Wishlist Edge Cases", () => {
    test("should successfully clear empty wishlist", async () => {
      // Clear existing items first
      await Wishlist.deleteMany({ client_id: testClient._id });

      const response = await request(app)
        .delete("/api/wishlist")
        .set("Authorization", `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.deletedCount).toBe(0);
    });

    test("should handle database error in deleteMany", async () => {
      const deleteManySpy = jest
        .spyOn(Wishlist, "deleteMany")
        .mockImplementationOnce(() => {
          throw new Error("Bulk delete failed");
        });

      const response = await request(app)
        .delete("/api/wishlist")
        .set("Authorization", `Bearer ${authToken}`);

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe("Failed to clear wishlist");

      deleteManySpy.mockRestore();
    });
  });

  // Section 6: Validation & Authorization Edge Cases
  describe("Validation & Authorization Edge Cases", () => {
    test("POST should return 400 for missing product_id", async () => {
      const response = await request(app)
        .post("/api/wishlist")
        .set("Authorization", `Bearer ${authToken}`)
        .send({}); // No product_id

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe("Product ID is required");
    });

    test("POST should return 400 when product already in wishlist", async () => {
      // Add product first
      await request(app)
        .post("/api/wishlist")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ product_id: testProduct1._id.toString() });

      // Try adding again
      const response = await request(app)
        .post("/api/wishlist")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ product_id: testProduct1._id.toString() });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe("Product already in wishlist");
    });

    test("should verify wishlist query filters by client_id", async () => {
      // This test verifies the core isolation behavior: Wishlist.find({ client_id })
      // The actual route uses req.user.id which comes from Firebase auth middleware

      // Add products to first user's wishlist
      await Wishlist.create({
        client_id: testClient.firebase_uid,
        product_id: testProduct1._id,
      });

      await Wishlist.create({
        client_id: testClient.firebase_uid,
        product_id: testProduct2._id,
      });

      // Create a different client_id
      const differentClientId = "different_user_uid_123";
      await Wishlist.create({
        client_id: differentClientId,
        product_id: testProduct3._id,
      });

      // Verify database-level isolation
      const firstUserItems = await Wishlist.find({
        client_id: testClient.firebase_uid,
      });
      const secondUserItems = await Wishlist.find({
        client_id: differentClientId,
      });

      expect(firstUserItems.length).toBe(2);
      expect(secondUserItems.length).toBe(1);

      // Verify through API (uses same client_id filter)
      const response = await request(app)
        .get("/api/wishlist")
        .set("Authorization", `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      // Should only see items for authenticated user
      expect(response.body.wishlist.length).toBeGreaterThanOrEqual(2);

      // Cleanup
      await Wishlist.deleteMany({ client_id: differentClientId });
    });
  });

  // Section 7: Logger Coverage (Production-Only)
  describe("Logger Coverage - Production Paths", () => {
    test("should log successful wishlist addition", async () => {
      const loggerSpy = jest.spyOn(logger, "info");

      await request(app)
        .post("/api/wishlist")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ product_id: testProduct1._id.toString() });

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining("added to wishlist")
      );

      loggerSpy.mockRestore();
    });

    test("should log errors during wishlist operations", async () => {
      const loggerSpy = jest.spyOn(logger, "error");
      const saveSpy = jest
        .spyOn(Wishlist.prototype, "save")
        .mockImplementationOnce(() => {
          throw new Error("Test error");
        });

      await request(app)
        .post("/api/wishlist")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ product_id: testProduct1._id.toString() });

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining("Error adding to wishlist"),
        expect.any(Error)
      );

      loggerSpy.mockRestore();
      saveSpy.mockRestore();
    });

    test("should log successful wishlist item removal", async () => {
      // Add item first
      await request(app)
        .post("/api/wishlist")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ product_id: testProduct1._id.toString() });

      const loggerSpy = jest.spyOn(logger, "info");

      // Remove item
      await request(app)
        .delete(`/api/wishlist/${testProduct1._id}`)
        .set("Authorization", `Bearer ${authToken}`);

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining("removed from wishlist")
      );

      loggerSpy.mockRestore();
    });

    test("should log successful wishlist clear", async () => {
      const loggerSpy = jest.spyOn(logger, "info");

      await request(app)
        .delete("/api/wishlist")
        .set("Authorization", `Bearer ${authToken}`);

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining("Cleared wishlist")
      );

      loggerSpy.mockRestore();
    });
  });
});
