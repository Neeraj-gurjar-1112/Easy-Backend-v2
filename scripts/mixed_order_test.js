require("module-alias/register");
// Simple runtime check: fetch one grocery and one restaurant product, then
// create a mixed order and print the response. Useful to validate grouped
// orders and per-order delivery_charge behavior.
//
// Usage: node Backend/scripts/mixed_order_test.js

const http = require("http");
const https = require("https");
const { URL } = require("url");

const BASE = process.env.EASY_APP_BASE || "http://localhost:3000";

function httpRequest(method, urlStr, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const lib = url.protocol === "https:" ? https : http;
    const options = {
      method,
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname + (url.search || ""),
      headers,
    };

    const req = lib.request(options, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        const contentType = res.headers["content-type"] || "";
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(
            new Error(`HTTP ${res.statusCode} ${res.statusMessage}: ${data}`)
          );
        }
        if (contentType.includes("application/json")) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(
              new Error("Failed to parse JSON: " + e.message + "\n" + data)
            );
          }
        } else {
          resolve(data);
        }
      });
    });

    req.on("error", reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

async function main() {
  try {
    // Quick health check
    const health = await httpRequest("GET", `${BASE}/api/health`);
    console.log("Health:", health);

    const groceryList = await httpRequest(
      "GET",
      `${BASE}/api/products?category=Grocery`
    );
    const restaurantList = await httpRequest(
      "GET",
      `${BASE}/api/products?category=Restaurants`
    );

    if (!Array.isArray(groceryList) || groceryList.length === 0) {
      throw new Error("No grocery products available to test.");
    }
    if (!Array.isArray(restaurantList) || restaurantList.length === 0) {
      throw new Error("No restaurant products available to test.");
    }

    const gId = groceryList[0]._id;
    const rId = restaurantList[0]._id;
    console.log("Using product IDs:", { grocery: gId, restaurant: rId });

    const payload = {
      items: [
        { product_id: gId, qty: 2 },
        { product_id: rId, qty: 1 },
      ],
      client_id: "client_demo_123",
      delivery_address: {
        full_address: "221B Baker Street",
        recipient_name: "Sherlock",
        recipient_phone: "9999999999",
      },
    };

    const body = JSON.stringify(payload);
    const resp = await httpRequest("POST", `${BASE}/api/orders`, body, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body).toString(),
    });

    console.log("Order API response:");
    console.log(JSON.stringify(resp, null, 2));

    // Show delivery_charge presence for quick visual verification
    if (resp && resp.orders && Array.isArray(resp.orders)) {
      console.log(
        "Grouped orders delivery charges:",
        resp.orders.map(
          (o) => o.delivery_charge ?? (o.delivery && o.delivery.delivery_charge)
        )
      );
    } else if (resp && (resp.delivery_charge !== undefined || resp.delivery)) {
      console.log(
        "Single order delivery charge:",
        resp.delivery_charge ?? (resp.delivery && resp.delivery.delivery_charge)
      );
    }
  } catch (err) {
    console.error("Test failed:", err.message);
    process.exitCode = 1;
  }
}

main();
