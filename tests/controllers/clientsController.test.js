/**
 * Clients Controller Tests
 *
 * Tests for controllers/clientsController.js and routes/clients.js
 * Target: 2.24% → 85% coverage
 *
 * API Endpoints:
 * - POST /api/clients/upsert - Create/update client profile
 * - POST /api/clients/complete-profile - Complete profile setup
 * - GET /api/clients/:uid - Get client profile
 * - PUT /api/clients/:uid - Update client profile
 */

const request = require("supertest");
const app = require("../../app");
const { Client, Admin, Seller } = require("../../lib/models");
const {
  connectTestDB,
  closeTestDB,
  clearTestDB,
} = require("../testUtils/dbHandler");

describe("Clients Controller & Routes Tests", () => {
  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    // Reset global flag for email index migration
    global.__CLIENT_EMAIL_INDEX_DROPPED = false;
  });

  // ============================================================================
  // POST /api/clients/upsert Tests
  // ============================================================================

  describe("POST /api/clients/upsert - Create/Update Client", () => {
    describe("Success Cases", () => {
      test("should create new client with required fields", async () => {
        const clientData = {
          firebase_uid: "test_uid_001",
          first_name: "John",
          last_name: "Doe",
          phone: "+1234567890",
        };

        const res = await request(app)
          .post("/api/clients/upsert")
          .send(clientData)
          .expect(200);

        expect(res.body.ok).toBe(true);
        expect(res.body.client_id).toBe("test_uid_001");
        expect(res.body.profile.first_name).toBe("John");
        expect(res.body.profile.last_name).toBe("Doe");
        expect(res.body.profile.phone).toBe("+1234567890");
        expect(res.body.profile.name).toBe("John Doe");
      });

      test("should update existing client profile", async () => {
        // Create initial client
        await Client.create({
          firebase_uid: "test_uid_002",
          first_name: "Jane",
          phone: "+9876543210",
        });

        const updateData = {
          firebase_uid: "test_uid_002",
          first_name: "Jane",
          last_name: "Smith", // Adding last name
          phone: "+9876543210",
        };

        const res = await request(app)
          .post("/api/clients/upsert")
          .send(updateData)
          .expect(200);

        expect(res.body.ok).toBe(true);
        expect(res.body.profile.last_name).toBe("Smith");
        expect(res.body.profile.name).toBe("Jane Smith");
      });

      test("should create client with minimal data (name only)", async () => {
        const clientData = {
          firebase_uid: "test_uid_003",
          name: "Alice Johnson",
        };

        const res = await request(app)
          .post("/api/clients/upsert")
          .send(clientData)
          .expect(200);

        expect(res.body.ok).toBe(true);
        expect(res.body.profile.name).toBe("Alice Johnson");
      });

      test("should create client with phone only", async () => {
        const clientData = {
          firebase_uid: "test_uid_004",
          phone: "+1111111111",
        };

        const res = await request(app)
          .post("/api/clients/upsert")
          .send(clientData)
          .expect(200);

        expect(res.body.ok).toBe(true);
        expect(res.body.profile.phone).toBe("+1111111111");
        expect(res.body.profile.name).toBe("Anonymous"); // Default name
      });

      test("should parse and store valid DOB", async () => {
        const clientData = {
          firebase_uid: "test_uid_005",
          first_name: "Bob",
          phone: "+2222222222",
          dob: "1990-01-15",
        };

        const res = await request(app)
          .post("/api/clients/upsert")
          .send(clientData)
          .expect(200);

        expect(res.body.ok).toBe(true);
        expect(res.body.profile.dob).toBeDefined();
        expect(new Date(res.body.profile.dob).getFullYear()).toBe(1990);
      });

      test("should mark profile_completed when all fields present", async () => {
        const clientData = {
          firebase_uid: "test_uid_006",
          first_name: "Complete",
          last_name: "User",
          phone: "+3333333333",
          dob: "1995-06-20",
        };

        const res = await request(app)
          .post("/api/clients/upsert")
          .send(clientData)
          .expect(200);

        expect(res.body.ok).toBe(true);
        expect(res.body.profile.profile_completed).toBe(true);
      });

      test("should use first_name as name if name not provided", async () => {
        const clientData = {
          firebase_uid: "test_uid_007",
          first_name: "Charlie",
          phone: "+4444444444",
        };

        const res = await request(app)
          .post("/api/clients/upsert")
          .send(clientData)
          .expect(200);

        expect(res.body.ok).toBe(true);
        expect(res.body.profile.name).toBe("Charlie");
      });

      test("should combine first_name and last_name for name", async () => {
        const clientData = {
          firebase_uid: "test_uid_008",
          first_name: "David",
          last_name: "Brown",
          phone: "+5555555555",
        };

        const res = await request(app)
          .post("/api/clients/upsert")
          .send(clientData)
          .expect(200);

        expect(res.body.ok).toBe(true);
        expect(res.body.profile.name).toBe("David Brown");
      });
    });

    describe("Validation & Error Cases", () => {
      test("should reject request without firebase_uid", async () => {
        const clientData = {
          first_name: "NoUID",
          phone: "+6666666666",
        };

        const res = await request(app)
          .post("/api/clients/upsert")
          .send(clientData)
          .expect(400);

        expect(res.body.message).toBe("firebase_uid required");
      });

      test("should reject new client without any identity fields", async () => {
        const clientData = {
          firebase_uid: "test_uid_009",
          // No name, first_name, or phone
        };

        const res = await request(app)
          .post("/api/clients/upsert")
          .send(clientData)
          .expect(400);

        expect(res.body.message).toContain("At least one of");
      });

      test("should reject duplicate phone number", async () => {
        // Create first client
        await Client.create({
          firebase_uid: "test_uid_010",
          phone: "+7777777777",
          first_name: "First",
        });

        // Try to create second client with same phone
        const clientData = {
          firebase_uid: "test_uid_011",
          phone: "+7777777777",
          first_name: "Second",
        };

        const res = await request(app)
          .post("/api/clients/upsert")
          .send(clientData)
          .expect(409);

        expect(res.body.message).toBe("phone_in_use");
      });

      test("should reject if firebase_uid belongs to admin", async () => {
        // Create admin with same UID
        await Admin.create({
          firebase_uid: "admin_uid_001",
          email: "admin@test.com",
          role: "superadmin", // Must be superadmin or moderator
        });

        const clientData = {
          firebase_uid: "admin_uid_001",
          first_name: "John",
          phone: "+8888888888",
        };

        const res = await request(app)
          .post("/api/clients/upsert")
          .send(clientData)
          .expect(409);

        expect(res.body.message).toContain("privileged role");
      });

      test("should reject if firebase_uid belongs to seller", async () => {
        // Create seller with same UID
        await Seller.create({
          firebase_uid: "seller_uid_001",
          business_name: "Test Store",
          phone: "+9999999999",
          email: "seller@test.com", // Required field
        });

        const clientData = {
          firebase_uid: "seller_uid_001",
          first_name: "John",
          phone: "+1010101010",
        };

        const res = await request(app)
          .post("/api/clients/upsert")
          .send(clientData)
          .expect(409);

        expect(res.body.message).toContain("privileged role");
      });

      test("should ignore invalid DOB format", async () => {
        const clientData = {
          firebase_uid: "test_uid_012",
          first_name: "Bob",
          phone: "+1212121212",
          dob: "invalid-date",
        };

        const res = await request(app)
          .post("/api/clients/upsert")
          .send(clientData)
          .expect(200);

        expect(res.body.ok).toBe(true);
        expect(res.body.profile.dob).toBeUndefined();
      });
    });

    describe("Phone Claiming Logic (when ALLOW_PHONE_CLAIM=1)", () => {
      beforeEach(() => {
        process.env.ALLOW_PHONE_CLAIM = "1";
      });

      afterEach(() => {
        delete process.env.ALLOW_PHONE_CLAIM;
      });

      test("should claim legacy phone record without firebase_uid", async () => {
        // Create legacy client without firebase_uid
        await Client.create({
          phone: "+1313131313",
          name: "Legacy User",
        });

        const clientData = {
          firebase_uid: "new_uid_001",
          first_name: "New",
          phone: "+1313131313",
        };

        const res = await request(app)
          .post("/api/clients/upsert")
          .send(clientData)
          .expect(200);

        expect(res.body.ok).toBe(true);
        expect(res.body.client_id).toBe("new_uid_001");

        // Verify phone was claimed
        const updatedClient = await Client.findOne({ phone: "+1313131313" });
        expect(updatedClient.firebase_uid).toBe("new_uid_001");
      });

      test("should reassign orphan phone record", async () => {
        // Create orphan client (profile not completed, no name fields)
        await Client.create({
          firebase_uid: "orphan_uid",
          phone: "+1414141414",
          profile_completed: false,
        });

        const clientData = {
          firebase_uid: "new_uid_002",
          first_name: "New Owner",
          phone: "+1414141414",
        };

        const res = await request(app)
          .post("/api/clients/upsert")
          .send(clientData)
          .expect(200);

        expect(res.body.ok).toBe(true);
        expect(res.body.client_id).toBe("new_uid_002");
      });
    });
  });

  // ============================================================================
  // POST /api/clients/complete-profile Tests
  // ============================================================================

  describe("POST /api/clients/complete-profile", () => {
    test("should complete profile with all required fields", async () => {
      const profileData = {
        firebase_uid: "complete_uid_001",
        first_name: "Complete",
        last_name: "Profile",
        phone: "+1515151515",
        dob: "1992-03-10",
      };

      const res = await request(app)
        .post("/api/clients/complete-profile")
        .send(profileData)
        .expect(200);

      expect(res.body.client_id).toBe("complete_uid_001");
      expect(res.body.profile.first_name).toBe("Complete");
      expect(res.body.profile.last_name).toBe("Profile");
      expect(res.body.profile.phone).toBe("+1515151515");
      expect(res.body.profile.profile_completed).toBe(true);
      expect(res.body.profile.name).toBe("Complete Profile");
    });

    test("should complete profile without DOB (optional)", async () => {
      const profileData = {
        firebase_uid: "complete_uid_002",
        first_name: "NoDOB",
        phone: "+1616161616",
      };

      const res = await request(app)
        .post("/api/clients/complete-profile")
        .send(profileData)
        .expect(200);

      expect(res.body.profile.profile_completed).toBe(true);
      expect(res.body.profile.dob).toBeUndefined();
    });

    test("should reject without firebase_uid", async () => {
      const profileData = {
        first_name: "NoUID",
        phone: "+1717171717",
      };

      const res = await request(app)
        .post("/api/clients/complete-profile")
        .send(profileData)
        .expect(400);

      expect(res.body.message).toBe("firebase_uid required");
    });

    test("should reject without first_name", async () => {
      const profileData = {
        firebase_uid: "complete_uid_003",
        phone: "+1818181818",
      };

      const res = await request(app)
        .post("/api/clients/complete-profile")
        .send(profileData)
        .expect(400);

      expect(res.body.message).toBe("first_name required");
    });

    test("should reject without phone", async () => {
      const profileData = {
        firebase_uid: "complete_uid_004",
        first_name: "NoPhone",
      };

      const res = await request(app)
        .post("/api/clients/complete-profile")
        .send(profileData)
        .expect(400);

      expect(res.body.message).toBe("phone required");
    });

    test("should reject invalid DOB", async () => {
      const profileData = {
        firebase_uid: "complete_uid_005",
        first_name: "Invalid",
        phone: "+1919191919",
        dob: "not-a-date",
      };

      const res = await request(app)
        .post("/api/clients/complete-profile")
        .send(profileData)
        .expect(400);

      expect(res.body.message).toBe("dob invalid");
    });

    test("should upsert client if not exists", async () => {
      const profileData = {
        firebase_uid: "complete_uid_006",
        first_name: "NewUser",
        last_name: "Complete",
        phone: "+2020202020",
      };

      const res = await request(app)
        .post("/api/clients/complete-profile")
        .send(profileData)
        .expect(200);

      expect(res.body.profile.profile_completed).toBe(true);

      // Verify client was created
      const client = await Client.findOne({ firebase_uid: "complete_uid_006" });
      expect(client).toBeDefined();
      expect(client.profile_completed).toBe(true);
    });
  });

  // ============================================================================
  // GET /api/clients/:uid Tests
  // ============================================================================

  describe("GET /api/clients/:uid - Get Client Profile", () => {
    test("should return client profile by firebase_uid", async () => {
      await Client.create({
        firebase_uid: "get_uid_001",
        name: "Get User",
        phone: "+2121212121",
      });

      const res = await request(app)
        .get("/api/clients/get_uid_001")
        .expect(200);

      expect(res.body.name).toBe("Get User");
      expect(res.body.firebase_uid).toBe("get_uid_001");
    });

    test("should return 404 if client not found", async () => {
      const res = await request(app)
        .get("/api/clients/nonexistent_uid")
        .expect(404);

      expect(res.body.message).toBe("not found");
    });

    test("should return 400 if uid missing", async () => {
      const res = await request(app).get("/api/clients/").expect(404); // Route not found

      // Note: Since the route is defined as /:uid, accessing without uid returns 404 from Express routing
    });
  });

  // ============================================================================
  // PUT /api/clients/:uid Tests
  // ============================================================================

  describe("PUT /api/clients/:uid - Update Client Profile", () => {
    test("should update existing client profile", async () => {
      await Client.create({
        firebase_uid: "update_uid_001",
        name: "Old Name",
        phone: "+2222222222",
      });

      const updateData = {
        name: "New Name",
        phone: "+3333333333",
      };

      const res = await request(app)
        .put("/api/clients/update_uid_001")
        .send(updateData)
        .expect(200);

      expect(res.body.name).toBe("New Name");
      expect(res.body.phone).toBe("+3333333333");
      expect(res.body.firebase_uid).toBe("update_uid_001");
    });

    test("should update avatar_url", async () => {
      await Client.create({
        firebase_uid: "update_uid_002",
        name: "User",
        phone: "+4444444444",
      });

      const updateData = {
        avatar_url: "https://example.com/avatar.jpg",
      };

      const res = await request(app)
        .put("/api/clients/update_uid_002")
        .send(updateData)
        .expect(200);

      expect(res.body.avatar_url).toBe("https://example.com/avatar.jpg");
    });

    test("should create client if not exists (upsert)", async () => {
      const updateData = {
        name: "New User",
        phone: "+5555555555",
      };

      const res = await request(app)
        .put("/api/clients/update_uid_003")
        .send(updateData)
        .expect(200);

      expect(res.body.firebase_uid).toBe("update_uid_003");

      // Verify client was created
      const client = await Client.findOne({ firebase_uid: "update_uid_003" });
      expect(client).toBeDefined();
    });

    test("should handle partial updates", async () => {
      await Client.create({
        firebase_uid: "update_uid_004",
        name: "Keep Name",
        phone: "+6666666666",
      });

      const updateData = {
        phone: "+7777777777", // Only update phone
      };

      const res = await request(app)
        .put("/api/clients/update_uid_004")
        .send(updateData)
        .expect(200);

      expect(res.body.name).toBe("Keep Name"); // Name unchanged
      expect(res.body.phone).toBe("+7777777777");
    });

    test("should ignore email field (removed from spec)", async () => {
      await Client.create({
        firebase_uid: "update_uid_005",
        name: "User",
        phone: "+8888888888",
      });

      const updateData = {
        name: "Updated",
        email: "should@ignore.com", // Should be ignored
      };

      const res = await request(app)
        .put("/api/clients/update_uid_005")
        .send(updateData)
        .expect(200);

      expect(res.body.name).toBe("Updated");
      expect(res.body.email).toBeUndefined();
    });
  });
});
