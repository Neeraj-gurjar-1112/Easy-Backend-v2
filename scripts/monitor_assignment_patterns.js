require("module-alias/register");
/**
 * Monitoring Script: Agent Assignment Analytics
 *
 * Analyzes order assignment patterns to identify optimization opportunities.
 *
 * Usage: node scripts/monitor_assignment_patterns.js [days]
 * Example: node scripts/monitor_assignment_patterns.js 7  (analyze last 7 days)
 */

const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { Order, DeliveryAgent } = require("../lib/models");

const uri =
  process.env.DB_CONNECTION_STRING || "mongodb://127.0.0.1:27017/easy_app";

function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371;
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

async function analyzeAssignmentPatterns(days = 7) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  console.log(`\n📊 Analyzing assignment patterns for last ${days} days...`);
  console.log(`   From: ${startDate.toLocaleDateString()}`);
  console.log(`   To:   ${new Date().toLocaleDateString()}`);

  // Fetch orders with assignment history
  const orders = await Order.find({
    created_at: { $gte: startDate },
    "delivery.assignment_history.0": { $exists: true },
  }).lean();

  console.log(`\n   Found ${orders.length} orders with assignments\n`);

  if (orders.length === 0) {
    console.log("   ⚠️ No orders found in this period");
    return;
  }

  // Statistics
  let totalAssignments = 0;
  let totalRejections = 0;
  let totalTimeouts = 0;
  let totalAcceptances = 0;
  let assignmentTimes = [];
  let rejectionCounts = {};
  let agentStats = {};

  for (const order of orders) {
    const history = order.delivery?.assignment_history || [];
    totalAssignments += history.length;

    for (const assignment of history) {
      const agentId = String(assignment.agent_id);

      // Initialize agent stats
      if (!agentStats[agentId]) {
        agentStats[agentId] = {
          offered: 0,
          accepted: 0,
          rejected: 0,
          timeout: 0,
        };
      }

      agentStats[agentId].offered++;

      if (assignment.response === "rejected") {
        totalRejections++;
        agentStats[agentId].rejected++;
      } else if (assignment.response === "timeout") {
        totalTimeouts++;
        agentStats[agentId].timeout++;
      } else if (assignment.response === "accepted") {
        totalAcceptances++;
        agentStats[agentId].accepted++;

        // Calculate time to acceptance
        if (assignment.response_at && assignment.assigned_at) {
          const timeDiff =
            (new Date(assignment.response_at) -
              new Date(assignment.assigned_at)) /
            1000;
          assignmentTimes.push(timeDiff);
        }
      }
    }

    // Count how many attempts before acceptance
    const attemptCount = history.length;
    rejectionCounts[attemptCount] = (rejectionCounts[attemptCount] || 0) + 1;
  }

  // Display overall statistics
  console.log("=".repeat(70));
  console.log("📈 OVERALL STATISTICS");
  console.log("=".repeat(70));
  console.log(`Total Orders:           ${orders.length}`);
  console.log(`Total Assignments:      ${totalAssignments}`);
  console.log(
    `Total Acceptances:      ${totalAcceptances} (${(
      (totalAcceptances / totalAssignments) *
      100
    ).toFixed(1)}%)`
  );
  console.log(
    `Total Rejections:       ${totalRejections} (${(
      (totalRejections / totalAssignments) *
      100
    ).toFixed(1)}%)`
  );
  console.log(
    `Total Timeouts:         ${totalTimeouts} (${(
      (totalTimeouts / totalAssignments) *
      100
    ).toFixed(1)}%)`
  );
  console.log(
    `Avg Assignments/Order:  ${(totalAssignments / orders.length).toFixed(2)}`
  );

  if (assignmentTimes.length > 0) {
    const avgTime =
      assignmentTimes.reduce((a, b) => a + b, 0) / assignmentTimes.length;
    const minTime = Math.min(...assignmentTimes);
    const maxTime = Math.max(...assignmentTimes);

    console.log(`\n⏱️  TIME TO ACCEPTANCE:`);
    console.log(`   Average: ${avgTime.toFixed(1)}s`);
    console.log(`   Fastest: ${minTime.toFixed(1)}s`);
    console.log(`   Slowest: ${maxTime.toFixed(1)}s`);
  }

  // Attempts distribution
  console.log(`\n🔄 ATTEMPTS BEFORE ACCEPTANCE:`);
  const sortedAttempts = Object.entries(rejectionCounts).sort(
    (a, b) => parseInt(a[0]) - parseInt(b[0])
  );
  for (const [attempts, count] of sortedAttempts) {
    const bar = "█".repeat(Math.floor((count / orders.length) * 50));
    console.log(
      `   ${attempts} attempt${attempts > 1 ? "s" : " "}: ${count
        .toString()
        .padStart(3)} orders ${bar}`
    );
  }

  // Agent-specific statistics
  console.log(`\n👥 AGENT PERFORMANCE:`);
  console.log("=".repeat(70));

  const agentEntries = Object.entries(agentStats);
  for (const [agentId, stats] of agentEntries) {
    const agent = await DeliveryAgent.findById(agentId).lean();
    const agentName = agent?.name || "Unknown Agent";
    const acceptanceRate =
      stats.offered > 0
        ? ((stats.accepted / stats.offered) * 100).toFixed(1)
        : 0;
    const rejectionRate =
      stats.offered > 0
        ? ((stats.rejected / stats.offered) * 100).toFixed(1)
        : 0;
    const timeoutRate =
      stats.offered > 0
        ? ((stats.timeout / stats.offered) * 100).toFixed(1)
        : 0;

    console.log(`\n${agentName}:`);
    console.log(`   Offered:    ${stats.offered}`);
    console.log(`   Accepted:   ${stats.accepted} (${acceptanceRate}%)`);
    console.log(`   Rejected:   ${stats.rejected} (${rejectionRate}%)`);
    console.log(`   Timeout:    ${stats.timeout} (${timeoutRate}%)`);
  }

  // Optimization recommendations
  console.log(`\n\n💡 OPTIMIZATION RECOMMENDATIONS:`);
  console.log("=".repeat(70));

  const highRejectionAgents = agentEntries.filter(([_, stats]) => {
    const rate = stats.offered > 5 ? stats.rejected / stats.offered : 0;
    return rate > 0.3; // More than 30% rejection rate
  });

  const highTimeoutAgents = agentEntries.filter(([_, stats]) => {
    const rate = stats.offered > 5 ? stats.timeout / stats.offered : 0;
    return rate > 0.2; // More than 20% timeout rate
  });

  if (highRejectionAgents.length > 0) {
    console.log(`\n⚠️  Agents with high rejection rates (>30%):`);
    for (const [agentId, stats] of highRejectionAgents) {
      const agent = await DeliveryAgent.findById(agentId).lean();
      const rate = ((stats.rejected / stats.offered) * 100).toFixed(1);
      console.log(
        `   • ${agent?.name || "Unknown"}: ${rate}% (${stats.rejected}/${
          stats.offered
        })`
      );
    }
    console.log(`   → Consider training or reviewing these agents' workload`);
  }

  if (highTimeoutAgents.length > 0) {
    console.log(`\n⏰ Agents with high timeout rates (>20%):`);
    for (const [agentId, stats] of highTimeoutAgents) {
      const agent = await DeliveryAgent.findById(agentId).lean();
      const rate = ((stats.timeout / stats.offered) * 100).toFixed(1);
      console.log(
        `   • ${agent?.name || "Unknown"}: ${rate}% (${stats.timeout}/${
          stats.offered
        })`
      );
    }
    console.log(
      `   → Check if these agents have app issues or connectivity problems`
    );
  }

  const avgAttemptsPerOrder = totalAssignments / orders.length;
  if (avgAttemptsPerOrder > 2) {
    console.log(
      `\n📉 High average attempts per order (${avgAttemptsPerOrder.toFixed(
        2
      )}):`
    );
    console.log(
      `   → Consider increasing agent pool or adjusting assignment radius`
    );
  }

  if (totalTimeouts / totalAssignments > 0.15) {
    const timeoutRate = ((totalTimeouts / totalAssignments) * 100).toFixed(1);
    console.log(`\n⏱️  High timeout rate (${timeoutRate}%):`);
    console.log(`   → Consider reducing timeout duration from 3 minutes`);
    console.log(`   → Or implement push notifications to alert agents faster`);
  }

  console.log("\n");
}

async function showRecentAssignments(limit = 10) {
  console.log(`\n📋 RECENT ASSIGNMENTS (Last ${limit}):`);
  console.log("=".repeat(70));

  const orders = await Order.find({
    "delivery.assignment_history.0": { $exists: true },
  })
    .sort({ created_at: -1 })
    .limit(limit)
    .lean();

  for (const order of orders) {
    const history = order.delivery?.assignment_history || [];
    const lastAssignment = history[history.length - 1];
    const agent = await DeliveryAgent.findById(lastAssignment.agent_id).lean();

    const statusIcon =
      lastAssignment.response === "pending"
        ? "⏳"
        : lastAssignment.response === "accepted"
        ? "✅"
        : lastAssignment.response === "rejected"
        ? "❌"
        : lastAssignment.response === "timeout"
        ? "⏰"
        : "❓";

    console.log(`\n${statusIcon} Order ${order._id}`);
    console.log(`   Created: ${new Date(order.created_at).toLocaleString()}`);
    console.log(`   Attempts: ${history.length}`);
    console.log(`   Current Agent: ${agent?.name || "Unknown"}`);
    console.log(`   Status: ${lastAssignment.response}`);

    if (order.pickup_address?.location?.lat && agent?.current_location?.lat) {
      const distance = calculateDistance(
        order.pickup_address.location.lat,
        order.pickup_address.location.lng,
        agent.current_location.lat,
        agent.current_location.lng
      );
      console.log(`   Distance: ${distance.toFixed(2)} km from store`);
    }
  }
}

async function main() {
  try {
    console.log("🔍 Agent Assignment Analytics & Monitoring");
    console.log("=".repeat(70));

    await mongoose.connect(uri);
    console.log("✅ Connected to MongoDB");

    const days = parseInt(process.argv[2]) || 7;

    await analyzeAssignmentPatterns(days);
    await showRecentAssignments(10);

    console.log("\n=".repeat(70));
    console.log("✅ Analysis complete!");

    await mongoose.disconnect();
    console.log("👋 Disconnected from MongoDB\n");
  } catch (error) {
    console.error("\n❌ Analysis failed:", error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

main();
