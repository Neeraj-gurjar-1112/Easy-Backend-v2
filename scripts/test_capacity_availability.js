require("module-alias/register");
const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { DeliveryAgent, Order } = require("../lib/models");

const uri =
  process.env.DB_CONNECTION_STRING || "mongodb://127.0.0.1:27017/easy_app";

async function testCapacityAndAvailability() {
  try {
    console.log("🧪 Testing Agent Capacity & Availability Management");
    console.log("=".repeat(60));

    await mongoose.connect(uri);
    console.log("✅ Connected to MongoDB\n");

    // Test 1: Check agent capacity
    console.log("📊 TEST 1: Agent Capacity Check");
    console.log("-".repeat(60));

    const MAX_CONCURRENT = 3;
    const agents = await DeliveryAgent.find({ available: true }).lean();

    for (const agent of agents) {
      const activeDeliveries = await Order.countDocuments({
        "delivery.delivery_agent_id": agent._id,
        "delivery.delivery_status": {
          $in: ["assigned", "picked_up", "in_transit"],
        },
      });

      const capacity = MAX_CONCURRENT - activeDeliveries;
      const status = capacity > 0 ? "✅ Available" : "⚠️ At Capacity";

      console.log(`${status} | ${agent.name}`);
      console.log(
        `   Active: ${activeDeliveries}/${MAX_CONCURRENT} | Capacity: ${capacity}`
      );
    }

    // Test 2: Find queued orders
    console.log("\n📋 TEST 2: Queued Orders");
    console.log("-".repeat(60));

    const queuedOrders = await Order.find({
      "payment.status": "paid",
      "delivery.delivery_status": "pending",
      "delivery.delivery_agent_id": null,
    }).lean();

    console.log(`Queued Orders: ${queuedOrders.length}`);
    if (queuedOrders.length > 0) {
      queuedOrders.forEach((order, i) => {
        console.log(
          `   ${i + 1}. Order ${order._id} - ${
            order.delivery?.delivery_address?.full_address || "N/A"
          }`
        );
      });
    } else {
      console.log("   ✅ No orders in queue");
    }

    // Test 3: Agent utilization
    console.log("\n📈 TEST 3: Agent Utilization");
    console.log("-".repeat(60));

    const utilization = await Order.aggregate([
      {
        $match: {
          "delivery.delivery_status": {
            $in: ["assigned", "picked_up", "in_transit"],
          },
        },
      },
      {
        $group: {
          _id: "$delivery.delivery_agent_id",
          count: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: "delivery_agents",
          localField: "_id",
          foreignField: "_id",
          as: "agent",
        },
      },
      {
        $unwind: "$agent",
      },
      {
        $sort: { count: -1 },
      },
    ]);

    if (utilization.length > 0) {
      utilization.forEach((item, i) => {
        const percentage = ((item.count / MAX_CONCURRENT) * 100).toFixed(0);
        const bar =
          "█".repeat(Math.floor(item.count)) +
          "░".repeat(MAX_CONCURRENT - item.count);
        console.log(
          `   ${i + 1}. ${item.agent.name}: ${bar} ${
            item.count
          }/${MAX_CONCURRENT} (${percentage}%)`
        );
      });
    } else {
      console.log("   ✅ No active deliveries");
    }

    // Test 4: Availability summary
    console.log("\n🌐 TEST 4: System Availability Summary");
    console.log("-".repeat(60));

    const totalAgents = await DeliveryAgent.countDocuments({
      approved: true,
      active: true,
    });
    const onlineAgents = await DeliveryAgent.countDocuments({
      approved: true,
      active: true,
      available: true,
    });
    const offlineAgents = totalAgents - onlineAgents;

    const onlineAgentsList = await DeliveryAgent.find({
      approved: true,
      active: true,
      available: true,
    }).lean();
    let agentsWithCapacity = 0;

    for (const agent of onlineAgentsList) {
      const activeDeliveries = await Order.countDocuments({
        "delivery.delivery_agent_id": agent._id,
        "delivery.delivery_status": {
          $in: ["assigned", "picked_up", "in_transit"],
        },
      });
      if (activeDeliveries < MAX_CONCURRENT) agentsWithCapacity++;
    }

    console.log(`Total Agents:           ${totalAgents}`);
    console.log(`Online Agents:          ${onlineAgents}`);
    console.log(`Offline Agents:         ${offlineAgents}`);
    console.log(`Agents with Capacity:   ${agentsWithCapacity}`);
    console.log(`Agents at Capacity:     ${onlineAgents - agentsWithCapacity}`);

    const systemHealth =
      agentsWithCapacity > 0
        ? "🟢 HEALTHY"
        : onlineAgents > 0
        ? "🟡 DEGRADED"
        : "🔴 CRITICAL";
    console.log(`\nSystem Health: ${systemHealth}`);

    if (agentsWithCapacity === 0 && onlineAgents > 0) {
      console.log(
        "⚠️  All online agents are at capacity. New orders will be queued."
      );
    } else if (onlineAgents === 0) {
      console.log("🚨 No agents online. Orders cannot be assigned.");
    }

    console.log("\n" + "=".repeat(60));
    console.log("✅ Test completed successfully!");
  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await mongoose.disconnect();
    console.log("👋 Disconnected from MongoDB");
  }
}

testCapacityAndAvailability();
