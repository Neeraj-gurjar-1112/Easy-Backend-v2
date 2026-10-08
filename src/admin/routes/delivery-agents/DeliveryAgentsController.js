const mongoose = require("mongoose");
const { Order, DeliveryAgent } = require("@models");
const { _deleteDeliveryAgentCascade } = require("../../util/helpers");
const { SORT_FIELDS } = require("./DeliveryAgentsValidations");

// Fields the list and every mutation response expose. Password / reset tokens never leave the API.
const PUBLIC_FIELDS =
  "name email phone vehicle_type license_number approved active available assigned_orders completed_orders rating total_ratings working_hours current_location created_at";
const HIDDEN_FIELDS = [
  "password",
  "resetPasswordToken",
  "resetPasswordExpires",
  "__v",
];

// Body keys an admin may change through PATCH (schema-validated in DeliveryAgentsValidations)
const UPDATABLE_FIELDS = [
  "name",
  "email",
  "phone",
  "vehicle_type",
  "license_number",
  "approved",
  "active",
  "available",
  "working_hours",
];

function toPublic(doc) {
  const obj = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  for (const key of HIDDEN_FIELDS) delete obj[key];
  return obj;
}

/** 400 body for a duplicate email — field-level so the form can show it under the Email input. */
function emailTaken() {
  return {
    error: "Email is already registered",
    details: [{ field: "email", message: "Email is already registered" }],
  };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Search regex: plain text matches name / email; a digit string matches the phone with any separators. */
function searchFilter(q) {
  const term = (q || "").trim();
  if (!term) return null;
  const digits = term.replace(/\D/g, "");
  const or = [
    { name: new RegExp(escapeRegex(term), "i") },
    { email: new RegExp(escapeRegex(term), "i") },
  ];
  if (digits.length >= 3)
    or.push({ phone: new RegExp(digits.split("").join("\\D*")) });
  else or.push({ phone: new RegExp(escapeRegex(term), "i") });
  return { $or: or };
}

/** Presence is derived from two booleans: active (account on) and available (free for orders). */
function presenceFilter(presence) {
  switch (presence) {
    case "online":
      return { active: true, available: true };
    case "busy":
      return { active: true, available: false };
    case "offline":
      return { active: false };
    default:
      return null;
  }
}

/** Counters for the KPI tiles — one aggregation over the whole collection. */
async function buildSummary() {
  const [row] = await DeliveryAgent.aggregate([
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        pending: { $sum: { $cond: [{ $eq: ["$approved", false] }, 1, 0] } },
        online: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$active", true] },
                  { $eq: ["$available", true] },
                ],
              },
              1,
              0,
            ],
          },
        },
        busy: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$active", true] },
                  { $eq: ["$available", false] },
                ],
              },
              1,
              0,
            ],
          },
        },
        offline: { $sum: { $cond: [{ $eq: ["$active", false] }, 1, 0] } },
        ratingSum: { $sum: { $cond: [{ $gt: ["$rating", 0] }, "$rating", 0] } },
        rated: { $sum: { $cond: [{ $gt: ["$rating", 0] }, 1, 0] } },
      },
    },
  ]);
  if (!row)
    return {
      total: 0,
      pending: 0,
      online: 0,
      busy: 0,
      offline: 0,
      avgRating: 0,
    };
  const { total, pending, online, busy, offline, ratingSum, rated } = row;
  return {
    total,
    pending,
    online,
    busy,
    offline,
    avgRating: rated ? Math.round((ratingSum / rated) * 10) / 10 : 0,
  };
}

class DeliveryAgentsController {
  // ---------------- Extended Admin: Delivery Agents ----------------
  // GET /delivery-agents?page&limit&q&vehicle_type&approval&presence&sort&order
  // Legacy shape { agents, pagination } is unchanged (the EJS panel and Flutter admin read it);
  // the filters and `summary` are additions for the Next.js admin.
  async list(req, res) {
    try {
      const { page, limit, q, vehicle_type, approval, presence, sort, order } =
        req.query;

      const filter = {};
      const search = searchFilter(q);
      if (search) Object.assign(filter, search);
      if (vehicle_type) filter.vehicle_type = vehicle_type;
      if (approval === "approved") filter.approved = true;
      if (approval === "pending") filter.approved = false;
      Object.assign(filter, presenceFilter(presence) || {});

      const sortField = SORT_FIELDS.includes(sort) ? sort : "created_at";
      const direction = order === "asc" ? 1 : -1;

      const [agents, total, summary] = await Promise.all([
        DeliveryAgent.find(filter)
          .select(PUBLIC_FIELDS)
          .sort({ [sortField]: direction, _id: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        DeliveryAgent.countDocuments(filter),
        buildSummary(),
      ]);

      res.json({
        agents,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        summary,
      });
    } catch (error) {
      console.error("get delivery agents error", error);
      res.status(500).json({ error: "Failed to get delivery agents" });
    }
  }

  // GET /delivery-agents/summary — the counters alone (dashboard tiles)
  async summary(req, res) {
    try {
      res.json(await buildSummary());
    } catch (error) {
      console.error("delivery agents summary error", error);
      res.status(500).json({ error: "Failed to get delivery agents summary" });
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

      res.json({
        message: "Delivery agent approved successfully",
        agent: toPublic(agent),
      });
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
        agent: toPublic(agent),
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
          created_at: order.created_at,
        };
      });

      res.json({
        ...toPublic(agent),
        recent_orders: formattedRecentOrders,
        deliveryStats,
      });
    } catch (error) {
      console.error("get delivery agent details error", error);
      res.status(500).json({ error: "Failed to get delivery agent details" });
    }
  }

  // POST /delivery-agents — admin creates an agent directly (the partner app self-signup stays as is)
  async create(req, res) {
    try {
      const body = req.body; // validated + cleaned by validateAndClean(createAgentSchema)

      const existing = await DeliveryAgent.findOne({ email: body.email })
        .select("_id")
        .lean();
      if (existing) {
        return res.status(400).json(emailTaken());
      }

      const agent = new DeliveryAgent({
        ...body,
        password: body.password || undefined,
      });
      await agent.save(); // pre-save hook hashes the password

      console.log(
        `[ADMIN] Delivery agent created: ${agent.email} by ${req.admin?.email}`,
      );
      res
        .status(201)
        .json({ message: "Delivery agent created", agent: toPublic(agent) });
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(400).json(emailTaken());
      }
      if (error?.name === "ValidationError") {
        const details = Object.values(error.errors).map((e) => ({
          field: e.path,
          message: e.message,
        }));
        return res.status(400).json({ error: "Validation failed", details });
      }
      console.error("create delivery agent error", error);
      res.status(500).json({ error: "Failed to create delivery agent" });
    }
  }

  // PATCH /delivery-agents/:id — only whitelisted fields; a new password goes through save() so it is hashed
  async update(req, res) {
    try {
      const { id } = req.params;

      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ error: "Invalid delivery agent ID" });
      }

      const agent = await DeliveryAgent.findById(id);
      if (!agent) {
        return res.status(404).json({ error: "Delivery agent not found" });
      }

      if (req.body.email && req.body.email !== agent.email) {
        const taken = await DeliveryAgent.findOne({
          email: req.body.email,
          _id: { $ne: agent._id },
        })
          .select("_id")
          .lean();
        if (taken) return res.status(400).json(emailTaken());
      }

      for (const key of UPDATABLE_FIELDS) {
        if (req.body[key] !== undefined)
          agent.set(key, req.body[key] === "" ? null : req.body[key]);
      }
      if (req.body.password) agent.password = req.body.password;

      await agent.save();
      res.json(toPublic(agent));
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(400).json(emailTaken());
      }
      if (error?.name === "ValidationError") {
        const details = Object.values(error.errors).map((e) => ({
          field: e.path,
          message: e.message,
        }));
        return res.status(400).json({ error: "Validation failed", details });
      }
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
