const { Seller, DeliveryAgent, Order } = require("@models");
const mongoose = require("mongoose");
const sellerEvents = require("@events/sellerEvents");
const {
  calculateDistance,
  MAX_CONCURRENT_DELIVERIES,
  NEARBY_RADIUS_KM,
} = require("./helpers");

class StoreController {
  // Toggle seller open/closed status (availability)
  // POST /toggle-open
  async toggleOpen(req, res) {
    try {
      const { open } = req.body || {};
      if (typeof open !== "boolean")
        return res.status(400).json({ error: "boolean open required" });
      const updated = await Seller.findByIdAndUpdate(
        req.sellerId,
        { $set: { is_open: open } },
        { new: true, projection: { business_name: 1, is_open: 1 } },
      );
      if (!updated) return res.status(404).json({ error: "seller not found" });

      // Broadcast status change to all connected clients
      sellerEvents.broadcastSellerStatus(req.sellerId, updated.is_open);

      res.json({ success: true, is_open: updated.is_open });
    } catch (e) {
      console.error("toggle-open error", e);
      res.status(500).json({ error: "failed to update open state" });
    }
  }

  // GET /api/seller/:sellerId/status - Get seller/restaurant open/closed status (public)
  async getStatus(req, res) {
    try {
      const { sellerId } = req.params;
      if (!sellerId || !mongoose.isValidObjectId(sellerId)) {
        return res.status(400).json({ error: "valid sellerId required" });
      }

      const seller = await Seller.findById(sellerId)
        .select("business_name is_open approved")
        .lean();

      if (!seller) {
        return res.status(404).json({ error: "seller not found" });
      }

      res.json({
        seller_id: sellerId,
        business_name: seller.business_name,
        is_open: typeof seller.is_open === "boolean" ? seller.is_open : true,
        approved: seller.approved || false,
      });
    } catch (e) {
      console.error("seller status error", e);
      res.status(500).json({ error: "failed to fetch seller status" });
    }
  }

  // SSE endpoint for real-time seller status updates (public - no auth required)
  // Clients connect here to receive instant notifications when sellers open/close
  // GET /status-stream
  statusStream(req, res) {
    try {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.flushHeaders?.();

      // Send initial connection confirmation
      res.write(": connected\n\n");

      // Add client to broadcast list
      sellerEvents.addClient(res);

      console.log(
        `[SSE] Client connected to seller status stream. Total clients: ${
          sellerEvents.getStats().connectedClients
        }`,
      );
    } catch (e) {
      console.error("Seller status stream error:", e);
      try {
        res.status(500).end();
      } catch (_) {}
    }
  }

  // ============================================================================
  // DELIVERY AGENT AVAILABILITY CHECK (Before Order Acceptance)
  // ============================================================================

  /**
   * Check delivery agent availability before accepting an order
   * Returns: total online agents, nearby agents, agent capacity info
   *
   * POST /api/seller/check-delivery-availability
   * Body: { storeLocation: { lat, lng }, orderId? }
   */
  async checkDeliveryAvailability(req, res) {
    try {
      const { storeLocation, orderId } = req.body;

      if (!storeLocation || !storeLocation.lat || !storeLocation.lng) {
        return res
          .status(400)
          .json({ error: "Store location (lat, lng) required" });
      }

      // MAX_CONCURRENT_DELIVERIES / NEARBY_RADIUS_KM come from ./helpers (same values as legacy)

      // Get all approved, active agents
      const allAgents = await DeliveryAgent.find({
        approved: true,
        active: true,
      }).lean();

      // Count agents by availability status
      const onlineAgents = allAgents.filter((a) => a.available);
      const offlineAgents = allAgents.filter((a) => !a.available);

      // Calculate active deliveries for each online agent
      const agentsWithCapacity = await Promise.all(
        onlineAgents.map(async (agent) => {
          // Count active deliveries (assigned, picked_up, in_transit)
          const activeDeliveries = await Order.countDocuments({
            "delivery.delivery_agent_id": agent._id,
            "delivery.delivery_status": {
              $in: ["assigned", "picked_up", "in_transit"],
            },
          });

          const availableCapacity = MAX_CONCURRENT_DELIVERIES - activeDeliveries;
          const hasCapacity = availableCapacity > 0;

          // Calculate distance if location available
          let distance = null;
          if (agent.current_location?.lat && agent.current_location?.lng) {
            distance = calculateDistance(
              storeLocation.lat,
              storeLocation.lng,
              agent.current_location.lat,
              agent.current_location.lng,
            );
          }

          return {
            agentId: agent._id,
            name: agent.name,
            activeDeliveries,
            availableCapacity,
            hasCapacity,
            distance,
            isNearby: distance !== null && distance <= NEARBY_RADIUS_KM,
          };
        }),
      );

      // Filter agents with capacity
      const availableAgents = agentsWithCapacity.filter((a) => a.hasCapacity);
      const nearbyAvailableAgents = availableAgents.filter((a) => a.isNearby);

      // Find nearest available agent
      const agentsWithDistance = availableAgents.filter(
        (a) => a.distance !== null,
      );
      agentsWithDistance.sort((a, b) => a.distance - b.distance);
      const nearestAgent =
        agentsWithDistance.length > 0 ? agentsWithDistance[0] : null;

      // Calculate estimated wait time based on agent load
      let estimatedWaitMinutes = 0;
      if (availableAgents.length === 0) {
        estimatedWaitMinutes = 15; // No agents available, might take 15+ min
      } else if (nearbyAvailableAgents.length === 0) {
        estimatedWaitMinutes = 10; // Agents available but far away
      } else {
        const avgLoad =
          nearbyAvailableAgents.reduce((sum, a) => sum + a.activeDeliveries, 0) /
          nearbyAvailableAgents.length;
        estimatedWaitMinutes = Math.ceil(avgLoad * 2); // Each active delivery adds ~2 min delay
      }

      // Recommendation
      let recommendation = "proceed";
      let message = "Delivery agents available";

      if (availableAgents.length === 0) {
        recommendation = "warn";
        message = "No delivery agents available. Order may be delayed or queued.";
      } else if (nearbyAvailableAgents.length === 0 && nearestAgent) {
        recommendation = "caution";
        message = `Nearest agent is ${nearestAgent.distance.toFixed(
          1,
        )}km away. Pickup may be delayed.`;
      } else if (nearbyAvailableAgents.length <= 2) {
        recommendation = "caution";
        message = "Limited agents nearby. Consider order timing.";
      }

      res.json({
        success: true,
        availability: {
          totalAgents: allAgents.length,
          onlineAgents: onlineAgents.length,
          offlineAgents: offlineAgents.length,
          availableAgents: availableAgents.length,
          nearbyAvailableAgents: nearbyAvailableAgents.length,
          agentsAtCapacity: onlineAgents.length - availableAgents.length,
        },
        nearestAgent: nearestAgent
          ? {
              name: nearestAgent.name,
              distance: parseFloat(nearestAgent.distance.toFixed(2)),
              activeDeliveries: nearestAgent.activeDeliveries,
              availableCapacity: nearestAgent.availableCapacity,
            }
          : null,
        estimatedWaitMinutes,
        recommendation,
        message,
        details: {
          maxConcurrentDeliveries: MAX_CONCURRENT_DELIVERIES,
          nearbyRadiusKm: NEARBY_RADIUS_KM,
        },
      });
    } catch (error) {
      console.error("Error checking delivery availability:", error);
      res.status(500).json({ error: "Failed to check delivery availability" });
    }
  }
}

module.exports = new StoreController();
