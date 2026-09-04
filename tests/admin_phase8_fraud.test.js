/**
 * PHASE 8: Fraud Detection Tests
 *
 * Tests for admin fraud detection and alert system endpoints
 * Covers:
 * - GET /api/admin/fraud/signals - Detect suspicious patterns
 * - POST /api/admin/alerts/evaluate - Auto-generate alerts
 * - GET /api/admin/alerts - List alerts with filters
 * - POST /api/admin/alerts/:id/ack - Acknowledge alerts
 */

const request = require("supertest");
const app = require("../app");
const {
  connectTestDB,
  clearTestDB,
  closeTestDB,
} = require("./testUtils/dbHandler");
const { Order, Client, Alert, PlatformSettings } = require("../lib/models");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

describe("PHASE 8: Fraud Detection & Alerts", () => {
  let adminToken;

  // Helper function to create minimal valid order
  const createTestOrder = (data) => {
    return Order.create({
      client_id: data.client_id,
      status: data.status || "delivered",
      order_items: data.order_items || [
        { qty: 1, price_snapshot: data.payment.amount },
      ],
      delivery: data.delivery || {
        delivery_status: data.status === "refunded" ? "cancelled" : "delivered",
        delivery_address: { full_address: "Test St" },
      },
      payment: data.payment,
      created_at: data.created_at || new Date(),
    });
  };

  beforeAll(async () => {
    await connectTestDB();

    // Create admin token
    adminToken = jwt.sign(
      { uid: "admin_test_uid", role: "admin" },
      process.env.JWT_SECRET || "test_secret",
      { expiresIn: "1h" }
    );
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();

    // Create platform settings
    await PlatformSettings.create({
      coupons: [],
      delivery_fees: {
        grocery: { base_fee: 30, free_delivery_threshold: 500 },
        food: { base_fee: 50, free_delivery_threshold: 300 },
      },
      commission_rates: {
        grocery: 0.1,
        food: 0.15,
      },
    });
  });

  // =========================
  // 1. Fraud Signals Detection
  // =========================
  describe("Fraud Signals (GET /api/admin/fraud/signals)", () => {
    test("should detect rapid fire orders (3+ orders within 10 minutes)", async () => {
      const client = await Client.create({
        firebase_uid: "rapid_fire_client",
        name: "Rapid Fire User",
        email: "rapid@test.com",
        phone: "9999999999",
      });

      // Use a fixed time 1 hour ago to avoid timing issues with API query
      const baseTime = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
      // Create 3 orders within 5 minutes
      await createTestOrder({
        client_id: client.firebase_uid,
        payment: { amount: 100, method: "COD", status: "paid" },
        created_at: new Date(baseTime.getTime()),
      });
      await createTestOrder({
        client_id: client.firebase_uid,
        payment: { amount: 150, method: "COD", status: "paid" },
        created_at: new Date(baseTime.getTime() + 3 * 60 * 1000), // +3 min
      });
      await createTestOrder({
        client_id: client.firebase_uid,
        payment: { amount: 200, method: "COD", status: "paid" },
        created_at: new Date(baseTime.getTime() + 5 * 60 * 1000), // +5 min
      });

      const response = await request(app)
        .get("/api/admin/fraud/signals")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.signals).toBeDefined();
      const rapidSignal = response.body.signals.find(
        (s) => s.type === "rapid_orders"
      );
      expect(rapidSignal).toBeDefined();
      expect(rapidSignal.client_id).toBe(client.firebase_uid);
      expect(rapidSignal.count).toBe(3);
    });

    test("should detect high COD amount orders (>2000)", async () => {
      const client = await Client.create({
        firebase_uid: "high_cod_client",
        name: "High COD User",
        email: "highcod@test.com",
        phone: "8888888888",
      });

      await Order.create({
        client_id: client.firebase_uid,
        status: "delivered",
        delivery: {
          delivery_status: "delivered",
          delivery_address: { full_address: "Test St" },
        },
        payment: { amount: 2500, method: "COD", status: "paid" },
      });

      const response = await request(app)
        .get("/api/admin/fraud/signals")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      const codSignal = response.body.signals.find(
        (s) => s.type === "high_cod_amount"
      );
      expect(codSignal).toBeDefined();
      expect(codSignal.amount).toBe(2500);
      expect(codSignal.client_id).toBe(client.firebase_uid);
    });

    test("should detect high refund rate (>40% refunded)", async () => {
      const client = await Client.create({
        firebase_uid: "refund_client",
        name: "Refund User",
        email: "refund@test.com",
        phone: "7777777777",
      });

      // Create 5 orders: 3 refunded, 2 delivered (60% refund rate)
      for (let i = 0; i < 3; i++) {
        await Order.create({
          client_id: client.firebase_uid,
          status: "refunded",
          delivery: {
            delivery_status: "cancelled",
            delivery_address: { full_address: "Test St" },
          },
          payment: { amount: 100, method: "COD", status: "failed" },
        });
      }
      for (let i = 0; i < 2; i++) {
        await Order.create({
          client_id: client.firebase_uid,
          status: "delivered",
          delivery: {
            delivery_status: "delivered",
            delivery_address: { full_address: "Test St" },
          },
          payment: { amount: 100, method: "COD", status: "paid" },
        });
      }

      const response = await request(app)
        .get("/api/admin/fraud/signals")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      const refundSignal = response.body.signals.find(
        (s) => s.type === "high_refund_rate"
      );
      expect(refundSignal).toBeDefined();
      expect(refundSignal.refunded).toBe(3);
      expect(refundSignal.total).toBe(5);
      expect(refundSignal.client_id).toBe(client.firebase_uid);
    });

    test("should filter signals by date range", async () => {
      const client = await Client.create({
        firebase_uid: "date_filter_client",
        name: "Date Filter User",
        email: "datefilter@test.com",
        phone: "6666666666",
      });

      const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
      await Order.create({
        client_id: client.firebase_uid,
        status: "delivered",
        delivery: {
          delivery_status: "delivered",
          delivery_address: { full_address: "Test St" },
        },
        payment: { amount: 3000, method: "COD", status: "paid" },
        created_at: oldDate,
      });

      const recentDate = new Date();
      await Order.create({
        client_id: client.firebase_uid,
        status: "delivered",
        delivery: {
          delivery_status: "delivered",
          delivery_address: { full_address: "Test St" },
        },
        payment: { amount: 2500, method: "COD", status: "paid" },
        created_at: recentDate,
      });

      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const response = await request(app)
        .get("/api/admin/fraud/signals")
        .query({
          from: yesterday.toISOString(),
          to: new Date().toISOString(),
        })
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      // Should only detect recent high COD (2500), not old one (3000)
      const codSignals = response.body.signals.filter(
        (s) => s.type === "high_cod_amount"
      );
      expect(codSignals.length).toBe(1);
      expect(codSignals[0].amount).toBe(2500);
    });

    test("should return empty signals when no fraud detected", async () => {
      const client = await Client.create({
        firebase_uid: "clean_client",
        name: "Clean User",
        email: "clean@test.com",
        phone: "5555555555",
      });

      await Order.create({
        client_id: client.firebase_uid,
        status: "delivered",
        delivery: {
          delivery_status: "delivered",
          delivery_address: { full_address: "Test St" },
        },
        payment: { amount: 500, method: "COD", status: "paid" },
      });

      const response = await request(app)
        .get("/api/admin/fraud/signals")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.signals).toEqual([]);
      expect(response.body.totalSignals).toBe(0);
    });

    test("should require admin authentication", async () => {
      await request(app).get("/api/admin/fraud/signals").expect(401);
    });
  });

  // =========================
  // 2. Automated Alerts
  // =========================
  describe("Alert Evaluation (POST /api/admin/alerts/evaluate)", () => {
    test("should generate revenue drop alert when revenue drops >40%", async () => {
      const client = await Client.create({
        firebase_uid: "revenue_client",
        name: "Revenue User",
        email: "revenue@test.com",
        phone: "4444444444",
      });

      // Create orders yesterday (high revenue)
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      for (let i = 0; i < 5; i++) {
        await Order.create({
          client_id: client.firebase_uid,
          status: "delivered",
          delivery: {
            delivery_status: "delivered",
            delivery_address: { full_address: "Test St" },
          },
          payment: { amount: 1000, method: "COD", status: "paid" },
          created_at: yesterday,
        });
      }

      // Create orders today (low revenue - 50% drop)
      const today = new Date();
      for (let i = 0; i < 3; i++) {
        await Order.create({
          client_id: client.firebase_uid,
          status: "delivered",
          delivery: {
            delivery_status: "delivered",
            delivery_address: { full_address: "Test St" },
          },
          payment: { amount: 500, method: "COD", status: "paid" },
          created_at: today,
        });
      }

      const from = new Date(today.setHours(0, 0, 0, 0));
      const to = new Date(today.setHours(23, 59, 59, 999));

      const response = await request(app)
        .post("/api/admin/alerts/evaluate")
        .query({ from: from.toISOString(), to: to.toISOString() })
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.created).toBeGreaterThan(0);
      const revenueAlert = response.body.alerts.find(
        (a) => a.type === "revenue_drop"
      );
      expect(revenueAlert).toBeDefined();
      expect(revenueAlert.severity).toBe("high");
      expect(revenueAlert.message).toContain("Revenue dropped");
    });

    test("should generate high refund ratio alert (>30%)", async () => {
      const client = await Client.create({
        firebase_uid: "refund_alert_client",
        name: "Refund Alert User",
        email: "refundalert@test.com",
        phone: "3333333333",
      });

      const today = new Date();
      // Create 10 orders: 4 refunded, 6 delivered (40% refund rate)
      for (let i = 0; i < 4; i++) {
        await Order.create({
          client_id: client.firebase_uid,
          status: "refunded",
          delivery: {
            delivery_status: "cancelled",
            delivery_address: { full_address: "Test St" },
          },
          payment: { amount: 100, method: "COD", status: "failed" },
          created_at: today,
        });
      }
      for (let i = 0; i < 6; i++) {
        await Order.create({
          client_id: client.firebase_uid,
          status: "delivered",
          delivery: {
            delivery_status: "delivered",
            delivery_address: { full_address: "Test St" },
          },
          payment: { amount: 100, method: "COD", status: "paid" },
          created_at: today,
        });
      }

      const from = new Date(today.setHours(0, 0, 0, 0));
      const to = new Date(today.setHours(23, 59, 59, 999));

      const response = await request(app)
        .post("/api/admin/alerts/evaluate")
        .query({ from: from.toISOString(), to: to.toISOString() })
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.created).toBeGreaterThan(0);
      const refundAlert = response.body.alerts.find(
        (a) => a.type === "refund_ratio_high"
      );
      expect(refundAlert).toBeDefined();
      expect(refundAlert.severity).toBe("medium");
      expect(refundAlert.message).toContain("Refund ratio");
    });

    test("should not create duplicate alerts for same issue", async () => {
      const client = await Client.create({
        firebase_uid: "duplicate_alert_client",
        name: "Duplicate Alert User",
        email: "duplicate@test.com",
        phone: "2222222222",
      });

      // Create revenue drop scenario
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await Order.create({
        client_id: client.firebase_uid,
        status: "delivered",
        delivery: {
          delivery_status: "delivered",
          delivery_address: { full_address: "Test St" },
        },
        payment: { amount: 5000, method: "COD", status: "paid" },
        created_at: yesterday,
      });

      const today = new Date();
      await Order.create({
        client_id: client.firebase_uid,
        status: "delivered",
        delivery: {
          delivery_status: "delivered",
          delivery_address: { full_address: "Test St" },
        },
        payment: { amount: 500, method: "COD", status: "paid" },
        created_at: today,
      });

      // First evaluation
      const from = new Date(today.setHours(0, 0, 0, 0));
      const to = new Date(today.setHours(23, 59, 59, 999));

      const response1 = await request(app)
        .post("/api/admin/alerts/evaluate")
        .query({ from: from.toISOString(), to: to.toISOString() })
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response1.status).toBe(200);
      const firstCreated = response1.body.created;

      // Second evaluation (should not create duplicate)
      const response2 = await request(app)
        .post("/api/admin/alerts/evaluate")
        .query({ from: from.toISOString(), to: to.toISOString() })
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response2.status).toBe(200);
      expect(response2.body.created).toBe(0); // No new alerts created
      expect(response2.body.evaluated).toBeGreaterThan(0); // But evaluation happened
    });

    test("should skip alert generation when revenue is stable", async () => {
      const client = await Client.create({
        firebase_uid: "stable_client",
        name: "Stable User",
        email: "stable@test.com",
        phone: "1111111111",
      });

      // Create similar revenue for both days
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await Order.create({
        client_id: client.firebase_uid,
        status: "delivered",
        delivery: {
          delivery_status: "delivered",
          delivery_address: { full_address: "Test St" },
        },
        payment: { amount: 1000, method: "COD", status: "paid" },
        created_at: yesterday,
      });

      const today = new Date();
      await Order.create({
        client_id: client.firebase_uid,
        status: "delivered",
        delivery: {
          delivery_status: "delivered",
          delivery_address: { full_address: "Test St" },
        },
        payment: { amount: 950, method: "COD", status: "paid" },
        created_at: today,
      });

      const from = new Date(today.setHours(0, 0, 0, 0));
      const to = new Date(today.setHours(23, 59, 59, 999));

      const response = await request(app)
        .post("/api/admin/alerts/evaluate")
        .query({ from: from.toISOString(), to: to.toISOString() })
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.created).toBe(0);
      expect(response.body.alerts).toEqual([]);
    });

    test("should require admin authentication", async () => {
      await request(app).post("/api/admin/alerts/evaluate").expect(401);
    });
  });

  // =========================
  // 3. Alert Management
  // =========================
  describe("Alert Listing (GET /api/admin/alerts)", () => {
    test("should list all alerts with pagination", async () => {
      // Create multiple alerts
      for (let i = 0; i < 5; i++) {
        await Alert.create({
          type: "test_alert",
          severity: "low",
          message: `Test alert ${i + 1}`,
          meta: { index: i },
        });
      }

      const response = await request(app)
        .get("/api/admin/alerts")
        .query({ page: 1, limit: 3 })
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.rows).toHaveLength(3);
      expect(response.body.total).toBe(5);
      expect(response.body.page).toBe(1);
      expect(response.body.limit).toBe(3);
    });

    test("should filter unacknowledged alerts", async () => {
      await Alert.create({
        type: "unacked_alert",
        severity: "high",
        message: "Unacknowledged alert",
        acknowledged: false,
      });
      await Alert.create({
        type: "acked_alert",
        severity: "low",
        message: "Acknowledged alert",
        acknowledged: true,
        acknowledged_at: new Date(),
      });

      const response = await request(app)
        .get("/api/admin/alerts")
        .query({ unacked: "1" })
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.rows).toHaveLength(1);
      expect(response.body.rows[0].acknowledged).toBe(false);
      expect(response.body.rows[0].type).toBe("unacked_alert");
    });

    test("should return empty list when no alerts exist", async () => {
      const response = await request(app)
        .get("/api/admin/alerts")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.rows).toEqual([]);
      expect(response.body.total).toBe(0);
    });

    test("should require admin authentication", async () => {
      await request(app).get("/api/admin/alerts").expect(401);
    });
  });

  describe("Alert Acknowledgment (POST /api/admin/alerts/:id/ack)", () => {
    test("should acknowledge alert successfully", async () => {
      const alert = await Alert.create({
        type: "test_ack",
        severity: "medium",
        message: "Test acknowledgment",
        acknowledged: false,
      });

      const response = await request(app)
        .post(`/api/admin/alerts/${alert._id}/ack`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.acknowledged).toBe(true);
      expect(response.body.acknowledged_at).toBeDefined();
      expect(response.body._id.toString()).toBe(alert._id.toString());
    });

    test("should return 404 for non-existent alert", async () => {
      const fakeId = new mongoose.Types.ObjectId();

      const response = await request(app)
        .post(`/api/admin/alerts/${fakeId}/ack`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("alert not found");
    });

    test("should return 400 for invalid alert ID", async () => {
      const response = await request(app)
        .post("/api/admin/alerts/invalid_id/ack")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("invalid alert id");
    });

    test("should require admin authentication", async () => {
      const alert = await Alert.create({
        type: "test_auth",
        severity: "low",
        message: "Test auth",
      });

      await request(app).post(`/api/admin/alerts/${alert._id}/ack`).expect(401);
    });
  });
});
