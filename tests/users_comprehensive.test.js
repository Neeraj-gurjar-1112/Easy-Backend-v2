const request = require("supertest");
const { UserAddress, Client, Order, Feedback } = require("../lib/models");
const dbHandler = require("./testUtils/dbHandler");

let app;

beforeAll(async () => {
  await dbHandler.connectTestDB();
  app = require("../app");
});

afterEach(async () => {
  await UserAddress.deleteMany({});
  await Client.deleteMany({});
  await Order.deleteMany({});
  await Feedback.deleteMany({});
});

afterAll(async () => {
  await dbHandler.closeTestDB();
});

describe("Users Routes - Comprehensive Tests", () => {
  // ===========================
  // Section 1: Address CRUD Operations (8 tests)
  // ===========================
  describe("Section 1: Address CRUD Operations", () => {
    test("1.1 Should get empty array for user with no addresses", async () => {
      const response = await request(app).get(
        "/api/users/user-noaddr/addresses"
      );

      expect(response.status).toBe(200);
      expect(response.body.addresses).toEqual([]);
    });

    test("1.2 Should get all addresses for user (sorted by created_at desc)", async () => {
      const addr1 = await UserAddress.create({
        user_id: "user-multi",
        label: "Home",
        full_address: "123 Main St, NYC",
        city: "NYC",
        created_at: new Date("2024-01-01"),
      });
      const addr2 = await UserAddress.create({
        user_id: "user-multi",
        label: "Work",
        full_address: "456 Office Ave, LA",
        city: "LA",
        created_at: new Date("2024-02-01"),
      });

      const response = await request(app).get(
        "/api/users/user-multi/addresses"
      );

      expect(response.status).toBe(200);
      expect(response.body.addresses).toHaveLength(2);
      expect(response.body.addresses[0].label).toBe("Work"); // Latest first
      expect(response.body.addresses[1].label).toBe("Home");
    });

    test("1.3 Should handle database errors when fetching addresses", async () => {
      const originalFind = UserAddress.find;
      UserAddress.find = jest.fn().mockImplementation(() => {
        throw new Error("Database connection failed");
      });

      const response = await request(app).get(
        "/api/users/user-error/addresses"
      );

      expect(response.status).toBe(500);
      expect(response.body.error).toBe("Failed to fetch addresses");

      UserAddress.find = originalFind;
    });

    test("1.4 Should create new address for user", async () => {
      const addressData = {
        label: "Home",
        full_address: "789 Elm St, Boston",
        city: "Boston",
        is_default: false,
      };

      const response = await request(app)
        .post("/api/users/user-create/addresses")
        .send(addressData);

      expect(response.status).toBe(201);
      expect(response.body.user_id).toBe("user-create");
      expect(response.body.label).toBe("Home");
      expect(response.body.full_address).toBe("789 Elm St, Boston");

      const savedAddr = await UserAddress.findOne({ user_id: "user-create" });
      expect(savedAddr).toBeDefined();
      expect(savedAddr.label).toBe("Home");
    });

    test("1.5 Should create address and unset other defaults when is_default=true", async () => {
      // Create existing default address
      await UserAddress.create({
        user_id: "user-default",
        label: "Old Default",
        full_address: "111 Old St, Chicago",
        city: "Chicago",
        is_default: true,
      });

      const newDefault = {
        label: "New Default",
        full_address: "222 New St, Seattle",
        city: "Seattle",
        is_default: true,
      };

      const response = await request(app)
        .post("/api/users/user-default/addresses")
        .send(newDefault);

      expect(response.status).toBe(201);
      expect(response.body.is_default).toBe(true);

      const addresses = await UserAddress.find({ user_id: "user-default" });
      expect(addresses).toHaveLength(2);
      const defaults = addresses.filter((a) => a.is_default);
      expect(defaults).toHaveLength(1); // Only one default
      expect(defaults[0].label).toBe("New Default");
    });

    test("1.6 Should update address by addressId", async () => {
      const addr = await UserAddress.create({
        user_id: "user-update",
        label: "Home",
        full_address: "333 Update St, Denver",
        city: "Denver",
        is_default: false,
      });

      const updateData = { label: "Updated Home", city: "Boulder" };

      const response = await request(app)
        .put(`/api/users/user-update/addresses/${addr._id}`)
        .send(updateData);

      expect(response.status).toBe(200);
      expect(response.body.label).toBe("Updated Home");
      expect(response.body.city).toBe("Boulder");
      expect(response.body.full_address).toBe("333 Update St, Denver"); // Unchanged
    });

    test("1.7 Should return 404 when updating non-existent address", async () => {
      const fakeId = "507f1f77bcf86cd799439011";

      const response = await request(app)
        .put(`/api/users/user-notfound/addresses/${fakeId}`)
        .send({ label: "Test" });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("Address not found");
    });

    test("1.8 Should delete address by addressId", async () => {
      const addr = await UserAddress.create({
        user_id: "user-delete",
        label: "Temp Address",
        full_address: "444 Delete St, Phoenix",
        city: "Phoenix",
      });

      const response = await request(app).delete(
        `/api/users/user-delete/addresses/${addr._id}`
      );

      expect(response.status).toBe(200);
      expect(response.body.message).toBe("Address deleted successfully");

      const deleted = await UserAddress.findById(addr._id);
      expect(deleted).toBeNull();
    });
  });

  // ===========================
  // Section 2: Default Address Logic (5 tests)
  // ===========================
  describe("Section 2: Default Address Logic", () => {
    test("2.1 Should unset other defaults when updating address to is_default=true", async () => {
      const addr1 = await UserAddress.create({
        user_id: "user-default2",
        label: "Addr 1",
        full_address: "555 St, Miami",
        city: "Miami",
        is_default: true,
      });
      const addr2 = await UserAddress.create({
        user_id: "user-default2",
        label: "Addr 2",
        full_address: "666 St, Orlando",
        city: "Orlando",
        is_default: false,
      });

      const response = await request(app)
        .put(`/api/users/user-default2/addresses/${addr2._id}`)
        .send({ is_default: true });

      expect(response.status).toBe(200);
      expect(response.body.is_default).toBe(true);

      const addresses = await UserAddress.find({ user_id: "user-default2" });
      const defaults = addresses.filter((a) => a.is_default);
      expect(defaults).toHaveLength(1);
      expect(defaults[0]._id.toString()).toBe(addr2._id.toString());
    });

    test("2.2 Should not unset self when updating is_default=true on same address", async () => {
      const addr = await UserAddress.create({
        user_id: "user-self",
        label: "Self Default",
        full_address: "777 St, Austin",
        city: "Austin",
        is_default: true,
      });

      const response = await request(app)
        .put(`/api/users/user-self/addresses/${addr._id}`)
        .send({ label: "Updated Self", is_default: true });

      expect(response.status).toBe(200);
      expect(response.body.is_default).toBe(true);
      expect(response.body.label).toBe("Updated Self");

      const savedAddr = await UserAddress.findById(addr._id);
      expect(savedAddr.is_default).toBe(true);
    });

    test("2.3 Should allow multiple non-default addresses", async () => {
      await UserAddress.create({
        user_id: "user-multi2",
        label: "Addr A",
        full_address: "888 St, Dallas",
        city: "Dallas",
        is_default: false,
      });
      await UserAddress.create({
        user_id: "user-multi2",
        label: "Addr B",
        full_address: "999 St, Houston",
        city: "Houston",
        is_default: false,
      });

      const addresses = await UserAddress.find({ user_id: "user-multi2" });
      expect(addresses).toHaveLength(2);
      const defaults = addresses.filter((a) => a.is_default);
      expect(defaults).toHaveLength(0);
    });

    test("2.4 Should handle database errors during default address update", async () => {
      const addr = await UserAddress.create({
        user_id: "user-error2",
        label: "Test",
        full_address: "111 Error St, Portland",
        city: "Portland",
        is_default: false,
      });

      const originalUpdateMany = UserAddress.updateMany;
      UserAddress.updateMany = jest.fn().mockImplementation(() => {
        throw new Error("Database update failed");
      });

      const response = await request(app)
        .put(`/api/users/user-error2/addresses/${addr._id}`)
        .send({ is_default: true });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe("Failed to update address");

      UserAddress.updateMany = originalUpdateMany;
    });

    test("2.5 Should handle database errors when deleting address", async () => {
      const addr = await UserAddress.create({
        user_id: "user-error3",
        label: "Test",
        full_address: "222 Error St, Nashville",
        city: "Nashville",
      });

      const originalFindOneAndDelete = UserAddress.findOneAndDelete;
      UserAddress.findOneAndDelete = jest.fn().mockImplementation(() => {
        throw new Error("Database delete failed");
      });

      const response = await request(app).delete(
        `/api/users/user-error3/addresses/${addr._id}`
      );

      expect(response.status).toBe(500);
      expect(response.body.error).toBe("Failed to delete address");

      UserAddress.findOneAndDelete = originalFindOneAndDelete;
    });
  });

  // ===========================
  // Section 3: User Profile Operations (4 tests)
  // ===========================
  describe("Section 3: User Profile Operations", () => {
    test("3.1 Should get user profile by firebase_uid", async () => {
      await Client.create({
        firebase_uid: "uid-profile1",
        name: "John Doe",
        phone: "+1234567890",
      });

      const response = await request(app).get(
        "/api/users/uid-profile1/profile"
      );

      expect(response.status).toBe(200);
      expect(response.body.name).toBe("John Doe");
      expect(response.body.phone).toBe("+1234567890");
    });

    test("3.2 Should return 404 when profile not found", async () => {
      const response = await request(app).get(
        "/api/users/uid-notfound/profile"
      );

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("User not found");
    });

    test("3.3 Should update user profile (upsert)", async () => {
      await Client.create({
        firebase_uid: "uid-update1",
        name: "Jane Doe",
        phone: "+9876543210",
      });

      const updateData = { name: "Jane Smith" };

      const response = await request(app)
        .put("/api/users/uid-update1/profile")
        .send(updateData);

      expect(response.status).toBe(200);
      expect(response.body.name).toBe("Jane Smith");
      expect(response.body.phone).toBe("+9876543210"); // Unchanged
    });

    test("3.4 Should create new profile when updating non-existent user (upsert)", async () => {
      const newData = {
        name: "New User",
        phone: "+1111111111",
      };

      const response = await request(app)
        .put("/api/users/uid-newuser/profile")
        .send(newData);

      expect(response.status).toBe(200);
      expect(response.body.name).toBe("New User");
      expect(response.body.firebase_uid).toBe("uid-newuser");

      const savedClient = await Client.findOne({ firebase_uid: "uid-newuser" });
      expect(savedClient).toBeDefined();
      expect(savedClient.name).toBe("New User");
    });
  });

  // ===========================
  // Section 5: Order History & Pagination (4 tests)
  // ===========================
  describe("Section 5: Order History & Pagination", () => {
    test("5.1 Should get paginated order history (default page=1, pageSize=10)", async () => {
      // Create 15 orders for pagination testing
      for (let i = 1; i <= 15; i++) {
        await Order.create({
          client_id: "client-orders",
          order_items: [],
          payment: { amount: 100, status: "paid" },
          delivery: { delivery_address: { full_address: "Test Address" } },
          created_at: new Date(Date.now() - i * 1000 * 60), // Spread out by minutes
        });
      }

      const response = await request(app).get(
        "/api/users/client-orders/orders"
      );

      expect(response.status).toBe(200);
      expect(response.body.orders).toHaveLength(10); // Default pageSize
      expect(response.body.pagination.page).toBe(1);
      expect(response.body.pagination.pageSize).toBe(10);
      expect(response.body.pagination.total).toBe(15);
      expect(response.body.pagination.totalPages).toBe(2);
    });

    test("5.2 Should get second page of orders", async () => {
      for (let i = 1; i <= 15; i++) {
        await Order.create({
          client_id: "client-orders2",
          order_items: [],
          payment: { amount: 100, status: "paid" },
          delivery: { delivery_address: { full_address: "Test Address" } },
          created_at: new Date(Date.now() - i * 1000 * 60),
        });
      }

      const response = await request(app).get(
        "/api/users/client-orders2/orders?page=2&pageSize=10"
      );

      expect(response.status).toBe(200);
      expect(response.body.orders).toHaveLength(5); // Remaining 5 orders
      expect(response.body.pagination.page).toBe(2);
      expect(response.body.pagination.total).toBe(15);
    });

    test("5.3 Should filter orders by payment status", async () => {
      await Order.create({
        client_id: "client-filter",
        order_items: [],
        payment: { amount: 100, status: "paid" },
        delivery: { delivery_address: { full_address: "Test Address" } },
      });
      await Order.create({
        client_id: "client-filter",
        order_items: [],
        payment: { amount: 100, status: "pending" },
        delivery: { delivery_address: { full_address: "Test Address" } },
      });
      await Order.create({
        client_id: "client-filter",
        order_items: [],
        payment: { amount: 100, status: "paid" },
        delivery: { delivery_address: { full_address: "Test Address" } },
      });

      const response = await request(app).get(
        "/api/users/client-filter/orders?status=paid"
      );

      expect(response.status).toBe(200);
      expect(response.body.orders).toHaveLength(2);
      expect(response.body.pagination.total).toBe(2);
    });

    test("5.4 Should handle database errors when fetching orders", async () => {
      const originalFind = Order.find;
      Order.find = jest.fn().mockImplementation(() => {
        throw new Error("Database query failed");
      });

      const response = await request(app).get("/api/users/client-error/orders");

      expect(response.status).toBe(500);
      expect(response.body.error).toBe("Failed to fetch orders");

      Order.find = originalFind;
    });
  });

  // ===========================
  // Section 6: Feedback Submission (4 tests)
  // ===========================
  describe("Section 6: Feedback Submission", () => {
    test("6.2 Should create feedback without type (optional)", async () => {
      const feedbackData = { message: "Need help with checkout" };

      const response = await request(app)
        .post("/api/users/user-feedback2/feedback")
        .send(feedbackData);

      expect(response.status).toBe(201);
      expect(response.body.message).toBe("Need help with checkout");
      expect(response.body.type).toBe("other"); // Schema default
    });

    test("6.3 Should reject feedback with message < 3 characters", async () => {
      const feedbackData = { message: "Hi" }; // Only 2 chars

      const response = await request(app)
        .post("/api/users/user-feedback3/feedback")
        .send(feedbackData);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("message is required (min 3 chars)");
    });

    test("6.4 Should trim whitespace from message", async () => {
      const feedbackData = { message: "   Trimmed message   " };

      const response = await request(app)
        .post("/api/users/user-feedback4/feedback")
        .send(feedbackData);

      expect(response.status).toBe(201);
      expect(response.body.message).toBe("Trimmed message");

      const savedFeedback = await Feedback.findOne({
        user_id: "user-feedback4",
      });
      expect(savedFeedback.message).toBe("Trimmed message");
    });
  });

  // ========================================
  // Phase 21.3: Comprehensive Error Path & Edge Case Coverage
  // ========================================
  describe("Phase 21.3: Error Paths & Edge Cases Coverage", () => {
    // Section 1: GET Addresses - Error Handling
    describe("GET /:uid/addresses - Error Handling", () => {
      test("should handle database error when fetching addresses", async () => {
        const findSpy = jest
          .spyOn(UserAddress, "find")
          .mockImplementationOnce(() => {
            throw new Error("Database connection lost");
          });

        const response = await request(app).get(
          "/api/users/error-user/addresses"
        );

        expect(response.status).toBe(500);
        expect(response.body.error).toBe("Failed to fetch addresses");

        findSpy.mockRestore();
      });

      test("should handle sort() database error", async () => {
        const mockQuery = {
          sort: jest.fn().mockImplementationOnce(() => {
            throw new Error("Sort operation failed");
          }),
        };
        const findSpy = jest
          .spyOn(UserAddress, "find")
          .mockReturnValueOnce(mockQuery);

        const response = await request(app).get(
          "/api/users/error-user/addresses"
        );

        expect(response.status).toBe(500);
        expect(response.body.error).toBe("Failed to fetch addresses");

        findSpy.mockRestore();
      });
    });

    // Section 2: POST Addresses - Advanced Error Handling
    describe("POST /:uid/addresses - Advanced Error Handling", () => {
      test("should handle database error during updateMany (default unset)", async () => {
        const updateManySpy = jest
          .spyOn(UserAddress, "updateMany")
          .mockImplementationOnce(() => {
            throw new Error("Update operation failed");
          });

        const addressData = {
          label: "Home",
          full_address: "123 Error St",
          location: { lat: 12.9716, lng: 77.5946 },
          is_default: true,
        };

        const response = await request(app)
          .post("/api/users/error-user/addresses")
          .send(addressData);

        expect(response.status).toBe(500);
        expect(response.body.error).toBe("Failed to create address");

        updateManySpy.mockRestore();
      });

      test("should handle save() error when creating address", async () => {
        const saveSpy = jest
          .spyOn(UserAddress.prototype, "save")
          .mockImplementationOnce(() => {
            throw new Error("Save failed");
          });

        const addressData = {
          label: "Work",
          full_address: "456 Save Error Ave",
          location: { lat: 12.9716, lng: 77.5946 },
          is_default: false,
        };

        const response = await request(app)
          .post("/api/users/save-error-user/addresses")
          .send(addressData);

        expect(response.status).toBe(500);
        expect(response.body.error).toBe("Failed to create address");

        saveSpy.mockRestore();
      });

      test("should handle validation error from schema", async () => {
        const invalidAddress = {
          label: "Invalid",
          // Missing required full_address
          location: { lat: 12.9716, lng: 77.5946 },
        };

        const response = await request(app)
          .post("/api/users/validation-error-user/addresses")
          .send(invalidAddress);

        expect(response.status).toBe(500);
        expect(response.body.error).toBe("Failed to create address");
      });
    });

    // Section 3: PUT Addresses - Error Handling
    describe("PUT /:uid/addresses/:addressId - Error Handling", () => {
      test("should return 404 for non-existent address", async () => {
        const fakeAddressId = "507f1f77bcf86cd799439011";

        const response = await request(app)
          .put(`/api/users/test-user/addresses/${fakeAddressId}`)
          .send({ label: "Updated" });

        expect(response.status).toBe(404);
        expect(response.body.error).toBe("Address not found");
      });

      test("should handle database error during updateMany (default unset)", async () => {
        // Create an address first
        const address = await UserAddress.create({
          user_id: "update-error-user",
          label: "Home",
          full_address: "123 Test St",
          location: { lat: 12.9716, lng: 77.5946 },
          is_default: false,
        });

        const updateManySpy = jest
          .spyOn(UserAddress, "updateMany")
          .mockImplementationOnce(() => {
            throw new Error("UpdateMany failed");
          });

        const response = await request(app)
          .put(`/api/users/update-error-user/addresses/${address._id}`)
          .send({ is_default: true });

        expect(response.status).toBe(500);
        expect(response.body.error).toBe("Failed to update address");

        updateManySpy.mockRestore();
        await UserAddress.findByIdAndDelete(address._id);
      });

      test("should handle findOneAndUpdate database error", async () => {
        const address = await UserAddress.create({
          user_id: "find-error-user",
          label: "Work",
          full_address: "456 Work Ave",
          location: { lat: 12.9716, lng: 77.5946 },
        });

        const findOneAndUpdateSpy = jest
          .spyOn(UserAddress, "findOneAndUpdate")
          .mockImplementationOnce(() => {
            throw new Error("FindOneAndUpdate failed");
          });

        const response = await request(app)
          .put(`/api/users/find-error-user/addresses/${address._id}`)
          .send({ label: "Updated Work" });

        expect(response.status).toBe(500);
        expect(response.body.error).toBe("Failed to update address");

        findOneAndUpdateSpy.mockRestore();
        await UserAddress.findByIdAndDelete(address._id);
      });
    });

    // Section 4: DELETE Addresses - Error Handling
    describe("DELETE /:uid/addresses/:addressId - Error Handling", () => {
      test("should return 404 for non-existent address", async () => {
        const fakeAddressId = "507f1f77bcf86cd799439011";

        const response = await request(app).delete(
          `/api/users/test-user/addresses/${fakeAddressId}`
        );

        expect(response.status).toBe(404);
        expect(response.body.error).toBe("Address not found");
      });

      test("should handle findOneAndDelete database error", async () => {
        const address = await UserAddress.create({
          user_id: "delete-error-user",
          label: "Delete Test",
          full_address: "789 Delete St",
          location: { lat: 12.9716, lng: 77.5946 },
        });

        const deleteSpy = jest
          .spyOn(UserAddress, "findOneAndDelete")
          .mockImplementationOnce(() => {
            throw new Error("Delete failed");
          });

        const response = await request(app).delete(
          `/api/users/delete-error-user/addresses/${address._id}`
        );

        expect(response.status).toBe(500);
        expect(response.body.error).toBe("Failed to delete address");

        deleteSpy.mockRestore();
        await UserAddress.findByIdAndDelete(address._id);
      });
    });

    // Section 5: GET Profile - Error Handling
    describe("GET /:uid/profile - Error Handling", () => {
      test("should return 404 for non-existent user", async () => {
        const response = await request(app).get(
          "/api/users/non-existent-user/profile"
        );

        expect(response.status).toBe(404);
        expect(response.body.error).toBe("User not found");
      });

      test("should handle database error during findOne", async () => {
        const findOneSpy = jest
          .spyOn(Client, "findOne")
          .mockImplementationOnce(() => {
            throw new Error("Database query failed");
          });

        const response = await request(app).get(
          "/api/users/error-user/profile"
        );

        expect(response.status).toBe(500);
        expect(response.body.error).toBe("Failed to fetch profile");

        findOneSpy.mockRestore();
      });
    });

    // Section 6: PUT Profile - Error Handling
    describe("PUT /:uid/profile - Error Handling", () => {
      test("should handle findOneAndUpdate database error", async () => {
        const updateSpy = jest
          .spyOn(Client, "findOneAndUpdate")
          .mockImplementationOnce(() => {
            throw new Error("Update failed");
          });

        const response = await request(app)
          .put("/api/users/update-error-user/profile")
          .send({ name: "Error Test" });

        expect(response.status).toBe(500);
        expect(response.body.error).toBe("Failed to update profile");

        updateSpy.mockRestore();
      });

      test("should handle upsert with validation error", async () => {
        const updateSpy = jest
          .spyOn(Client, "findOneAndUpdate")
          .mockImplementationOnce(() => {
            const error = new Error("Validation failed");
            error.name = "ValidationError";
            throw error;
          });

        const response = await request(app)
          .put("/api/users/validation-error-user/profile")
          .send({ invalid_field: "test" });

        expect(response.status).toBe(500);
        expect(response.body.error).toBe("Failed to update profile");

        updateSpy.mockRestore();
      });
    });

    // Section 7: PUT Preferences - Error Handling
    describe("PUT /:uid/preferences - Error Handling", () => {
      test("should handle database error during preferences update", async () => {
        const updateSpy = jest
          .spyOn(Client, "findOneAndUpdate")
          .mockImplementationOnce(() => {
            throw new Error("Preferences update failed");
          });

        const response = await request(app)
          .put("/api/users/pref-error-user/preferences")
          .send({ order_status_notifications: false });

        expect(response.status).toBe(500);
        expect(response.body.error).toBe("Failed to update preferences");

        updateSpy.mockRestore();
      });

      test("should handle upsert creation for new user preferences", async () => {
        const response = await request(app)
          .put("/api/users/new-pref-user/preferences")
          .send({ order_status_notifications: true });

        expect(response.status).toBe(200);
        expect(response.body.message).toBe("Preferences updated");

        // Cleanup
        await Client.findOneAndDelete({ firebase_uid: "new-pref-user" });
      });
    });

    // Section 8: GET Orders - Error Handling
    describe("GET /:uid/orders - Error Handling", () => {
      test("should handle database error during find", async () => {
        const findSpy = jest.spyOn(Order, "find").mockImplementationOnce(() => {
          throw new Error("Database query failed");
        });

        const response = await request(app).get(
          "/api/users/order-error-user/orders"
        );

        expect(response.status).toBe(500);
        expect(response.body.error).toBe("Failed to fetch orders");

        findSpy.mockRestore();
      });

      test("should handle countDocuments database error", async () => {
        const countSpy = jest
          .spyOn(Order, "countDocuments")
          .mockImplementationOnce(() => {
            throw new Error("Count failed");
          });

        const response = await request(app).get(
          "/api/users/count-error-user/orders"
        );

        expect(response.status).toBe(500);
        expect(response.body.error).toBe("Failed to fetch orders");

        countSpy.mockRestore();
      });

      test("should handle populate() error", async () => {
        const mockQuery = {
          sort: jest.fn().mockReturnThis(),
          skip: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          populate: jest.fn().mockImplementationOnce(() => {
            throw new Error("Populate failed");
          }),
        };
        const findSpy = jest
          .spyOn(Order, "find")
          .mockReturnValueOnce(mockQuery);

        const response = await request(app).get(
          "/api/users/populate-error-user/orders"
        );

        expect(response.status).toBe(500);
        expect(response.body.error).toBe("Failed to fetch orders");

        findSpy.mockRestore();
      });

      test("should handle invalid pagination parameters gracefully", async () => {
        const response = await request(app).get(
          "/api/users/pagination-test-user/orders?page=-1&pageSize=0"
        );

        // Should still return 200 with default/corrected values
        expect(response.status).toBe(200);
        expect(response.body.pagination).toBeDefined();
      });
    });

    // Section 9: POST Feedback - Error Handling & Validation
    describe("POST /:uid/feedback - Error Handling & Validation", () => {
      test("should return 400 for empty message", async () => {
        const response = await request(app)
          .post("/api/users/feedback-user/feedback")
          .send({ message: "" });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe("message is required (min 3 chars)");
      });

      test("should return 400 for message with only whitespace", async () => {
        const response = await request(app)
          .post("/api/users/feedback-user/feedback")
          .send({ message: "   " });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe("message is required (min 3 chars)");
      });

      test("should return 400 for message shorter than 3 chars after trim", async () => {
        const response = await request(app)
          .post("/api/users/feedback-user/feedback")
          .send({ message: "  ab  " });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe("message is required (min 3 chars)");
      });

      test("should return 400 when message is missing", async () => {
        const response = await request(app)
          .post("/api/users/feedback-user/feedback")
          .send({ type: "bug" });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe("message is required (min 3 chars)");
      });

      test("should handle database error during create", async () => {
        const createSpy = jest
          .spyOn(Feedback, "create")
          .mockImplementationOnce(() => {
            throw new Error("Database create failed");
          });

        const response = await request(app)
          .post("/api/users/db-error-user/feedback")
          .send({ message: "Test feedback" });

        expect(response.status).toBe(500);
        expect(response.body.error).toBe("Failed to submit feedback");

        createSpy.mockRestore();
      });

      test("should convert non-string message to string", async () => {
        const response = await request(app)
          .post("/api/users/string-convert-user/feedback")
          .send({ message: 12345 });

        expect(response.status).toBe(201);
        expect(response.body.message).toBe("12345");

        await Feedback.findByIdAndDelete(response.body._id);
      });

      test("should handle type field correctly when provided", async () => {
        const response = await request(app)
          .post("/api/users/type-test-user/feedback")
          .send({ message: "Test with type", type: "feature" });

        expect(response.status).toBe(201);
        expect(response.body.type).toBe("feature");

        await Feedback.findByIdAndDelete(response.body._id);
      });

      test("should omit type field when not provided", async () => {
        const response = await request(app)
          .post("/api/users/no-type-user/feedback")
          .send({ message: "Test without type" });

        expect(response.status).toBe(201);
        // Type should use schema default
        expect(response.body.type).toBeDefined();

        await Feedback.findByIdAndDelete(response.body._id);
      });
    });

    // Section 10: Console Error Coverage (Production Paths)
    describe("Console Error Coverage - Production Paths", () => {
      test("should log errors in GET addresses", async () => {
        const consoleErrorSpy = jest
          .spyOn(console, "error")
          .mockImplementationOnce(() => {});
        const findSpy = jest
          .spyOn(UserAddress, "find")
          .mockImplementationOnce(() => {
            throw new Error("Test error");
          });

        await request(app).get("/api/users/console-test-user/addresses");

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          "Error fetching addresses:",
          expect.any(Error)
        );

        consoleErrorSpy.mockRestore();
        findSpy.mockRestore();
      });

      test("should log errors in POST addresses", async () => {
        const consoleErrorSpy = jest
          .spyOn(console, "error")
          .mockImplementationOnce(() => {});
        const saveSpy = jest
          .spyOn(UserAddress.prototype, "save")
          .mockImplementationOnce(() => {
            throw new Error("Test error");
          });

        await request(app)
          .post("/api/users/console-test-user/addresses")
          .send({
            label: "Test",
            full_address: "Test",
            location: { lat: 0, lng: 0 },
          });

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          "Error creating address:",
          expect.any(Error)
        );

        consoleErrorSpy.mockRestore();
        saveSpy.mockRestore();
      });

      test("should log errors in PUT addresses", async () => {
        const address = await UserAddress.create({
          user_id: "console-put-user",
          label: "Test",
          full_address: "Test St",
          location: { lat: 0, lng: 0 },
        });

        const consoleErrorSpy = jest
          .spyOn(console, "error")
          .mockImplementationOnce(() => {});
        const updateSpy = jest
          .spyOn(UserAddress, "findOneAndUpdate")
          .mockImplementationOnce(() => {
            throw new Error("Test error");
          });

        await request(app)
          .put(`/api/users/console-put-user/addresses/${address._id}`)
          .send({ label: "Updated" });

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          "Error updating address:",
          expect.any(Error)
        );

        consoleErrorSpy.mockRestore();
        updateSpy.mockRestore();
        await UserAddress.findByIdAndDelete(address._id);
      });

      test("should log errors in DELETE addresses", async () => {
        const address = await UserAddress.create({
          user_id: "console-delete-user",
          label: "Test",
          full_address: "Test St",
          location: { lat: 0, lng: 0 },
        });

        const consoleErrorSpy = jest
          .spyOn(console, "error")
          .mockImplementationOnce(() => {});
        const deleteSpy = jest
          .spyOn(UserAddress, "findOneAndDelete")
          .mockImplementationOnce(() => {
            throw new Error("Test error");
          });

        await request(app).delete(
          `/api/users/console-delete-user/addresses/${address._id}`
        );

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          "Error deleting address:",
          expect.any(Error)
        );

        consoleErrorSpy.mockRestore();
        deleteSpy.mockRestore();
        await UserAddress.findByIdAndDelete(address._id);
      });

      test("should log errors in GET profile", async () => {
        const consoleErrorSpy = jest
          .spyOn(console, "error")
          .mockImplementationOnce(() => {});
        const findSpy = jest
          .spyOn(Client, "findOne")
          .mockImplementationOnce(() => {
            throw new Error("Test error");
          });

        await request(app).get("/api/users/console-profile-user/profile");

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          "Error fetching profile:",
          expect.any(Error)
        );

        consoleErrorSpy.mockRestore();
        findSpy.mockRestore();
      });

      test("should log errors in PUT profile", async () => {
        const consoleErrorSpy = jest
          .spyOn(console, "error")
          .mockImplementationOnce(() => {});
        const updateSpy = jest
          .spyOn(Client, "findOneAndUpdate")
          .mockImplementationOnce(() => {
            throw new Error("Test error");
          });

        await request(app)
          .put("/api/users/console-put-profile-user/profile")
          .send({ name: "Test" });

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          "Error updating profile:",
          expect.any(Error)
        );

        consoleErrorSpy.mockRestore();
        updateSpy.mockRestore();
      });

      test("should log errors in PUT preferences", async () => {
        const consoleErrorSpy = jest
          .spyOn(console, "error")
          .mockImplementationOnce(() => {});
        const updateSpy = jest
          .spyOn(Client, "findOneAndUpdate")
          .mockImplementationOnce(() => {
            throw new Error("Test error");
          });

        await request(app)
          .put("/api/users/console-pref-user/preferences")
          .send({ order_status_notifications: true });

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          "Error updating preferences:",
          expect.any(Error)
        );

        consoleErrorSpy.mockRestore();
        updateSpy.mockRestore();
      });

      test("should log errors in GET orders", async () => {
        const consoleErrorSpy = jest
          .spyOn(console, "error")
          .mockImplementationOnce(() => {});
        const findSpy = jest.spyOn(Order, "find").mockImplementationOnce(() => {
          throw new Error("Test error");
        });

        await request(app).get("/api/users/console-orders-user/orders");

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          "Error fetching orders:",
          expect.any(Error)
        );

        consoleErrorSpy.mockRestore();
        findSpy.mockRestore();
      });

      test("should log errors in POST feedback", async () => {
        const consoleErrorSpy = jest
          .spyOn(console, "error")
          .mockImplementationOnce(() => {});
        const createSpy = jest
          .spyOn(Feedback, "create")
          .mockImplementationOnce(() => {
            throw new Error("Test error");
          });

        await request(app)
          .post("/api/users/console-feedback-user/feedback")
          .send({ message: "Test feedback" });

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          "Error creating feedback:",
          expect.any(Error)
        );

        consoleErrorSpy.mockRestore();
        createSpy.mockRestore();
      });
    });
  });
});
