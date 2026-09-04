/**
 * AgentController - delivery agent API (mounted at /api/delivery).
 * Handler bodies copied verbatim from legacy routes/delivery.js; only require paths changed.
 */
const mongoose = require("mongoose");
const { Order, DeliveryAgent } = require("@models");
const { publish, publishToSeller } = require("@events/orderEvents");
const { buildSnapshot } = require("@lib/orders/snapshot");

class AgentController {
  /**
   * Public endpoint to check delivery agent availability
   * Legacy: GET /api/delivery/check-availability
   */
  async checkAvailability(req, res, next) {
    try {
      const count = await DeliveryAgent.countDocuments({
        approved: true,
        active: true,
        available: true,
      });
      res.json({ available: count > 0, count });
    } catch (error) {
      console.error("Error checking delivery agent availability:", error);
      // Default to available on error to not block orders
      res.json({ available: true, count: 0 });
    }
  }

  /**
   * Update agent location
   * Legacy: POST /api/delivery/update-location
   */
  async updateLocation(req, res, next) {
    try {
      const { agentId, latitude, longitude } = req.body;

      await DeliveryAgent.findByIdAndUpdate(agentId, {
        $set: {
          "current_location.lat": latitude,
          "current_location.lng": longitude,
          "current_location.updated_at": new Date(),
        },
      });

      // Broadcast to any active orders assigned to this agent for sub-10s latency on client side
      try {
        const activeOrders = await Order.find(
          {
            "delivery.delivery_agent_id": agentId,
            "delivery.delivery_status": {
              $in: ["accepted", "picked_up", "in_transit", "assigned"],
            },
          },
          { _id: 1 },
        ).lean();
        const payload = {
          // top-level for client convenience
          agent_location: {
            lat: latitude,
            lng: longitude,
            updated_at: new Date(),
          },
          // nested (back-compat for any existing clients)
          delivery: {
            agent: {
              location: { lat: latitude, lng: longitude, updated_at: new Date() },
            },
          },
        };
        for (const o of activeOrders) {
          publish(String(o._id), payload);
        }
      } catch (_) {}

      res.json({ message: "Location updated successfully" });
    } catch (error) {
      console.error("Error updating location:", error);
      res.status(500).json({ error: "Failed to update location" });
    }
  }

  /**
   * Toggle agent availability
   * Legacy: POST /api/delivery/toggle-availability
   */
  async toggleAvailability(req, res, next) {
    try {
      const { agentId, available, forceOffline } = req.body;

      if (!agentId || !mongoose.isValidObjectId(agentId)) {
        console.error("Invalid or missing agentId:", agentId);
        return res.status(400).json({ error: "Valid agentId required" });
      }

      // Check if agent exists
      const agent = await DeliveryAgent.findById(agentId);
      if (!agent) {
        console.error("DeliveryAgent not found for agentId:", agentId);
        return res.status(404).json({ error: "Delivery agent not found" });
      }

      // Declare these variables outside the if block so they're accessible in the response
      let activeDeliveries = [];
      let pendingOffers = [];

      // If going offline (available=false), check for active deliveries
      if (!available) {
        activeDeliveries = await Order.find({
          "delivery.delivery_agent_id": agentId,
          "delivery.delivery_status": {
            $in: ["assigned", "picked_up", "in_transit"],
          },
        }).lean();

        if (activeDeliveries.length > 0) {
          // Agent has active deliveries
          const pendingPickup = activeDeliveries.filter(
            (o) => o.delivery.delivery_status === "assigned",
          );
          const inProgress = activeDeliveries.filter((o) =>
            ["picked_up", "in_transit"].includes(o.delivery.delivery_status),
          );

          if (!forceOffline) {
            // Block offline toggle, return active delivery info
            return res.status(400).json({
              error: "Cannot go offline with active deliveries",
              canGoOffline: false,
              activeDeliveries: {
                total: activeDeliveries.length,
                pendingPickup: pendingPickup.length,
                inProgress: inProgress.length,
              },
              message:
                inProgress.length > 0
                  ? `You have ${inProgress.length} order(s) in progress. Complete deliveries before going offline.`
                  : `You have ${pendingPickup.length} order(s) waiting for pickup. Accept or reject them before going offline.`,
              orders: activeDeliveries.map((o) => ({
                orderId: o._id,
                status: o.delivery.delivery_status,
                customerAddress: (() => {
                  const da = o.delivery?.delivery_address;
                  if (!da) return undefined;
                  const street = da.street?.trim();
                  const fullAddr = da.full_address?.trim();
                  return [street, fullAddr].filter(Boolean).join(", ");
                })(),
              })),
            });
          } else {
            // Force offline: reassign all active deliveries
            console.log(
              `⚠️ FORCE OFFLINE: Reassigning ${activeDeliveries.length} active deliveries from agent ${agentId}`,
            );

            for (const order of activeDeliveries) {
              // Mark current assignment as "abandoned"
              await Order.findByIdAndUpdate(order._id, {
                $push: {
                  "delivery.assignment_history": {
                    agent_id: agentId,
                    assigned_at: new Date(),
                    response: "timeout", // Using timeout to indicate forced reassignment
                    response_at: new Date(),
                  },
                },
              });

              // Find next available agent
              const triedAgentIds = new Set(
                (order.delivery?.assignment_history || []).map((h) =>
                  String(h.agent_id),
                ),
              );
              triedAgentIds.add(String(agentId));

              const availableAgents = await DeliveryAgent.find({
                approved: true,
                active: true,
                available: true,
                _id: { $nin: Array.from(triedAgentIds) },
              }).lean();

              if (availableAgents.length > 0) {
                const nextAgent = availableAgents[0];
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
                  `  ✓ Order ${order._id} reassigned to ${nextAgent.name}`,
                );
              } else {
                // No agents available
                await Order.findByIdAndUpdate(order._id, {
                  $set: {
                    "delivery.delivery_agent_id": null,
                    "delivery.delivery_agent_response": "pending",
                    "delivery.delivery_status": "pending",
                  },
                });
                console.log(
                  `  ⚠️ Order ${order._id} reset to pending (no agents available)`,
                );
              }
            }
          }
        }

        // Reassign pending offers (orders agent hasn't accepted yet)
        // This includes both "pending" and "assigned" status with "pending" response
        pendingOffers = await Order.find({
          "delivery.delivery_agent_id": agentId,
          "delivery.delivery_agent_response": "pending", // Agent hasn't responded yet
          "delivery.delivery_status": { $in: ["pending", "assigned"] }, // Include both statuses
        });

        if (pendingOffers.length > 0) {
          console.log(
            `🔄 Reassigning ${pendingOffers.length} pending offers from agent ${agentId} (going offline)`,
          );

          for (const order of pendingOffers) {
            try {
              // Mark this assignment as abandoned in history and reset to unassigned in one atomic update
              const updatedOrder = await Order.findByIdAndUpdate(
                order._id,
                {
                  $push: {
                    "delivery.assignment_history": {
                      agent_id: agentId,
                      assigned_at:
                        order.delivery?.assignment_history?.slice(-1)[0]
                          ?.assigned_at || new Date(),
                      response: "agent_went_offline",
                      response_at: new Date(),
                    },
                  },
                  $set: {
                    "delivery.delivery_agent_id": null,
                    "delivery.delivery_agent_response": "pending",
                    "delivery.delivery_status": "pending",
                  },
                },
                { new: true },
              );

              if (updatedOrder) {
                try {
                  const snapshot = await buildSnapshot(updatedOrder);
                  publish(String(updatedOrder._id), snapshot);
                  if (snapshot.seller_id) {
                    publishToSeller(String(snapshot.seller_id), snapshot);
                  }
                } catch (publishErr) {
                  console.error(
                    "Error publishing reassignment event:",
                    publishErr,
                  );
                }
              }
            } catch (reassignErr) {
              console.error(`Error reassigning order ${order._id}:`, reassignErr);
              // Continue with other orders even if one fails
            }
          }
        }
      }

      // Update agent availability and active flag together.
      // Rationale: Assignment filters require both {active:true, available:true}.
      // After logout we set both false; when toggling ON, set both true so the agent is discoverable.
      const updateResult = await DeliveryAgent.findByIdAndUpdate(agentId, {
        $set: { available: available, active: available },
      });

      if (!updateResult) {
        console.error("Failed to update availability for agentId:", agentId);
        return res
          .status(500)
          .json({ error: "Failed to update availability (not updated)" });
      }

      res.json({
        message: `Availability updated to ${
          available ? "available" : "unavailable"
        }`,
        canGoOffline: true,
        reassignedOrders: !available
          ? (activeDeliveries?.length || 0) + (pendingOffers?.length || 0)
          : 0,
      });
    } catch (error) {
      console.error("Error updating availability:", error);
      res.status(500).json({ error: "Failed to update availability" });
    }
  }

  /**
   * Get agent profile
   * Legacy: GET /api/delivery/profile/:agentId
   */
  async getProfile(req, res, next) {
    try {
      const { agentId } = req.params;

      const agent = await DeliveryAgent.findById(agentId);
      if (!agent) {
        return res.status(404).json({ error: "Delivery agent not found" });
      }

      res.json({
        name: agent.name,
        email: agent.email,
        phone: agent.phone,
        vehicle_type: agent.vehicle_type,
        license_number: agent.license_number,
        rating: agent.rating,
        completed_orders: agent.completed_orders,
        active: agent.active,
        available: agent.available,
        // Expose live location if available so clients can poll for tracking
        current_location: agent.current_location
          ? {
              lat: agent.current_location.lat,
              lng: agent.current_location.lng,
              updated_at:
                agent.current_location.updated_at || agent.updatedAt || null,
            }
          : null,
      });
    } catch (error) {
      console.error("Error fetching agent profile:", error);
      res.status(500).json({ error: "Failed to fetch agent profile" });
    }
  }

  /**
   * Logout endpoint - set agent inactive and reassign pending orders
   * Legacy: POST /api/delivery/logout
   */
  async logout(req, res, next) {
    try {
      const { agentId } = req.body;

      if (!agentId || !mongoose.isValidObjectId(agentId)) {
        return res.status(400).json({ error: "Invalid agent ID" });
      }

      // Set agent inactive and offline
      await DeliveryAgent.findByIdAndUpdate(agentId, {
        $set: {
          active: false,
          available: false,
        },
      });

      // Reassign any pending orders (same logic as toggle-availability)
      const ordersToReassign = await Order.find({
        "delivery.delivery_agent_id": agentId,
        "delivery.delivery_status": "pending",
      });

      if (ordersToReassign.length > 0) {
        console.log(
          `🔄 Reassigning ${ordersToReassign.length} pending orders from agent ${agentId} (logout)`,
        );

        for (const order of ordersToReassign) {
          order.delivery.delivery_agent_id = null;
          order.delivery.delivery_agent_response = "pending";
          await order.save();

          try {
            await publishToSeller(order._id.toString(), {
              event: "order-reassigned",
              data: await buildSnapshot(order._id),
            });
          } catch (publishErr) {
            console.error("Error publishing reassignment event:", publishErr);
          }
        }
      }

      res.json({
        message: "Logout successful. Agent set to inactive.",
        reassignedOrders: ordersToReassign.length,
      });
    } catch (error) {
      console.error("Error during agent logout:", error);
      res.status(500).json({ error: "Failed to process logout" });
    }
  }
}

module.exports = new AgentController();
