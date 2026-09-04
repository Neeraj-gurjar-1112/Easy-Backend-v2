/**
 * MaintenanceController - delivery agent API (mounted at /api/delivery).
 * Handler bodies copied verbatim from legacy routes/delivery.js; only require paths changed.
 */
const { Order, DeliveryAgent, Product } = require("@models");
const { publish, publishToSeller } = require("@events/orderEvents");
const { notifyOrderUpdate } = require("@push");
const { buildSnapshot } = require("@lib/orders/snapshot");
const { calculateDistance } = require("./helpers");

class MaintenanceController {
  /**
   * Check for timed-out orders and reassign to next nearest agent
   * This endpoint should be called periodically (e.g., every minute) by a cron job or scheduler
   * Legacy: POST /api/delivery/check-timeouts
   */
  async checkTimeouts(req, res, next) {
    try {
      const TIMEOUT_MINUTES = 3; // Orders pending acceptance for more than 3 minutes will be reassigned
      const timeoutThreshold = new Date(Date.now() - TIMEOUT_MINUTES * 60 * 1000);

      // Optimized: Find orders assigned to agents but not accepted within timeout period
      // Added limit and select to reduce memory usage
      const timedOutOrders = await Order.find({
        "delivery.delivery_status": "assigned",
        "delivery.delivery_agent_response": "pending",
      })
        .limit(50) // Process max 50 orders per cron run to prevent overload
        .lean();

      // Quick exit if no orders found
      if (timedOutOrders.length === 0) {
        console.log("⏰ Found 0 timed-out orders to reassign");
        return res.json({ timedOutOrders: 0, reassignedCount: 0 });
      }

      const ordersToReassign = [];
      for (const order of timedOutOrders) {
        // Check if the most recent assignment is past the timeout
        const history = order.delivery?.assignment_history || [];
        const lastAssignment = history[history.length - 1];
        if (
          lastAssignment &&
          lastAssignment.response === "pending" &&
          new Date(lastAssignment.assigned_at) < timeoutThreshold
        ) {
          ordersToReassign.push(order);
        }
      }

      console.log(
        `⏰ Found ${ordersToReassign.length} timed-out orders to reassign`,
      );

      let reassignedCount = 0;
      for (const order of ordersToReassign) {
        try {
          // Get tried agent IDs
          const triedAgentIds = new Set(
            (order.delivery?.assignment_history || []).map((h) =>
              String(h.agent_id),
            ),
          );

          // Get store location
          let storeLat, storeLng;
          const itemProductIds = (order.order_items || [])
            .map((i) => i && i.product_id)
            .filter(Boolean);
          if (itemProductIds.length) {
            const firstProduct = await Product.findById(
              itemProductIds[0],
            ).populate("seller_id");
            if (
              firstProduct?.seller_id?.location?.lat &&
              firstProduct?.seller_id?.location?.lng
            ) {
              storeLat = firstProduct.seller_id.location.lat;
              storeLng = firstProduct.seller_id.location.lng;
            }
          }

          if (!storeLat || !storeLng) {
            storeLat =
              order.pickup_address?.location?.lat ||
              order.delivery_address?.location?.lat;
            storeLng =
              order.pickup_address?.location?.lng ||
              order.delivery_address?.location?.lng;
          }

          // Find available agents who haven't been tried
          const availableAgents = await DeliveryAgent.find({
            approved: true,
            active: true,
            available: true,
            _id: { $nin: Array.from(triedAgentIds) },
          }).lean();

          let nextAgent = null;
          if (availableAgents.length > 0 && storeLat && storeLng) {
            const agentsWithDistance = availableAgents
              .filter(
                (agent) =>
                  agent.current_location?.lat && agent.current_location?.lng,
              )
              .map((agent) => ({
                agent,
                distance: calculateDistance(
                  storeLat,
                  storeLng,
                  agent.current_location.lat,
                  agent.current_location.lng,
                ),
              }))
              .sort((a, b) => a.distance - b.distance);

            if (agentsWithDistance.length > 0) {
              nextAgent = agentsWithDistance[0].agent;
            } else {
              nextAgent = availableAgents.sort(
                (a, b) => a.assigned_orders - b.assigned_orders,
              )[0];
            }
          } else if (availableAgents.length > 0) {
            nextAgent = availableAgents.sort(
              (a, b) => a.assigned_orders - b.assigned_orders,
            )[0];
          }

          if (nextAgent) {
            // Step 1: Mark last assignment as "timeout"
            await Order.findByIdAndUpdate(
              order._id,
              {
                $set: {
                  "delivery.assignment_history.$[last].response": "timeout",
                  "delivery.assignment_history.$[last].response_at": new Date(),
                },
              },
              {
                arrayFilters: [{ "last.response": "pending" }],
              },
            );

            // Step 2: Add new assignment and update delivery info
            await Order.findByIdAndUpdate(order._id, {
              $set: {
                "delivery.delivery_agent_id": nextAgent._id,
                "delivery.delivery_agent_response": "pending",
                "delivery.delivery_status": "assigned",
              },
              $push: {
                "delivery.assignment_history": {
                  agent_id: nextAgent._id,
                  assigned_at: new Date(),
                  response: "pending",
                },
              },
            });

            console.log(
              `⏰ Order ${order._id} reassigned from timeout to agent ${nextAgent.name}`,
            );
            reassignedCount++;

            // Notify via SSE and Push Notifications
            try {
              const updatedOrder = await Order.findById(order._id)
                .populate("client_id")
                .populate("delivery.delivery_agent_id")
                .lean();
              const snapshot = await buildSnapshot(updatedOrder);
              publish(String(order._id), snapshot);
              if (snapshot.seller_id) {
                publishToSeller(String(snapshot.seller_id), snapshot);
              }
              // Send push notification to new delivery agent
              await notifyOrderUpdate(updatedOrder, snapshot, {
                exclude: ["seller"],
              });
            } catch (publishErr) {
              console.error("Error publishing timeout reassignment:", publishErr);
            }
          } else {
            // No agents available, mark as pending
            await Order.findByIdAndUpdate(order._id, {
              $set: {
                "delivery.delivery_agent_id": null,
                "delivery.delivery_agent_response": "pending",
                "delivery.delivery_status": "pending",
              },
            });
            console.log(
              `⏰ Order ${order._id} marked as pending (no agents available after timeout)`,
            );
          }
        } catch (err) {
          console.error(`Error reassigning timed-out order ${order._id}:`, err);
        }
      }

      res.json({
        message: "Timeout check completed",
        timedOutOrders: ordersToReassign.length,
        reassignedCount,
      });
    } catch (error) {
      console.error("Error checking timeouts:", error);
      res.status(500).json({ error: "Failed to check timeouts" });
    }
  }

  /**
   * ========================================================================
   * RETRY ABANDONED PENDING ORDERS
   * ========================================================================
   * Called by cron job to reassign orders that were marked "pending" due to
   * no agents being available. Prevents orders from being abandoned indefinitely.
   * Legacy: POST /api/delivery/retry-pending-orders
   */
  async retryPendingOrders(req, res, next) {
    try {
      const MAX_RETRY_ATTEMPTS = 10; // Prevent infinite retries
      const RETRY_COOLDOWN_MINUTES = 2; // Wait 2 min between retries
      const MAX_CONCURRENT_DELIVERIES = 3; // Agent capacity limit

      // Optimized: Find truly pending orders (paid but no agent assigned)
      // Added limit to prevent processing too many orders at once
      const pendingOrders = await Order.find({
        "delivery.delivery_status": "pending",
        "delivery.delivery_agent_id": null,
      })
        .sort({ created_at: 1 }) // Oldest first (FIFO priority)
        .limit(20); // Process max 20 orders per cron run

      if (pendingOrders.length === 0) {
        // Silent return - no need to log every time
        return res.json({
          message: "No pending orders to retry",
          total_pending: 0,
          assigned: 0,
          escalated: 0,
        });
      }

      console.log(
        `🔄 Found ${pendingOrders.length} abandoned pending orders to retry`,
      );

      let assignedCount = 0;
      let escalatedCount = 0;
      let skippedCount = 0;

      // Log available agents for debugging (only if there are pending orders)
      const allAgents = await DeliveryAgent.countDocuments({
        approved: true,
        active: true,
        available: true,
      });
      console.log(
        `📋 ${allAgents} delivery agents currently available (approved, active, available)`,
      );

      // Quick exit if no agents available
      if (allAgents === 0) {
        console.log("⏳ No orders ready for retry (no agents available)");
        return res.json({
          message: "No agents available",
          total_pending: pendingOrders.length,
          assigned: 0,
          escalated: 0,
          skipped: pendingOrders.length,
        });
      }

      for (const order of pendingOrders) {
        // Check retry attempts
        const attemptCount = order.delivery?.assignment_history?.length || 0;

        if (attemptCount >= MAX_RETRY_ATTEMPTS) {
          // ESCALATE: Too many failed attempts
          console.log(
            `🚨 Order ${order._id} exceeded ${MAX_RETRY_ATTEMPTS} retry attempts - escalating for admin intervention`,
          );

          await Order.findByIdAndUpdate(order._id, {
            $set: {
              "delivery.delivery_status": "escalated",
              "delivery.escalated_at": new Date(),
              "delivery.escalation_reason": `No delivery agents available after ${MAX_RETRY_ATTEMPTS} attempts`,
            },
          });
          escalatedCount++;

          // TODO: Send admin notification/email here
          // Example: await sendAdminNotification(order);

          continue;
        }

        // Check cooldown (don't retry same order constantly)
        const lastAttempt =
          order.delivery?.assignment_history?.[attemptCount - 1];
        if (lastAttempt) {
          const minutesSinceLastAttempt =
            (Date.now() - new Date(lastAttempt.assigned_at)) / 60000;
          if (minutesSinceLastAttempt < RETRY_COOLDOWN_MINUTES) {
            skippedCount++;
            continue; // Skip without logging (too noisy)
          }
        }

        // Get store location for distance calculation
        let storeLat, storeLng;
        const firstItem = order.items?.[0];
        if (firstItem?.product_id) {
          const product = await Product.findById(firstItem.product_id).populate(
            "seller_id",
          );
          if (
            product?.seller_id?.location?.lat &&
            product?.seller_id?.location?.lng
          ) {
            storeLat = product.seller_id.location.lat;
            storeLng = product.seller_id.location.lng;
          }
        }

        // Fallback to pickup or delivery address
        if (!storeLat || !storeLng) {
          storeLat =
            order.pickup_address?.location?.lat ||
            order.delivery_address?.location?.lat ||
            order.delivery?.pickup_address?.location?.lat ||
            order.delivery?.delivery_address?.location?.lat;
          storeLng =
            order.pickup_address?.location?.lng ||
            order.delivery_address?.location?.lng ||
            order.delivery?.pickup_address?.location?.lng ||
            order.delivery?.delivery_address?.location?.lng;
        }

        // Find available agents
        const availableAgents = await DeliveryAgent.find({
          approved: true,
          active: true,
          available: true,
        }).lean();

        if (availableAgents.length === 0) {
          skippedCount++;
          continue; // No agents online at all
        }

        // Filter by capacity
        const agentsWithCapacity = await Promise.all(
          availableAgents.map(async (agent) => {
            const activeDeliveries = await Order.countDocuments({
              "delivery.delivery_agent_id": agent._id,
              "delivery.delivery_status": {
                $in: ["assigned", "picked_up", "in_transit"],
              },
            });
            return activeDeliveries < MAX_CONCURRENT_DELIVERIES ? agent : null;
          }),
        );

        const availableAgentsWithCapacity = agentsWithCapacity.filter(
          (a) => a !== null,
        );

        if (availableAgentsWithCapacity.length === 0) {
          skippedCount++;
          continue; // All agents at capacity
        }

        // Get recently tried agent IDs (within last 5 minutes)
        // Allow re-trying agents after cooldown period
        const AGENT_RETRY_COOLDOWN_MINUTES = 5;
        const recentlyTriedAgentIds = new Set(
          (order.delivery?.assignment_history || [])
            .filter((h) => {
              const minutesSinceAttempt =
                (Date.now() - new Date(h.assigned_at)) / 60000;
              return minutesSinceAttempt < AGENT_RETRY_COOLDOWN_MINUTES;
            })
            .map((h) => String(h.agent_id)),
        );

        // Filter out recently-tried agents (but allow agents tried >5 min ago)
        const untriedAgents = availableAgentsWithCapacity.filter(
          (agent) => !recentlyTriedAgentIds.has(String(agent._id)),
        );

        if (untriedAgents.length === 0) {
          console.log(
            `⏳ Order ${order._id} - no agents available for retry (${availableAgentsWithCapacity.length} agents have capacity but tried within last ${AGENT_RETRY_COOLDOWN_MINUTES} min)`,
          );
          skippedCount++;
          continue;
        }

        // Select nearest untried agent
        let selectedAgent = null;
        if (storeLat && storeLng) {
          const agentsWithDistance = untriedAgents
            .filter(
              (agent) =>
                agent.current_location?.lat && agent.current_location?.lng,
            )
            .map((agent) => ({
              agent,
              distance: calculateDistance(
                storeLat,
                storeLng,
                agent.current_location.lat,
                agent.current_location.lng,
              ),
            }))
            .sort((a, b) => a.distance - b.distance);

          if (agentsWithDistance.length > 0) {
            selectedAgent = agentsWithDistance[0].agent;
          }
        }

        // Fallback: least assigned
        if (!selectedAgent) {
          selectedAgent = untriedAgents.sort(
            (a, b) => (a.assigned_orders || 0) - (b.assigned_orders || 0),
          )[0];
        }

        // Assign order
        await Order.findByIdAndUpdate(order._id, {
          $set: {
            "delivery.delivery_agent_id": selectedAgent._id,
            "delivery.delivery_agent_response": "pending",
            "delivery.delivery_status": "assigned",
          },
          $push: {
            "delivery.assignment_history": {
              agent_id: selectedAgent._id,
              assigned_at: new Date(),
              response: "pending",
            },
          },
        });

        // Increment agent's assigned orders count
        await DeliveryAgent.findByIdAndUpdate(selectedAgent._id, {
          $inc: { assigned_orders: 1 },
        });

        console.log(
          `✅ Retry: Order ${order._id} assigned to agent ${
            selectedAgent.name
          } (attempt ${attemptCount + 1}/${MAX_RETRY_ATTEMPTS})`,
        );
        assignedCount++;

        // Send SSE notification
        try {
          const updatedOrder = await Order.findById(order._id)
            .populate("client_id")
            .populate("delivery.delivery_agent_id")
            .lean();
          const snapshot = buildSnapshot(updatedOrder);
          publish(String(order._id), snapshot);
          await notifyOrderUpdate(updatedOrder, snapshot);
        } catch (err) {
          console.error(`Failed to notify order ${order._id}:`, err.message);
        }
      }

      const responseMessage =
        assignedCount > 0 || escalatedCount > 0
          ? `✅ Retry complete: ${assignedCount} assigned, ${escalatedCount} escalated, ${skippedCount} skipped`
          : null; // Don't log if nothing happened

      // Only log if there was actual activity
      if (responseMessage) {
        console.log(responseMessage);
      } else if (skippedCount > 0) {
        console.log(
          `⏳ No orders ready for retry (${skippedCount} in cooldown or no agents available)`,
        );
      }

      res.json({
        message: responseMessage || "No action taken",
        assigned: assignedCount,
        escalated: escalatedCount,
        skipped: skippedCount,
        total_pending: pendingOrders.length,
      });
    } catch (error) {
      console.error("Error retrying pending orders:", error);
      res.status(500).json({ error: "Failed to retry pending orders" });
    }
  }
}

module.exports = new MaintenanceController();
