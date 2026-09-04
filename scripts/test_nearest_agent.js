require("module-alias/register");
/**
 * Test Script: Nearest Agent Assignment System
 *
 * This script helps test the nearest agent assignment flow by:
 * 1. Creating test delivery agents at different locations
 * 2. Creating a test order
 * 3. Simulating seller acceptance to trigger agent assignment
 * 4. Monitoring assignment patterns
 *
 * Usage: node scripts/test_nearest_agent.js
 */

const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const {
  DeliveryAgent,
  Seller,
  Order,
  Product,
  Client,
} = require("../lib/models");

const uri =
  process.env.DB_CONNECTION_STRING || "mongodb://127.0.0.1:27017/easy_app";

// Test locations (Delhi area)
const TEST_LOCATIONS = [
  {
    name: "Agent A - Connaught Place",
    lat: 28.6315,
    lng: 77.2167,
    distance: "~1 km from store",
  },
  {
    name: "Agent B - India Gate",
    lat: 28.6129,
    lng: 77.2295,
    distance: "~3 km from store",
  },
  {
    name: "Agent C - Karol Bagh",
    lat: 28.6519,
    lng: 77.19,
    distance: "~5 km from store",
  },
  {
    name: "Agent D - Dwarka",
    lat: 28.5921,
    lng: 77.046,
    distance: "~15 km from store",
  },
];

// Store location (Central Delhi)
const STORE_LOCATION = { lat: 28.6289, lng: 77.2065 }; // Near Connaught Place

async function cleanupTestData() {
  console.log("\n🧹 Cleaning up old test data...");
  await DeliveryAgent.deleteMany({ email: /test-agent-.*@test.com/ });
  console.log("✅ Cleanup complete");
}

async function createTestAgents() {
  console.log("\n👥 Creating test delivery agents at different locations...");

  const agents = [];
  for (let i = 0; i < TEST_LOCATIONS.length; i++) {
    const loc = TEST_LOCATIONS[i];
    const agent = await DeliveryAgent.create({
      name: loc.name,
      email: `test-agent-${i + 1}@test.com`,
      phone: `9999${String(i + 1).padStart(6, "0")}`,
      approved: true,
      active: true,
      available: true,
      vehicle_type: "bike",
      current_location: {
        lat: loc.lat,
        lng: loc.lng,
        updated_at: new Date(),
      },
    });
    agents.push(agent);
    console.log(`   ✓ Created ${loc.name} (${loc.distance})`);
  }

  return agents;
}

async function createTestOrder(sellerId) {
  console.log("\n📦 Creating test order...");

  // Find or create a test client
  let client = await Client.findOne({ phone: "9999999999" });
  if (!client) {
    client = await Client.create({
      name: "Test Customer",
      phone: "9999999999",
      firebase_uid: "test-customer-uid",
    });
  }

  // Find a product from the seller
  const product = await Product.findOne({ seller_id: sellerId });
  if (!product) {
    throw new Error(
      "No products found for seller. Please create a product first."
    );
  }

  const order = await Order.create({
    client_id: client.firebase_uid || "test-customer-uid",
    seller_id: sellerId,
    order_items: [
      {
        product_id: product._id,
        qty: 2,
        price_snapshot: product.price,
        name_snapshot: product.name,
      },
    ],
    payment: {
      amount: product.price * 2,
      method: "COD",
      status: "pending",
    },
    delivery: {
      delivery_status: "pending",
      delivery_address: {
        full_address: "Test Address, Delhi",
        location: {
          lat: 28.63,
          lng: 77.22,
        },
      },
      pickup_address: {
        full_address: "Test Store, Delhi",
        location: STORE_LOCATION,
      },
    },
  });

  console.log(`   ✓ Order created: ${order._id}`);
  return order;
}

async function simulateSellerAcceptance(orderId, sellerId) {
  console.log("\n✅ Simulating seller acceptance...");

  // This mimics what happens in /seller/orders/accept
  const order = await Order.findById(orderId);

  // Update order to paid
  await Order.findByIdAndUpdate(orderId, {
    $set: {
      "payment.status": "paid",
      "payment.payment_date": new Date(),
      "delivery.delivery_status": "pending",
    },
  });

  // Find nearest agent
  const availableAgents = await DeliveryAgent.find({
    approved: true,
    active: true,
    available: true,
  }).lean();

  console.log(`   Found ${availableAgents.length} available agents`);

  // Calculate distances
  const agentsWithDistance = availableAgents
    .filter(
      (agent) => agent.current_location?.lat && agent.current_location?.lng
    )
    .map((agent) => {
      const distance = calculateDistance(
        STORE_LOCATION.lat,
        STORE_LOCATION.lng,
        agent.current_location.lat,
        agent.current_location.lng
      );
      return { agent, distance };
    })
    .sort((a, b) => a.distance - b.distance);

  console.log("\n📊 Agent Distance Ranking:");
  agentsWithDistance.forEach((item, index) => {
    console.log(
      `   ${index + 1}. ${item.agent.name}: ${item.distance.toFixed(2)} km`
    );
  });

  const nearest = agentsWithDistance[0];

  // Assign to nearest agent
  const updatedOrder = await Order.findByIdAndUpdate(
    orderId,
    {
      $set: {
        "delivery.delivery_agent_id": nearest.agent._id,
        "delivery.delivery_agent_response": "pending",
        "delivery.delivery_status": "assigned",
      },
      $push: {
        "delivery.assignment_history": {
          agent_id: nearest.agent._id,
          assigned_at: new Date(),
          response: "pending",
        },
      },
    },
    { new: true }
  );

  console.log(
    `\n🎯 Order assigned to: ${nearest.agent.name} (${nearest.distance.toFixed(
      2
    )} km away)`
  );
  return updatedOrder;
}

function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function testRejectionCascade(orderId) {
  console.log("\n❌ Testing rejection cascade...");

  const order = await Order.findById(orderId).populate(
    "delivery.delivery_agent_id"
  );
  const currentAgent = order.delivery.delivery_agent_id;

  console.log(`   Current agent: ${currentAgent.name}`);
  console.log(`   Simulating rejection...`);

  // Mark as rejected
  await Order.findByIdAndUpdate(orderId, {
    $push: {
      "delivery.assignment_history": {
        agent_id: currentAgent._id,
        assigned_at: new Date(),
        response: "rejected",
        response_at: new Date(),
      },
    },
  });

  // Find next nearest agent
  const order2 = await Order.findById(orderId).lean();
  const triedAgentIds = new Set(
    (order2.delivery?.assignment_history || []).map((h) => String(h.agent_id))
  );

  const availableAgents = await DeliveryAgent.find({
    approved: true,
    active: true,
    available: true,
    _id: { $nin: Array.from(triedAgentIds) },
  }).lean();

  const agentsWithDistance = availableAgents
    .filter(
      (agent) => agent.current_location?.lat && agent.current_location?.lng
    )
    .map((agent) => {
      const distance = calculateDistance(
        STORE_LOCATION.lat,
        STORE_LOCATION.lng,
        agent.current_location.lat,
        agent.current_location.lng
      );
      return { agent, distance };
    })
    .sort((a, b) => a.distance - b.distance);

  if (agentsWithDistance.length > 0) {
    const nextNearest = agentsWithDistance[0];

    await Order.findByIdAndUpdate(orderId, {
      $set: {
        "delivery.delivery_agent_id": nextNearest.agent._id,
        "delivery.delivery_agent_response": "pending",
        "delivery.delivery_status": "assigned",
      },
      $push: {
        "delivery.assignment_history": {
          agent_id: nextNearest.agent._id,
          assigned_at: new Date(),
          response: "pending",
        },
      },
    });

    console.log(
      `   ✓ Reassigned to next nearest: ${
        nextNearest.agent.name
      } (${nextNearest.distance.toFixed(2)} km)`
    );
  } else {
    console.log(`   ⚠️ No more agents available`);
  }
}

async function displayAssignmentHistory(orderId) {
  console.log("\n📋 Assignment History:");

  const order = await Order.findById(orderId).lean();
  const history = order.delivery?.assignment_history || [];

  for (const entry of history) {
    const agent = await DeliveryAgent.findById(entry.agent_id).lean();
    const status =
      entry.response === "pending"
        ? "⏳ PENDING"
        : entry.response === "accepted"
        ? "✅ ACCEPTED"
        : entry.response === "rejected"
        ? "❌ REJECTED"
        : entry.response === "timeout"
        ? "⏰ TIMEOUT"
        : entry.response;

    console.log(
      `   ${status} - ${agent?.name || "Unknown"} at ${new Date(
        entry.assigned_at
      ).toLocaleTimeString()}`
    );
  }
}

async function main() {
  try {
    console.log("🧪 Nearest Agent Assignment System - Test Script");
    console.log("=".repeat(60));

    await mongoose.connect(uri);
    console.log("✅ Connected to MongoDB");

    // Cleanup old test data
    await cleanupTestData();

    // Create test agents
    const agents = await createTestAgents();

    // Find or create a test seller
    let seller = await Seller.findOne({ email: "seller@example.com" });
    if (!seller) {
      console.log(
        "\n⚠️ No test seller found. Please create a seller first or use an existing one."
      );
      console.log(
        "   You can create one using the admin dashboard or modify this script."
      );
      process.exit(1);
    }

    // Ensure seller has location
    if (!seller.location?.lat || !seller.location?.lng) {
      await Seller.findByIdAndUpdate(seller._id, {
        $set: { location: STORE_LOCATION },
      });
      console.log(`\n📍 Set seller location to test store location`);
    }

    // Create test order
    const order = await createTestOrder(seller._id);

    // Simulate seller acceptance (triggers nearest agent assignment)
    await simulateSellerAcceptance(order._id, seller._id);

    // Display assignment history
    await displayAssignmentHistory(order._id);

    // Test rejection cascade
    console.log("\n" + "=".repeat(60));
    await testRejectionCascade(order._id);

    // Display final assignment history
    await displayAssignmentHistory(order._id);

    console.log("\n" + "=".repeat(60));
    console.log("✅ Test completed successfully!");
    console.log("\n💡 Tips:");
    console.log(
      "   • Check the logs above to verify nearest agent was selected first"
    );
    console.log("   • Rejection should cascade to the 2nd nearest agent");
    console.log(
      "   • You can run this script multiple times to test different scenarios"
    );
    console.log(
      "   • Modify TEST_LOCATIONS to test with different agent positions"
    );
    console.log("\n🧹 Cleanup:");
    console.log("   • Test agents: Email pattern test-agent-*@test.com");
    console.log(
      "   • Run this script again to auto-cleanup and create fresh test data"
    );

    await mongoose.disconnect();
    console.log("\n👋 Disconnected from MongoDB");
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

main();
