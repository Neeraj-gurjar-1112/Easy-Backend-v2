/**
 * Delivery agents admin API — additions made for the Next.js admin frontend:
 *  - GET  /api/admin/delivery-agents       search (q), filters (vehicle_type, approval, presence), sort, summary
 *  - GET  /api/admin/delivery-agents/summary
 *  - POST /api/admin/delivery-agents       create with Joi validation, password hashed, email unique
 *  - PATCH /api/admin/delivery-agents/:id  whitelisted fields, password re-hashed
 */
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const {
  connectTestDB,
  closeTestDB,
  clearTestDB,
} = require("./testUtils/dbHandler");
const { Admin, DeliveryAgent } = require("../lib/models");

let adminToken;

const agent = (overrides = {}) => ({
  name: "Test Agent",
  email: "test.agent@example.com",
  phone: "+91 98765 43210",
  vehicle_type: "bike",
  password: "Agent@12345",
  approved: true,
  active: true,
  available: true,
  ...overrides,
});

beforeAll(async () => {
  await connectTestDB();
}, 30000);

afterAll(async () => {
  await closeTestDB();
});

beforeEach(async () => {
  await clearTestDB();
  const admin = await Admin.create({
    email: "test.admin@example.com",
    password: "admin123456",
    role: "superadmin",
  });
  adminToken = jwt.sign(
    {
      id: admin._id,
      email: admin.email,
      role: "admin",
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    process.env.JWT_SECRET,
  );

  await DeliveryAgent.insertMany([
    agent({
      name: "Rahul Verma",
      email: "rahul@example.com",
      phone: "+91 90000 00001",
      rating: 4.8,
      completed_orders: 400,
    }),
    agent({
      name: "Priya Sharma",
      email: "priya@example.com",
      phone: "+91 90000 00002",
      vehicle_type: "scooter",
      available: false,
      rating: 4.2,
      completed_orders: 300,
    }),
    agent({
      name: "Amit Patel",
      email: "amit@example.com",
      phone: "+91 90000 00003",
      active: false,
      rating: 3.9,
      completed_orders: 200,
    }),
    agent({
      name: "Deepak Nair",
      email: "deepak@example.com",
      phone: "+91 90000 00004",
      approved: false,
      rating: 0,
      completed_orders: 0,
    }),
  ]);
});

const auth = () => ({ Authorization: `Bearer ${adminToken}` });

describe("GET /api/admin/delivery-agents — search, filters, sort, summary", () => {
  test("keeps the legacy shape and adds a summary", async () => {
    const res = await request(app)
      .get("/api/admin/delivery-agents?page=1&limit=2")
      .set(auth())
      .expect(200);
    expect(res.body.agents).toHaveLength(2);
    expect(res.body.pagination).toEqual({
      page: 1,
      limit: 2,
      total: 4,
      pages: 2,
    });
    expect(res.body.summary).toEqual({
      total: 4,
      pending: 1,
      online: 2,
      busy: 1,
      offline: 1,
      avgRating: 4.3,
    });
    expect(res.body.agents[0].password).toBeUndefined();
  });

  test("q matches name, email and phone (digits only, spaces ignored)", async () => {
    const byName = await request(app)
      .get("/api/admin/delivery-agents?q=priya")
      .set(auth())
      .expect(200);
    expect(byName.body.agents.map((a) => a.name)).toEqual(["Priya Sharma"]);

    const byPhone = await request(app)
      .get("/api/admin/delivery-agents?q=9000000003")
      .set(auth())
      .expect(200);
    expect(byPhone.body.agents.map((a) => a.name)).toEqual(["Amit Patel"]);
  });

  test("filters: vehicle_type, approval, presence", async () => {
    const scooter = await request(app)
      .get("/api/admin/delivery-agents?vehicle_type=scooter")
      .set(auth())
      .expect(200);
    expect(scooter.body.pagination.total).toBe(1);

    const pending = await request(app)
      .get("/api/admin/delivery-agents?approval=pending")
      .set(auth())
      .expect(200);
    expect(pending.body.agents.map((a) => a.name)).toEqual(["Deepak Nair"]);

    const busy = await request(app)
      .get("/api/admin/delivery-agents?presence=busy")
      .set(auth())
      .expect(200);
    expect(busy.body.agents.map((a) => a.name)).toEqual(["Priya Sharma"]);

    const offline = await request(app)
      .get("/api/admin/delivery-agents?presence=offline")
      .set(auth())
      .expect(200);
    expect(offline.body.agents.map((a) => a.name)).toEqual(["Amit Patel"]);
  });

  test("sorts by a whitelisted field and rejects unknown ones", async () => {
    const res = await request(app)
      .get("/api/admin/delivery-agents?sort=rating&order=desc")
      .set(auth())
      .expect(200);
    expect(res.body.agents.map((a) => a.name)).toEqual([
      "Rahul Verma",
      "Priya Sharma",
      "Amit Patel",
      "Deepak Nair",
    ]);

    const bad = await request(app)
      .get("/api/admin/delivery-agents?sort=password")
      .set(auth())
      .expect(400);
    expect(bad.body.error).toBe("Validation failed");
  });

  test("GET /summary returns the counters alone", async () => {
    const res = await request(app)
      .get("/api/admin/delivery-agents/summary")
      .set(auth())
      .expect(200);
    expect(res.body.total).toBe(4);
    expect(res.body.pending).toBe(1);
  });
});

describe("POST /api/admin/delivery-agents — create", () => {
  test("creates an agent, hashes the password and hides it", async () => {
    const res = await request(app)
      .post("/api/admin/delivery-agents")
      .set(auth())
      .send(agent({ email: "New.Agent@Example.com", password: "Agent@12345" }))
      .expect(201);

    expect(res.body.message).toBe("Delivery agent created");
    expect(res.body.agent.email).toBe("new.agent@example.com");
    expect(res.body.agent.password).toBeUndefined();

    const stored = await DeliveryAgent.findById(res.body.agent._id);
    expect(stored.password).not.toBe("Agent@12345");
    expect(await stored.comparePassword("Agent@12345")).toBe(true);
  });

  test("returns one message per invalid field", async () => {
    const res = await request(app)
      .post("/api/admin/delivery-agents")
      .set(auth())
      .send({
        name: "A",
        email: "not-an-email",
        phone: "12345",
        vehicle_type: "boat",
        password: "short",
      })
      .expect(400);

    expect(res.body.error).toBe("Validation failed");
    const fields = res.body.details.map((d) => d.field).sort();
    expect(fields).toEqual([
      "email",
      "name",
      "password",
      "phone",
      "vehicle_type",
    ]);
    expect(res.body.details.find((d) => d.field === "phone").message).toBe(
      "Phone must contain at least 10 digits",
    );
  });

  test("rejects a duplicate email as a field error", async () => {
    const res = await request(app)
      .post("/api/admin/delivery-agents")
      .set(auth())
      .send(agent({ email: "rahul@example.com" }))
      .expect(400);
    expect(res.body.error).toBe("Email is already registered");
    expect(res.body.details).toEqual([
      { field: "email", message: "Email is already registered" },
    ]);
  });

  test("requires a password on create (8–72 chars)", async () => {
    const missing = await request(app)
      .post("/api/admin/delivery-agents")
      .set(auth())
      .send(agent({ password: undefined }))
      .expect(400);
    expect(missing.body.details).toEqual([
      { field: "password", message: "Password is required" },
    ]);

    const tooLong = await request(app)
      .post("/api/admin/delivery-agents")
      .set(auth())
      .send(agent({ email: "long.pw@example.com", password: "x".repeat(73) }))
      .expect(400);
    expect(tooLong.body.details[0].message).toBe(
      "Password cannot exceed 72 characters",
    );
  });

  test("requires admin auth", async () => {
    await request(app)
      .post("/api/admin/delivery-agents")
      .send(agent())
      .expect(401);
  });
});

describe("PATCH /api/admin/delivery-agents/:id — update", () => {
  test("updates whitelisted fields and re-hashes a new password", async () => {
    const rahul = await DeliveryAgent.findOne({ email: "rahul@example.com" });
    const res = await request(app)
      .patch(`/api/admin/delivery-agents/${rahul._id}`)
      .set(auth())
      .send({
        name: "Rahul V.",
        available: false,
        password: "Changed@123",
        rating: 1,
      })
      .expect(200);

    expect(res.body.name).toBe("Rahul V.");
    expect(res.body.available).toBe(false);
    expect(res.body.rating).toBe(4.8); // not whitelisted → ignored
    expect(res.body.password).toBeUndefined();

    const stored = await DeliveryAgent.findById(rahul._id);
    expect(await stored.comparePassword("Changed@123")).toBe(true);
  });

  test("rejects an empty body and an invalid phone", async () => {
    const rahul = await DeliveryAgent.findOne({ email: "rahul@example.com" });
    await request(app)
      .patch(`/api/admin/delivery-agents/${rahul._id}`)
      .set(auth())
      .send({})
      .expect(400);
    const res = await request(app)
      .patch(`/api/admin/delivery-agents/${rahul._id}`)
      .set(auth())
      .send({ phone: "123" })
      .expect(400);
    expect(res.body.details[0].field).toBe("phone");
  });

  test("404 for an unknown id", async () => {
    await request(app)
      .patch("/api/admin/delivery-agents/64b000000000000000000000")
      .set(auth())
      .send({ name: "Nobody" })
      .expect(404);
  });
});
