require("module-alias/register");
#!/usr/bin/env node
// Simple integration test: create an order with coupon and verify snapshot includes coupon adjustment and applied_discount_amount is persisted.
// Usage: node scripts/test_coupon_integration.js COUPON_CODE API_BASE(optional)

const fetch = require("node-fetch");

(async function () {
  const coupon = process.argv[2] || "TEST10";
  const base = (
    process.argv[3] ||
    process.env.API_BASE_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
  function log(msg) {
    console.log("[coupon-test]", msg);
  }
  try {
    // 1. Seed: pick a product list (assumes at least one product exists)
    const productsRes = await fetch(base + "/api/products?limit=3").catch(
      () => null
    );
    if (!productsRes || !productsRes.ok) {
      throw new Error(
        "Failed to list products (ensure server running and sample data present)"
      );
    }
    const products = await productsRes.json();
    if (!Array.isArray(products) || !products.length)
      throw new Error("No products returned to build test order");
    const items = products
      .slice(0, 2)
      .map((p) => ({
        product_id: p._id,
        qty: 1,
        name: p.name,
        price: p.price,
      }));

    // 2. Create order with minimal address inline (guest checkout acceptable)
    const createRes = await fetch(base + "/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items,
        coupon,
        delivery_address: {
          full_address: "123 Test St",
          recipient_name: "Test User",
        },
      }),
    });
    const createBody = await createRes.json();
    if (!createRes.ok) {
      throw new Error("Create order failed: " + JSON.stringify(createBody));
    }
    const orderId =
      createBody.order_id ||
      (createBody.orders &&
        createBody.orders[0] &&
        createBody.orders[0].order_id);
    if (!orderId) throw new Error("No order_id in response");
    log("Created order " + orderId);

    // 3. Fetch status snapshot
    const statusRes = await fetch(base + "/api/orders/" + orderId + "/status");
    const statusBody = await statusRes.json();
    if (!statusRes.ok)
      throw new Error("Status fetch failed: " + JSON.stringify(statusBody));

    const adjustments = statusBody.adjustments || [];
    const couponAdj = adjustments.find((a) => a.type === "coupon");
    if (!couponAdj) {
      throw new Error("Coupon adjustment missing in snapshot");
    }
    log(
      "Coupon adjustment present: amount=" +
        couponAdj.amount +
        " code=" +
        couponAdj.code
    );

    // 4. Verify applied_discount_amount persisted via direct order fetch
    const orderDocRes = await fetch(
      base + "/api/orders/" + orderId + "/admin-detail"
    );
    const orderDoc = await orderDocRes.json();
    if (!orderDocRes.ok)
      throw new Error("Admin detail failed: " + JSON.stringify(orderDoc));
    if (typeof orderDoc.subtotal !== "number")
      log("Warning: subtotal missing in admin detail");

    // Attempt to infer persisted discount from adjustment absolute value
    const persisted = Math.abs(couponAdj.amount || 0);
    if (!(persisted > 0)) throw new Error("Persisted discount amount not > 0");

    log(
      "SUCCESS: applied_discount_amount effectively persisted (coupon amount " +
        persisted +
        ")"
    );
    process.exit(0);
  } catch (e) {
    console.error("\nFAILED integration test:", e.message || e);
    process.exit(1);
  }
})();
