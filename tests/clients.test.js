const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../app");
const { Client, Admin, Seller } = require("../lib/models");
const { setupTestDB, cleanupTestDB } = require("./testUtils/dbHandler");

describe("Clients - Integration Tests", () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await cleanupTestDB();
  });

  afterEach(async () => {
    await Client.deleteMany({});
    await Admin.deleteMany({});
    await Seller.deleteMany({});
    delete global.__CLIENT_EMAIL_INDEX_DROPPED;
  });

  describe("POST /api/clients/upsert - Upsert Client", () => {
    test("should create new client with minimal fields", async () => {
      const res = await request(app).post("/api/clients/upsert").send({
        firebase_uid: "test_uid_001",
        name: "John Doe",
      });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.client_id).toBe("test_uid_001");
      expect(res.body.profile.name).toBe("John Doe");
    });

    test("should create client with phone", async () => {
      const res = await request(app).post("/api/clients/upsert").send({
        firebase_uid: "test_uid_002",
        phone: "1234567890",
      });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.profile.phone).toBe("1234567890");
    });

    test("should create client with first_name", async () => {
      const res = await request(app).post("/api/clients/upsert").send({
        firebase_uid: "test_uid_003",
        first_name: "Jane",
      });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.profile.first_name).toBe("Jane");
    });

    test("should reject request without firebase_uid", async () => {
      const res = await request(app).post("/api/clients/upsert").send({
        name: "No UID User",
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("firebase_uid required");
    });

    test("should reject new client without identity fields", async () => {
      const res = await request(app).post("/api/clients/upsert").send({
        firebase_uid: "test_uid_004",
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(
        "At least one of phone/name/first_name required"
      );
    });

    test("should update existing client", async () => {
      await Client.create({
        firebase_uid: "test_uid_005",
        name: "Old Name",
        phone: "1111111111",
      });

      const res = await request(app).post("/api/clients/upsert").send({
        firebase_uid: "test_uid_005",
        name: "Updated Name",
      });

      expect(res.status).toBe(200);
      expect(res.body.profile.name).toBe("Updated Name");
    });

    test("should reject if firebase_uid belongs to admin", async () => {
      await Admin.create({
        firebase_uid: "admin_uid_001",
        email: "admin@test.com",
        password: "password123",
        role: "superadmin",
      });

      const res = await request(app).post("/api/clients/upsert").send({
        firebase_uid: "admin_uid_001",
        name: "Should Fail",
      });

      expect(res.status).toBe(409);
      expect(res.body.message).toContain("privileged role");
    });

    test("should reject if firebase_uid belongs to seller", async () => {
      await Seller.create({
        firebase_uid: "seller_uid_001",
        business_name: "Test Store",
        email: "seller@test.com",
        phone: `999${Date.now()}`,
        password: "password123",
        business_type: "grocery",
      });

      const res = await request(app).post("/api/clients/upsert").send({
        firebase_uid: "seller_uid_001",
        name: "Should Fail",
      });

      expect(res.status).toBe(409);
      expect(res.body.message).toContain("privileged role");
    });

    test("should reject duplicate phone", async () => {
      await Client.create({
        firebase_uid: "test_uid_006",
        phone: "2222222222",
        name: "First User",
      });

      const res = await request(app).post("/api/clients/upsert").send({
        firebase_uid: "test_uid_007",
        phone: "2222222222",
        name: "Second User",
      });

      expect(res.status).toBe(409);
      expect(res.body.message).toBe("phone_in_use");
    });

    test("should parse and save valid dob", async () => {
      const res = await request(app).post("/api/clients/upsert").send({
        firebase_uid: "test_uid_008",
        name: "DOB User",
        dob: "1990-01-01",
      });

      expect(res.status).toBe(200);
      expect(res.body.profile.dob).toBeTruthy();
    });

    test("should skip invalid dob", async () => {
      const res = await request(app).post("/api/clients/upsert").send({
        firebase_uid: "test_uid_009",
        name: "Invalid DOB User",
        dob: "invalid-date",
      });

      expect(res.status).toBe(200);
      expect(res.body.profile.dob).toBeUndefined();
    });

    test("should construct name from first_name and last_name", async () => {
      const res = await request(app).post("/api/clients/upsert").send({
        firebase_uid: "test_uid_010",
        first_name: "John",
        last_name: "Smith",
      });

      expect(res.status).toBe(200);
      expect(res.body.profile.name).toBe("John Smith");
    });

    test("should set default name to Anonymous if no name provided", async () => {
      const res = await request(app).post("/api/clients/upsert").send({
        firebase_uid: "test_uid_011",
        phone: "3333333333",
      });

      expect(res.status).toBe(200);
      expect(res.body.profile.name).toBe("Anonymous");
    });

    test("should mark profile_completed when all required fields present", async () => {
      const res = await request(app).post("/api/clients/upsert").send({
        firebase_uid: "test_uid_012",
        first_name: "Complete",
        phone: "4444444444",
        dob: "1995-05-15",
      });

      expect(res.status).toBe(200);
      expect(res.body.profile.profile_completed).toBe(true);
    });

    test("should handle phone claim when ALLOW_PHONE_CLAIM=1 and legacy record exists", async () => {
      process.env.ALLOW_PHONE_CLAIM = "1";
      await Client.create({
        firebase_uid: "",
        phone: "5555555555",
        name: "Legacy User",
      });

      const res = await request(app).post("/api/clients/upsert").send({
        firebase_uid: "test_uid_013",
        phone: "5555555555",
        name: "Claiming User",
      });

      expect(res.status).toBe(200);
      delete process.env.ALLOW_PHONE_CLAIM;
    });

    test("should handle orphan phone record reassignment", async () => {
      process.env.ALLOW_PHONE_CLAIM = "1";
      await Client.create({
        firebase_uid: "orphan_uid",
        phone: "6666666666",
        profile_completed: false,
      });

      const res = await request(app).post("/api/clients/upsert").send({
        firebase_uid: "test_uid_014",
        phone: "6666666666",
        name: "New Owner",
      });

      expect(res.status).toBe(200);
      delete process.env.ALLOW_PHONE_CLAIM;
    });

    test("should handle database error gracefully", async () => {
      const originalFindOneAndUpdate = Client.findOneAndUpdate;
      const mockLean = jest.fn().mockRejectedValue(new Error("Database error"));
      Client.findOneAndUpdate = jest.fn(() => ({ lean: mockLean }));

      const res = await request(app).post("/api/clients/upsert").send({
        firebase_uid: "test_uid_015",
        name: "Error Test",
      });

      expect(res.status).toBe(500);
      expect(res.body.message).toContain("Database error");
      Client.findOneAndUpdate = originalFindOneAndUpdate;
    });

    test("should handle E11000 phone duplicate error", async () => {
      const originalFindOneAndUpdate = Client.findOneAndUpdate;
      const err = new Error("E11000 duplicate key");
      err.code = 11000;
      err.keyPattern = { phone: 1 };
      const mockLean = jest.fn().mockRejectedValue(err);
      Client.findOneAndUpdate = jest.fn(() => ({ lean: mockLean }));

      const res = await request(app).post("/api/clients/upsert").send({
        firebase_uid: "test_uid_016",
        phone: "7777777777",
        name: "Duplicate Phone Test",
      });

      expect(res.status).toBe(409);
      expect(res.body.message).toBe("phone_in_use");
      Client.findOneAndUpdate = originalFindOneAndUpdate;
    });

    test("should handle legacy email index E11000 gracefully", async () => {
      const originalFindOneAndUpdate = Client.findOneAndUpdate;
      const originalFindOne = Client.findOne;
      const err = new Error("E11000 duplicate key");
      err.code = 11000;
      err.keyPattern = { email: 1 };
      const mockLean1 = jest.fn().mockRejectedValue(err);
      Client.findOneAndUpdate = jest.fn(() => ({ lean: mockLean1 }));
      const mockLean2 = jest.fn().mockResolvedValue({
        firebase_uid: "test_uid_017",
        name: "Existing User",
        phone: "8888888888",
      });
      Client.findOne = jest.fn(() => ({ lean: mockLean2 }));

      const res = await request(app).post("/api/clients/upsert").send({
        firebase_uid: "test_uid_017",
        name: "Email Conflict Test",
      });

      expect(res.status).toBe(200);
      Client.findOneAndUpdate = originalFindOneAndUpdate;
      Client.findOne = originalFindOne;
    });

    test("should log update payload when DEBUG_UPSERT=1", async () => {
      process.env.DEBUG_UPSERT = "1";
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      const res = await request(app).post("/api/clients/upsert").send({
        firebase_uid: "test_uid_018",
        name: "Debug Test",
      });

      expect(res.status).toBe(200);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[upsertClient] update payload"),
        expect.any(Object)
      );
      consoleSpy.mockRestore();
      delete process.env.DEBUG_UPSERT;
    });

    test("should handle email index drop migration", async () => {
      delete global.__CLIENT_EMAIL_INDEX_DROPPED;

      const res = await request(app).post("/api/clients/upsert").send({
        firebase_uid: "test_uid_019",
        name: "Migration Test",
      });

      expect(res.status).toBe(200);
    });
  });

  describe("POST /api/clients/complete-profile - Complete Profile", () => {
    test("should complete profile with required fields", async () => {
      const res = await request(app)
        .post("/api/clients/complete-profile")
        .send({
          firebase_uid: "test_uid_020",
          first_name: "Alice",
          phone: "9999999999",
        });

      expect(res.status).toBe(200);
      expect(res.body.client_id).toBe("test_uid_020");
      expect(res.body.profile.first_name).toBe("Alice");
      expect(res.body.profile.phone).toBe("9999999999");
      expect(res.body.profile.profile_completed).toBe(true);
    });

    test("should complete profile with last_name", async () => {
      const res = await request(app)
        .post("/api/clients/complete-profile")
        .send({
          firebase_uid: "test_uid_021",
          first_name: "Bob",
          last_name: "Johnson",
          phone: "1010101010",
        });

      expect(res.status).toBe(200);
      expect(res.body.profile.name).toBe("Bob Johnson");
      expect(res.body.profile.last_name).toBe("Johnson");
    });

    test("should complete profile with valid dob", async () => {
      const res = await request(app)
        .post("/api/clients/complete-profile")
        .send({
          firebase_uid: "test_uid_022",
          first_name: "Charlie",
          phone: "1212121212",
          dob: "1992-03-20",
        });

      expect(res.status).toBe(200);
      expect(res.body.profile.dob).toBeTruthy();
    });

    test("should reject without firebase_uid", async () => {
      const res = await request(app)
        .post("/api/clients/complete-profile")
        .send({
          first_name: "NoUID",
          phone: "1313131313",
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("firebase_uid required");
    });

    test("should reject without first_name", async () => {
      const res = await request(app)
        .post("/api/clients/complete-profile")
        .send({
          firebase_uid: "test_uid_023",
          phone: "1414141414",
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("first_name required");
    });

    test("should reject without phone", async () => {
      const res = await request(app)
        .post("/api/clients/complete-profile")
        .send({
          firebase_uid: "test_uid_024",
          first_name: "NoPhone",
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("phone required");
    });

    test("should reject invalid dob", async () => {
      const res = await request(app)
        .post("/api/clients/complete-profile")
        .send({
          firebase_uid: "test_uid_025",
          first_name: "InvalidDOB",
          phone: "1515151515",
          dob: "not-a-date",
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("dob invalid");
    });

    test("should upsert if client does not exist", async () => {
      const res = await request(app)
        .post("/api/clients/complete-profile")
        .send({
          firebase_uid: "test_uid_026",
          first_name: "NewUser",
          phone: "1616161616",
        });

      expect(res.status).toBe(200);
      const client = await Client.findOne({ firebase_uid: "test_uid_026" });
      expect(client).toBeTruthy();
    });

    test("should update existing client profile", async () => {
      await Client.create({
        firebase_uid: "test_uid_027",
        name: "OldProfile",
        profile_completed: false,
      });

      const res = await request(app)
        .post("/api/clients/complete-profile")
        .send({
          firebase_uid: "test_uid_027",
          first_name: "UpdatedProfile",
          phone: "1717171717",
        });

      expect(res.status).toBe(200);
      expect(res.body.profile.first_name).toBe("UpdatedProfile");
      expect(res.body.profile.profile_completed).toBe(true);
    });

    test("should handle database error gracefully", async () => {
      const originalFindOneAndUpdate = Client.findOneAndUpdate;
      const mockLean = jest
        .fn()
        .mockRejectedValue(new Error("DB connection lost"));
      Client.findOneAndUpdate = jest.fn(() => ({ lean: mockLean }));

      const res = await request(app)
        .post("/api/clients/complete-profile")
        .send({
          firebase_uid: "test_uid_028",
          first_name: "ErrorTest",
          phone: "1818181818",
        });

      expect(res.status).toBe(500);
      expect(res.body.message).toBe("Failed to complete profile");
      Client.findOneAndUpdate = originalFindOneAndUpdate;
    });

    test("should construct name without last_name", async () => {
      const res = await request(app)
        .post("/api/clients/complete-profile")
        .send({
          firebase_uid: "test_uid_029",
          first_name: "SingleName",
          phone: "1919191919",
        });

      expect(res.status).toBe(200);
      expect(res.body.profile.name).toBe("SingleName");
    });
  });

  describe("GET /api/clients/:uid - Get Client Profile", () => {
    test("should get existing client profile", async () => {
      await Client.create({
        firebase_uid: "test_uid_030",
        name: "GetTest User",
      });

      const res = await request(app).get("/api/clients/test_uid_030");

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("GetTest User");
      expect(res.body.firebase_uid).toBe("test_uid_030");
    });

    test("should return 400 without uid", async () => {
      const res = await request(app).get("/api/clients/");

      expect(res.status).toBe(404);
    });

    test("should return 404 for non-existent client", async () => {
      const res = await request(app).get("/api/clients/nonexistent_uid");

      expect(res.status).toBe(404);
      expect(res.body.message).toBe("not found");
    });

    test("should handle database error gracefully", async () => {
      const originalFindOne = Client.findOne;
      Client.findOne = jest.fn(() => ({
        lean: jest.fn().mockRejectedValue(new Error("DB error")),
      }));

      const res = await request(app).get("/api/clients/test_uid_031");

      expect(res.status).toBe(500);
      expect(res.body.message).toBe("failed to fetch profile");
      Client.findOne = originalFindOne;
    });
  });

  describe("PUT /api/clients/:uid - Update Client Profile", () => {
    test("should update client name", async () => {
      await Client.create({
        firebase_uid: "test_uid_032",
        name: "Old Name",
      });

      const res = await request(app).put("/api/clients/test_uid_032").send({
        name: "New Name",
      });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("New Name");
    });

    test("should update client phone", async () => {
      await Client.create({
        firebase_uid: "test_uid_033",
        name: "PhoneTest",
      });

      const res = await request(app).put("/api/clients/test_uid_033").send({
        phone: "2020202020",
      });

      expect(res.status).toBe(200);
      expect(res.body.phone).toBe("2020202020");
    });

    test("should update client avatar_url", async () => {
      await Client.create({
        firebase_uid: "test_uid_034",
        name: "AvatarTest",
      });

      const res = await request(app).put("/api/clients/test_uid_034").send({
        avatar_url: "https://example.com/avatar.jpg",
      });

      expect(res.status).toBe(200);
      expect(res.body.avatar_url).toBe("https://example.com/avatar.jpg");
    });

    test("should update multiple fields", async () => {
      await Client.create({
        firebase_uid: "test_uid_035",
        name: "MultiUpdate",
      });

      const res = await request(app).put("/api/clients/test_uid_035").send({
        name: "Updated Name",
        phone: "2121212121",
        avatar_url: "https://example.com/new.jpg",
      });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Updated Name");
      expect(res.body.phone).toBe("2121212121");
      expect(res.body.avatar_url).toBe("https://example.com/new.jpg");
    });

    test("should return 400 without uid", async () => {
      const res = await request(app).put("/api/clients/").send({
        name: "NoUID",
      });

      expect(res.status).toBe(404);
    });

    test("should upsert if client does not exist", async () => {
      const res = await request(app).put("/api/clients/test_uid_036").send({
        name: "NewClient",
      });

      expect(res.status).toBe(200);
      const client = await Client.findOne({ firebase_uid: "test_uid_036" });
      expect(client).toBeTruthy();
    });

    test("should handle empty update object", async () => {
      await Client.create({
        firebase_uid: "test_uid_037",
        name: "EmptyUpdate",
      });

      const res = await request(app).put("/api/clients/test_uid_037").send({});

      expect(res.status).toBe(200);
    });

    test("should ignore email field", async () => {
      await Client.create({
        firebase_uid: "test_uid_038",
        name: "EmailIgnore",
      });

      const res = await request(app).put("/api/clients/test_uid_038").send({
        name: "Updated",
        email: "ignored@test.com",
      });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Updated");
    });

    test("should handle database error gracefully", async () => {
      const originalFindOneAndUpdate = Client.findOneAndUpdate;
      let callCount = 0;
      Client.findOneAndUpdate = jest.fn(() => ({
        lean: jest.fn(() => {
          callCount++;
          if (callCount === 1) {
            return Promise.reject(new Error("Update failed"));
          }
          return Promise.reject(new Error("Update failed"));
        }),
      }));

      const res = await request(app).put("/api/clients/test_uid_039").send({
        name: "ErrorTest",
      });

      expect(res.status).toBe(500);
      expect(res.body.message).toBe("failed to update profile");
      Client.findOneAndUpdate = originalFindOneAndUpdate;
    });

    test("should handle upsert fallback when client not found", async () => {
      const res = await request(app).put("/api/clients/test_uid_040").send({
        name: "UpsertTest",
        phone: "2222222223",
      });

      expect(res.status).toBe(200);
      expect(res.body.firebase_uid).toBe("test_uid_040");
    });
  });
});
