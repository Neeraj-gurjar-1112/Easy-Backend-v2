const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../app");
const { Admin, Seller, Product, PlatformSettings } = require("../lib/models");
const { setupTestDB, cleanupTestDB } = require("./testUtils/dbHandler");
const jwt = require("jsonwebtoken");

describe("Restaurant Delivery Fee API & Calculation", () => {
  let adminToken;
  let testSeller;

  beforeAll(async () => {
    await setupTestDB();

    const admin = await Admin.findOne({ email: "admin_test_fee@example.com" }) ||
      await Admin.create({
        email: "admin_test_fee@example.com",
        password: "password123",
        role: "superadmin",
      });

    adminToken = jwt.sign(
      { id: admin._id, role: "admin", email: admin.email },
      process.env.JWT_SECRET || "test-jwt-secret-key-12345",
      { expiresIn: "1h" }
    );
  });

  afterAll(async () => {
    if (testSeller?._id) {
      await Seller.findByIdAndDelete(testSeller._id);
    }
    await Admin.deleteMany({ email: "admin_test_fee@example.com" });
    await cleanupTestDB();
  });

  test("POST /api/admin/sellers - should create a seller with custom delivery_fee", async () => {
    const res = await request(app)
      .post("/api/admin/sellers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        business_name: "Gourmet Bistro",
        email: "gourmet_bistro_fee_test@example.com",
        phone: "12345678901",
        business_type: "restaurant",
        address: "123 Main St",
        location: { lat: 12.9716, lng: 77.5946 },
        delivery_fee: 45,
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("_id");
    expect(res.body.delivery_fee).toBe(45);
    testSeller = res.body;
  });

  test("PATCH /api/admin/sellers/:id - should update delivery_fee", async () => {
    const res = await request(app)
      .patch(`/api/admin/sellers/${testSeller._id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        delivery_fee: 55,
      });

    expect(res.status).toBe(200);
    expect(res.body.delivery_fee).toBe(55);
  });

  test("GET /api/admin/sellers/:sellerId - should return seller with delivery_fee", async () => {
    const res = await request(app)
      .get(`/api/admin/sellers/${testSeller._id}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.seller.delivery_fee).toBe(55);
  });

  test("POST /api/products/quote - should apply seller custom delivery fee", async () => {
    const product = await Product.create({
      name: "Special Burger",
      price: 50,
      category: "Restaurant Food",
      seller_id: testSeller._id,
      status: "active",
      stock: 100,
    });

    const res = await request(app)
      .post("/api/products/quote")
      .send({
        items: [{ product_id: product._id.toString(), qty: 1 }],
      });

    expect(res.status).toBe(200);
    expect(res.body.delivery_charge).toBe(55);

    await Product.findByIdAndDelete(product._id);
  });
});
