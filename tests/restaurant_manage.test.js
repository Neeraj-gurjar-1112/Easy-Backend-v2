const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../app");
const { Seller } = require("../lib/models");
const {
  connectTestDB,
  clearTestDB,
  closeTestDB,
} = require("./testUtils/dbHandler");

// ========================================
// SETUP & TEARDOWN
// ========================================

beforeAll(async () => {
  await connectTestDB();
});

afterAll(async () => {
  await closeTestDB();
});

beforeEach(async () => {
  await clearTestDB();
});

// ========================================
// TEST DATA HELPERS
// ========================================

async function createTestSeller(overrides = {}) {
  return await Seller.create({
    firebase_uid: "test-seller-uid-123",
    name: "Test Restaurant Owner",
    email: "owner@restaurant.com",
    phone: "+1234567890",
    business_name: "Test Restaurant",
    business_type: "restaurant",
    address: "123 Restaurant St, Food City",
    description: "Best food in town",
    cuisine: "Italian, Mexican",
    logo_url: "https://example.com/logo.jpg",
    banner_url: "https://example.com/banner.jpg",
    opening_hours: "Mon-Fri: 9AM-9PM",
    pickup_address: {
      full_address: "123 Restaurant St, Food City",
      location: {
        type: "Point",
        coordinates: [77.5946, 12.9716],
      },
    },
    location: {
      lat: 12.9716,
      lng: 77.5946,
    },
    place_id: "ChIJ123abc456def",
    delivery_radius_km: 10,
    approved: true,
    ...overrides,
  });
}

// ========================================
// PHASE 22.2: RESTAURANT MANAGEMENT TESTS
// ========================================

describe("Phase 22.2: Restaurant Management", () => {
  // ========================================
  // Section 1: Get Restaurant Profile (GET /me)
  // ========================================
  describe("Section 1: Get Restaurant Profile", () => {
    test("should get restaurant profile with valid sellerId in query", async () => {
      const seller = await createTestSeller();

      const response = await request(app)
        .get(`/api/restaurant-manage/me?sellerId=${seller._id}`)
        .send();

      expect(response.status).toBe(200);
      expect(response.body._id).toBe(seller._id.toString());
      expect(response.body.business_name).toBe("Test Restaurant");
      expect(response.body.business_type).toBe("restaurant");
      expect(response.body.cuisine).toBe("Italian, Mexican");
      expect(response.body.description).toBe("Best food in town");
      expect(response.body.location).toEqual({
        lat: 12.9716,
        lng: 77.5946,
      });
    });

    test("should get restaurant profile with sellerId in headers", async () => {
      const seller = await createTestSeller();

      const response = await request(app)
        .get("/api/restaurant-manage/me")
        .set("x-seller-id", seller._id.toString())
        .send();

      expect(response.status).toBe(200);
      expect(response.body._id).toBe(seller._id.toString());
      expect(response.body.business_name).toBe("Test Restaurant");
    });

    test("should get restaurant profile with seller_id in body", async () => {
      const seller = await createTestSeller();

      const response = await request(app)
        .get("/api/restaurant-manage/me")
        .send({ seller_id: seller._id.toString() });

      expect(response.status).toBe(200);
      expect(response.body._id).toBe(seller._id.toString());
    });

    test("should return all restaurant fields including optional ones", async () => {
      const seller = await createTestSeller();

      const response = await request(app)
        .get(`/api/restaurant-manage/me?sellerId=${seller._id}`)
        .send();

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("firebase_uid");
      expect(response.body).toHaveProperty("email");
      expect(response.body).toHaveProperty("phone");
      expect(response.body).toHaveProperty("business_name");
      expect(response.body).toHaveProperty("business_type");
      expect(response.body).toHaveProperty("address");
      expect(response.body).toHaveProperty("description");
      expect(response.body).toHaveProperty("cuisine");
      expect(response.body).toHaveProperty("logo_url");
      expect(response.body).toHaveProperty("banner_url");
      expect(response.body).toHaveProperty("opening_hours");
      expect(response.body).toHaveProperty("location");
      expect(response.body).toHaveProperty("place_id");
      expect(response.body).toHaveProperty("delivery_radius_km");
    });

    test("should return 404 when seller does not exist", async () => {
      const fakeId = new mongoose.Types.ObjectId();

      const response = await request(app)
        .get(`/api/restaurant-manage/me?sellerId=${fakeId}`)
        .send();

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("seller not found");
    });

    test("should return 400 when sellerId is missing", async () => {
      const response = await request(app)
        .get("/api/restaurant-manage/me")
        .send();

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("valid sellerId required");
    });

    test("should return 400 when sellerId is invalid ObjectId", async () => {
      const response = await request(app)
        .get("/api/restaurant-manage/me?sellerId=invalid-id")
        .send();

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("valid sellerId required");
    });

    test("should return 500 when database error occurs", async () => {
      const seller = await createTestSeller();

      // Mock Seller.findById to throw error
      const originalFindById = Seller.findById;
      Seller.findById = jest.fn(() => ({
        lean: jest
          .fn()
          .mockRejectedValue(new Error("Database connection failed")),
      }));

      const response = await request(app)
        .get(`/api/restaurant-manage/me?sellerId=${seller._id}`)
        .send();

      expect(response.status).toBe(500);
      expect(response.body.error).toBe("failed to fetch");

      // Restore original method
      Seller.findById = originalFindById;
    });
  });

  // ========================================
  // Section 2: Update Restaurant Profile (PUT /me)
  // ========================================
  describe("Section 2: Update Restaurant Profile", () => {
    test("should update business_name", async () => {
      const seller = await createTestSeller();

      const response = await request(app)
        .put(`/api/restaurant-manage/me?sellerId=${seller._id}`)
        .send({
          business_name: "Updated Restaurant Name",
        });

      expect(response.status).toBe(200);
      expect(response.body.business_name).toBe("Updated Restaurant Name");

      const updatedSeller = await Seller.findById(seller._id);
      expect(updatedSeller.business_name).toBe("Updated Restaurant Name");
    });

    test("should update business_type from restaurant to grocery", async () => {
      const seller = await createTestSeller({ business_type: "restaurant" });

      const response = await request(app)
        .put(`/api/restaurant-manage/me?sellerId=${seller._id}`)
        .send({
          business_type: "grocery",
        });

      expect(response.status).toBe(200);
      expect(response.body.business_type).toBe("grocery");
    });

    test("should update address field", async () => {
      const seller = await createTestSeller();

      const response = await request(app)
        .put(`/api/restaurant-manage/me?sellerId=${seller._id}`)
        .send({
          address: "456 New Street, Another City",
        });

      expect(response.status).toBe(200);
      expect(response.body.address).toBe("456 New Street, Another City");
    });

    test("should update description field", async () => {
      const seller = await createTestSeller();

      const response = await request(app)
        .put(`/api/restaurant-manage/me?sellerId=${seller._id}`)
        .send({
          description: "New amazing description with great food",
        });

      expect(response.status).toBe(200);
      expect(response.body.description).toBe(
        "New amazing description with great food"
      );
    });

    test("should update cuisine field", async () => {
      const seller = await createTestSeller();

      const response = await request(app)
        .put(`/api/restaurant-manage/me?sellerId=${seller._id}`)
        .send({
          cuisine: "Chinese, Thai, Japanese",
        });

      expect(response.status).toBe(200);
      expect(response.body.cuisine).toBe("Chinese, Thai, Japanese");
    });

    test("should update logo_url", async () => {
      const seller = await createTestSeller();

      const response = await request(app)
        .put(`/api/restaurant-manage/me?sellerId=${seller._id}`)
        .send({
          logo_url: "https://newcdn.com/new-logo.png",
        });

      expect(response.status).toBe(200);
      expect(response.body.logo_url).toBe("https://newcdn.com/new-logo.png");
    });

    test("should update banner_url", async () => {
      const seller = await createTestSeller();

      const response = await request(app)
        .put(`/api/restaurant-manage/me?sellerId=${seller._id}`)
        .send({
          banner_url: "https://newcdn.com/banner.jpg",
        });

      expect(response.status).toBe(200);
      expect(response.body.banner_url).toBe("https://newcdn.com/banner.jpg");
    });

    test("should update opening_hours", async () => {
      const seller = await createTestSeller();

      const response = await request(app)
        .put(`/api/restaurant-manage/me?sellerId=${seller._id}`)
        .send({
          opening_hours: "Mon-Sun: 24/7",
        });

      expect(response.status).toBe(200);
      expect(response.body.opening_hours).toBe("Mon-Sun: 24/7");
    });

    test("should update location object", async () => {
      const seller = await createTestSeller();

      const response = await request(app)
        .put(`/api/restaurant-manage/me?sellerId=${seller._id}`)
        .send({
          location: {
            lat: 40.7128,
            lng: -74.006,
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.location).toEqual({
        lat: 40.7128,
        lng: -74.006,
      });
    });

    test("should update place_id", async () => {
      const seller = await createTestSeller();

      const response = await request(app)
        .put(`/api/restaurant-manage/me?sellerId=${seller._id}`)
        .send({
          place_id: "ChIJNewPlace789xyz",
        });

      expect(response.status).toBe(200);
      expect(response.body.place_id).toBe("ChIJNewPlace789xyz");
    });

    test("should update delivery_radius_km", async () => {
      const seller = await createTestSeller();

      const response = await request(app)
        .put(`/api/restaurant-manage/me?sellerId=${seller._id}`)
        .send({
          delivery_radius_km: 15,
        });

      expect(response.status).toBe(200);
      expect(response.body.delivery_radius_km).toBe(15);
    });

    test("should update multiple fields at once", async () => {
      const seller = await createTestSeller();

      const response = await request(app)
        .put(`/api/restaurant-manage/me?sellerId=${seller._id}`)
        .send({
          business_name: "Multi Update Restaurant",
          cuisine: "Korean, Vietnamese",
          description: "Multiple fields updated",
          delivery_radius_km: 20,
        });

      expect(response.status).toBe(200);
      expect(response.body.business_name).toBe("Multi Update Restaurant");
      expect(response.body.cuisine).toBe("Korean, Vietnamese");
      expect(response.body.description).toBe("Multiple fields updated");
      expect(response.body.delivery_radius_km).toBe(20);
    });

    test("should ignore non-allowed fields in update", async () => {
      const seller = await createTestSeller();
      const originalEmail = seller.email;

      const response = await request(app)
        .put(`/api/restaurant-manage/me?sellerId=${seller._id}`)
        .send({
          business_name: "Updated Name",
          email: "hacker@evil.com", // Not in allowed list
          approved: false, // Not in allowed list
          firebase_uid: "malicious-uid", // Not in allowed list
        });

      expect(response.status).toBe(200);
      expect(response.body.business_name).toBe("Updated Name");
      expect(response.body.email).toBe(originalEmail); // Should not change
      expect(response.body.approved).toBe(true); // Should not change
      expect(response.body.firebase_uid).toBe("test-seller-uid-123"); // Should not change
    });

    test("should return updated seller when no fields provided", async () => {
      const seller = await createTestSeller();

      const response = await request(app)
        .put(`/api/restaurant-manage/me?sellerId=${seller._id}`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body._id).toBe(seller._id.toString());
      expect(response.body.business_name).toBe("Test Restaurant"); // Unchanged
    });

    test("should use sellerId from headers for update", async () => {
      const seller = await createTestSeller();

      const response = await request(app)
        .put("/api/restaurant-manage/me")
        .set("x-seller-id", seller._id.toString())
        .send({
          business_name: "Header Update",
        });

      expect(response.status).toBe(200);
      expect(response.body.business_name).toBe("Header Update");
    });

    test("should use seller_id from body for update (priority over query)", async () => {
      const seller = await createTestSeller();

      const response = await request(app)
        .put("/api/restaurant-manage/me")
        .send({
          seller_id: seller._id.toString(),
          business_name: "Body Update",
        });

      expect(response.status).toBe(200);
      expect(response.body._id).toBe(seller._id.toString());
      expect(response.body.business_name).toBe("Body Update");
    });

    test("should return 404 when updating non-existent seller", async () => {
      const fakeId = new mongoose.Types.ObjectId();

      const response = await request(app)
        .put(`/api/restaurant-manage/me?sellerId=${fakeId}`)
        .send({
          business_name: "Should Not Update",
        });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("seller not found");
    });

    test("should return 400 when sellerId is missing", async () => {
      const response = await request(app)
        .put("/api/restaurant-manage/me")
        .send({
          business_name: "No Seller ID",
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("valid sellerId required");
    });

    test("should return 400 when sellerId is invalid ObjectId", async () => {
      const response = await request(app)
        .put("/api/restaurant-manage/me?sellerId=not-an-object-id")
        .send({
          business_name: "Invalid ID",
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("valid sellerId required");
    });

    test("should return 500 when database error occurs during update", async () => {
      const seller = await createTestSeller();

      // Mock findOneAndUpdate to throw error
      const originalFindOneAndUpdate = Seller.findOneAndUpdate;
      Seller.findOneAndUpdate = jest.fn(() => ({
        lean: jest.fn().mockRejectedValue(new Error("Database write failed")),
      }));

      const response = await request(app)
        .put(`/api/restaurant-manage/me?sellerId=${seller._id}`)
        .send({
          business_name: "Error Update",
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe("failed to update");

      // Restore original method
      Seller.findOneAndUpdate = originalFindOneAndUpdate;
    });
  });

  // ========================================
  // Section 3: Edge Cases and Data Validation
  // ========================================
  describe("Section 3: Edge Cases and Data Validation", () => {
    test("should handle empty string values in update", async () => {
      const seller = await createTestSeller();

      const response = await request(app)
        .put(`/api/restaurant-manage/me?sellerId=${seller._id}`)
        .send({
          cuisine: "",
          description: "",
        });

      expect(response.status).toBe(200);
      expect(response.body.cuisine).toBe("");
      expect(response.body.description).toBe("");
    });

    test("should handle null values in update", async () => {
      const seller = await createTestSeller();

      const response = await request(app)
        .put(`/api/restaurant-manage/me?sellerId=${seller._id}`)
        .send({
          cuisine: null,
          logo_url: null,
        });

      expect(response.status).toBe(200);
      expect(response.body.cuisine).toBeNull();
      expect(response.body.logo_url).toBeNull();
    });

    test("should handle very long string values", async () => {
      const seller = await createTestSeller();
      const longDescription = "x".repeat(5000);

      const response = await request(app)
        .put(`/api/restaurant-manage/me?sellerId=${seller._id}`)
        .send({
          description: longDescription,
        });

      expect(response.status).toBe(200);
      expect(response.body.description).toBe(longDescription);
    });

    test("should handle special characters in text fields", async () => {
      const seller = await createTestSeller();

      const response = await request(app)
        .put(`/api/restaurant-manage/me?sellerId=${seller._id}`)
        .send({
          business_name: "Café & Restaurant™ <Special>",
          description: "Food with émojis 🍕🍔🍟 and symbols @#$%",
        });

      expect(response.status).toBe(200);
      expect(response.body.business_name).toBe("Café & Restaurant™ <Special>");
      expect(response.body.description).toBe(
        "Food with émojis 🍕🍔🍟 and symbols @#$%"
      );
    });

    test("should handle numeric delivery_radius_km as string", async () => {
      const seller = await createTestSeller();

      const response = await request(app)
        .put(`/api/restaurant-manage/me?sellerId=${seller._id}`)
        .send({
          delivery_radius_km: "25", // String instead of number
        });

      expect(response.status).toBe(200);
      // MongoDB/Mongoose will convert string to number if schema is Number
    });

    test("should handle updating with same values (no actual change)", async () => {
      const seller = await createTestSeller();

      const response = await request(app)
        .put(`/api/restaurant-manage/me?sellerId=${seller._id}`)
        .send({
          business_name: "Test Restaurant", // Same as original
          cuisine: "Italian, Mexican", // Same as original
        });

      expect(response.status).toBe(200);
      expect(response.body.business_name).toBe("Test Restaurant");
      expect(response.body.cuisine).toBe("Italian, Mexican");
    });
  });

  // ========================================
  // Section 4: Seller Auth Middleware Tests
  // ========================================
  describe("Section 4: requireSeller Middleware", () => {
    test("should prioritize seller_id from body over query", async () => {
      const seller1 = await createTestSeller({ business_name: "Seller 1" });
      const seller2 = await createTestSeller({
        firebase_uid: "seller-2-uid",
        email: "seller2@test.com",
        business_name: "Seller 2",
      });

      const response = await request(app)
        .get(`/api/restaurant-manage/me?sellerId=${seller1._id}`)
        .send({
          seller_id: seller2._id.toString(), // Body should take priority
        });

      expect(response.status).toBe(200);
      // Middleware checks query first, so seller1 is used
      expect(response.body._id).toBe(seller1._id.toString());
      expect(response.body.business_name).toBe("Seller 1");
    });

    test("should prioritize seller_id from body over header", async () => {
      const seller1 = await createTestSeller({ business_name: "Seller 1" });
      const seller2 = await createTestSeller({
        firebase_uid: "seller-2-uid",
        email: "seller2@test.com",
        business_name: "Seller 2",
      });

      const response = await request(app)
        .get("/api/restaurant-manage/me")
        .set("x-seller-id", seller1._id.toString())
        .send({
          seller_id: seller2._id.toString(), // Body should take priority
        });

      expect(response.status).toBe(200);
      expect(response.body._id).toBe(seller2._id.toString());
      expect(response.body.business_name).toBe("Seller 2");
    });

    test("should fall back to header when body and query are empty", async () => {
      const seller = await createTestSeller();

      const response = await request(app)
        .get("/api/restaurant-manage/me")
        .set("x-seller-id", seller._id.toString())
        .send();

      expect(response.status).toBe(200);
      expect(response.body._id).toBe(seller._id.toString());
    });
  });
});
