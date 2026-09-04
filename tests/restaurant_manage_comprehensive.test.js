const request = require("supertest");
const app = require("../app");
const { Seller } = require("../lib/models");
const dbHandler = require("./testUtils/dbHandler");

// ===================================================================
// Restaurant Management Routes - Comprehensive Tests
// ===================================================================
describe("Restaurant Management Routes - Comprehensive Tests", () => {
  beforeAll(async () => {
    await dbHandler.connectTestDB();
  });

  afterAll(async () => {
    await dbHandler.closeTestDB();
  });

  beforeEach(async () => {
    await Seller.deleteMany({});
  });

  // ===================================================================
  // Section 1: requireSeller Middleware
  // ===================================================================
  describe("Section 1: requireSeller Middleware", () => {
    test("1.1: should require valid sellerId in query", async () => {
      const seller = await Seller.create({
        email: "seller@test.com",
        phone: "+1234567890",
        name: "Test Seller",
        business_name: "Test Restaurant",
        business_type: "restaurant",
        password: "hashed",
      });

      const res = await request(app).get(
        `/api/restaurant-manage/me?sellerId=${seller._id}`
      );

      expect(res.status).toBe(200);
      expect(res.body.business_name).toBe("Test Restaurant");
    });

    test("1.2: should accept sellerId in request body", async () => {
      const seller = await Seller.create({
        email: "seller2@test.com",
        phone: "+1234567891",
        name: "Seller Two",
        business_name: "Restaurant Two",
        business_type: "restaurant",
        password: "hashed",
      });

      const res = await request(app).put("/api/restaurant-manage/me").send({
        seller_id: seller._id.toString(),
        business_name: "Updated Name",
      });

      expect(res.status).toBe(200);
      expect(res.body.business_name).toBe("Updated Name");
    });

    test("1.3: should accept sellerId in x-seller-id header", async () => {
      const seller = await Seller.create({
        email: "seller3@test.com",
        phone: "+1234567892",
        name: "Seller Three",
        business_name: "Restaurant Three",
        business_type: "restaurant",
        password: "hashed",
      });

      const res = await request(app)
        .get("/api/restaurant-manage/me")
        .set("x-seller-id", seller._id.toString());

      expect(res.status).toBe(200);
      expect(res.body.business_name).toBe("Restaurant Three");
    });

    test("1.4: should return 400 if sellerId is missing", async () => {
      const res = await request(app).get("/api/restaurant-manage/me");

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("valid sellerId required");
    });

    test("1.5: should return 400 if sellerId is invalid ObjectId", async () => {
      const res = await request(app).get(
        "/api/restaurant-manage/me?sellerId=invalid123"
      );

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("valid sellerId required");
    });

    test("1.6: should return 400 if sellerId is empty string", async () => {
      const res = await request(app).get("/api/restaurant-manage/me?sellerId=");

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("valid sellerId required");
    });
  });

  // ===================================================================
  // Section 2: GET /me - Fetch Restaurant Profile
  // ===================================================================
  describe("Section 2: GET /me - Fetch Restaurant Profile", () => {
    test("2.1: should return seller profile with all fields", async () => {
      const seller = await Seller.create({
        email: "full@test.com",
        phone: "+1234567893",
        name: "Full Seller",
        business_name: "Full Restaurant",
        business_type: "restaurant",
        password: "hashed",
        address: "123 Main St",
        description: "Great food",
        cuisine: "Italian",
        logo_url: "https://example.com/logo.png",
        banner_url: "https://example.com/banner.png",
        opening_hours: "9am-10pm",
        location: { type: "Point", coordinates: [-73.935242, 40.73061] },
        place_id: "ChIJplace123",
        delivery_radius_km: 5,
      });

      const res = await request(app).get(
        `/api/restaurant-manage/me?sellerId=${seller._id}`
      );

      expect(res.status).toBe(200);
      expect(res.body.email).toBe("full@test.com");
      expect(res.body.business_name).toBe("Full Restaurant");
      expect(res.body.address).toBe("123 Main St");
      expect(res.body.cuisine).toBe("Italian");
      expect(res.body.delivery_radius_km).toBe(5);
    });

    test("2.2: should return 404 if seller not found", async () => {
      const fakeId = "507f1f77bcf86cd799439011";

      const res = await request(app).get(
        `/api/restaurant-manage/me?sellerId=${fakeId}`
      );

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("seller not found");
    });

    test("2.3: should handle database errors gracefully", async () => {
      const seller = await Seller.create({
        email: "error@test.com",
        phone: "+1234567894",
        name: "Error Seller",
        business_name: "Error Restaurant",
        business_type: "restaurant",
        password: "hashed",
      });

      // Mock findById to throw error
      const originalFindById = Seller.findById;
      Seller.findById = jest.fn(() => {
        throw new Error("Database connection error");
      });

      const res = await request(app).get(
        `/api/restaurant-manage/me?sellerId=${seller._id}`
      );

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("failed to fetch");

      // Restore original method
      Seller.findById = originalFindById;
    });
  });

  // ===================================================================
  // Section 3: PUT /me - Update Restaurant Profile
  // ===================================================================
  describe("Section 3: PUT /me - Update Restaurant Profile", () => {
    test("3.1: should update business_name", async () => {
      const seller = await Seller.create({
        email: "update1@test.com",
        phone: "+1234567895",
        name: "Update Seller",
        business_name: "Old Name",
        business_type: "restaurant",
        password: "hashed",
      });

      const res = await request(app).put("/api/restaurant-manage/me").send({
        seller_id: seller._id.toString(),
        business_name: "New Name",
      });

      expect(res.status).toBe(200);
      expect(res.body.business_name).toBe("New Name");
    });

    test("3.2: should update multiple fields at once", async () => {
      const seller = await Seller.create({
        email: "update2@test.com",
        phone: "+1234567896",
        name: "Update Seller 2",
        business_name: "Restaurant 2",
        business_type: "restaurant",
        password: "hashed",
      });

      const res = await request(app).put("/api/restaurant-manage/me").send({
        seller_id: seller._id.toString(),
        business_name: "Multi Update Restaurant",
        address: "789 Multi St",
        cuisine: "Mexican",
        delivery_radius_km: 7,
      });

      expect(res.status).toBe(200);
      expect(res.body.business_name).toBe("Multi Update Restaurant");
      expect(res.body.address).toBe("789 Multi St");
      expect(res.body.cuisine).toBe("Mexican");
      expect(res.body.delivery_radius_km).toBe(7);
    });

    test("3.3: should ignore non-allowed fields", async () => {
      const seller = await Seller.create({
        email: "update3@test.com",
        phone: "+1234567897",
        name: "Update Seller 3",
        business_name: "Restaurant 3",
        business_type: "restaurant",
        password: "hashed",
      });

      const res = await request(app).put("/api/restaurant-manage/me").send({
        seller_id: seller._id.toString(),
        business_name: "Updated",
        password: "hacked",
        email: "hacker@evil.com",
        role: "admin",
      });

      expect(res.status).toBe(200);
      expect(res.body.business_name).toBe("Updated");
      expect(res.body.email).toBe("update3@test.com");
    });

    test("3.4: should return 404 if seller not found", async () => {
      const fakeId = "507f1f77bcf86cd799439011";

      const res = await request(app).put("/api/restaurant-manage/me").send({
        seller_id: fakeId,
        business_name: "Updated",
      });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("seller not found");
    });

    test("3.5: should handle database errors gracefully", async () => {
      const seller = await Seller.create({
        email: "error2@test.com",
        phone: "+1234567898",
        name: "Error Seller 2",
        business_name: "Error Restaurant 2",
        business_type: "restaurant",
        password: "hashed",
      });

      // Mock findOneAndUpdate to throw error
      const originalFindOneAndUpdate = Seller.findOneAndUpdate;
      Seller.findOneAndUpdate = jest.fn(() => {
        throw new Error("Database write error");
      });

      const res = await request(app).put("/api/restaurant-manage/me").send({
        seller_id: seller._id.toString(),
        business_name: "Updated",
      });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("failed to update");

      // Restore original method
      Seller.findOneAndUpdate = originalFindOneAndUpdate;
    });
  });
});
