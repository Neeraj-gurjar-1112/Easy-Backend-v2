const mongoose = require("mongoose");
const { Order, DeliveryAgent } = require("@models");
const { _deleteDeliveryAgentCascade } = require("../../util/helpers");

class DeliveryAgentsController {
  // ---------------- Extended Admin: Delivery Agents ----------------
  async list(req, res) {
    try {
      const { page = 1, limit = 20 } = req.query;
      const skip = (page - 1) * limit;

      const agents = await DeliveryAgent.find()
        .select(
          "name email phone vehicle_type approved active available assigned_orders completed_orders rating created_at",
        )
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(parseInt(limit));

      const total = await DeliveryAgent.countDocuments();

      res.json({
        agents,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      console.error("get delivery agents error", error);
      res.status(500).json({ error: "Failed to get delivery agents" });
    }
  }

  async pending(req, res) {
    try {
      const pendingAgents = await DeliveryAgent.find({ approved: false })
        .select("name email phone vehicle_type license_number created_at")
        .sort({ created_at: -1 });

      res.json(pendingAgents);
    } catch (error) {
      console.error("get pending delivery agents error", error);
      res.status(500).json({ error: "Failed to get pending delivery agents" });
    }
  }

  async approve(req, res) {
    try {
      const { id } = req.params;

      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ error: "Invalid delivery agent ID" });
      }

      const agent = await DeliveryAgent.findByIdAndUpdate(
        id,
        { $set: { approved: true } },
        { new: true },
      );

      if (!agent) {
        return res.status(404).json({ error: "Delivery agent not found" });
      }

      res.json({ message: "Delivery agent approved successfully", agent });
    } catch (error) {
      console.error("approve delivery agent error", error);
      res.status(500).json({ error: "Failed to approve delivery agent" });
    }
  }

  async reject(req, res) {
    try {
      const { id } = req.params;

      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ error: "Invalid delivery agent ID" });
      }

      const agent = await DeliveryAgent.findByIdAndUpdate(
        id,
        { $set: { approved: false, active: false } },
        { new: true },
      );

      if (!agent) {
        return res.status(404).json({ error: "Delivery agent not found" });
      }

      res.json({
        message: "Delivery agent rejected/suspended successfully",
        agent,
      });
    } catch (error) {
      console.error("reject delivery agent error", error);
      res.status(500).json({ error: "Failed to reject delivery agent" });
    }
  }

  async getOne(req, res) {
    try {
      const { id } = req.params;

      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ error: "Invalid delivery agent ID" });
      }

      const agent = await DeliveryAgent.findById(id);
      if (!agent) {
        return res.status(404).json({ error: "Delivery agent not found" });
      }

      // Get agent's delivery statistics
      const deliveryStats = await Order.aggregate([
        {
          $match: {
            "delivery.delivery_agent_id": new mongoose.Types.ObjectId(id),
          },
        },
        {
          $group: {
            _id: "$delivery.delivery_status",
            count: { $sum: 1 },
          },
        },
      ]);

      // Get recent orders for this agent
      const recentOrders = await Order.find({
        "delivery.delivery_agent_id": new mongoose.Types.ObjectId(id),
      })
        .select(
          "_id payment delivery.delivery_status delivery.delivery_charge created_at",
        )
        .sort({ created_at: -1 })
        .limit(5)
        .lean();

      // Format recent orders with correct total (items + delivery charge)
      const formattedRecentOrders = recentOrders.map((order) => {
        const itemsTotal = Number(order.payment?.amount || 0);
        const deliveryCharge = Number(order.delivery?.delivery_charge || 0);
        const total = itemsTotal + deliveryCharge;

        return {
          _id: order._id,
          order_id: order._id,
          status: order.delivery?.delivery_status || "unknown",
          total: total,
          items_total: itemsTotal,
          delivery_charge: deliveryCharge,
        };
      });

      res.json({
        ...agent.toObject(),
        recent_orders: formattedRecentOrders,
        deliveryStats,
      });
    } catch (error) {
      console.error("get delivery agent details error", error);
      res.status(500).json({ error: "Failed to get delivery agent details" });
    }
  }

  async update(req, res) {
    try {
      const { id } = req.params;

      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ error: "Invalid delivery agent ID" });
      }

      const agent = await DeliveryAgent.findByIdAndUpdate(
        id,
        { $set: req.body },
        { new: true, runValidators: true },
      );

      if (!agent) {
        return res.status(404).json({ error: "Delivery agent not found" });
      }

      res.json(agent);
    } catch (error) {
      console.error("update delivery agent error", error);
      res.status(500).json({ error: "Failed to update delivery agent" });
    }
  }

  // Delivery Agents full deletion
  async remove(req, res) {
    try {
      const { id } = req.params;
      const full = req.query.full === "1" || req.query.full === "true";
      if (!mongoose.isValidObjectId(id))
        return res.status(400).json({ error: "invalid delivery agent id" });
      const agent = await DeliveryAgent.findById(id);
      if (!agent)
        return res.status(404).json({ error: "delivery agent not found" });
      await agent.deleteOne();
      const cascade = await _deleteDeliveryAgentCascade(agent, {}, full);
      res.json({ message: "Delivery agent deleted", full, cascade });
    } catch (e) {
      console.error("delete delivery agent error", e);
      res.status(500).json({ error: "Failed to delete delivery agent" });
    }
  }
}

module.exports = new DeliveryAgentsController();
