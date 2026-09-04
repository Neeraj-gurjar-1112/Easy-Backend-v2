const mongoose = require("mongoose");
const {
  Seller,
  Order,
  UserAddress,
  DeliveryAgent,
  EarningLog,
} = require("@models");
// Reuse core order state handlers for payment + delivery updates
const { verifyPayment, updateDelivery } = require("@lib/orders/handlers");
const { buildSnapshot, buildEnrichedSnapshot } = require("@lib/orders/snapshot");
// Deliberate fix vs legacy: assign-delivery-agent called publish/publishToSeller
// without importing them (ReferenceError swallowed by its try/catch).
const {
  publish,
  publishToSeller,
  publishToAdmin,
} = require("@events/orderEvents");
const { _geocodeAddress, _placeDetails } = require("../../util/helpers");

function _parseLatLngText(text) {
  if (typeof text !== "string") return null;
  const m = text
    .trim()
    .match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const plat = Number(m[1]);
  const plng = Number(m[2]);
  if (Number.isNaN(plat) || Number.isNaN(plng)) return null;
  return { lat: plat, lng: plng };
}

class OrdersController {
  // -------- One-off repair: fix a specific order's delivery address coords --------
  async fixAddress(req, res) {
    try {
      const GOOGLE_KEY =
        process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY || "";
      if (!GOOGLE_KEY) {
        return res
          .status(400)
          .json({ error: "GOOGLE_MAPS_API_KEY not configured on server" });
      }
      const { orderId } = req.params;
      const { address, lat, lng, place_id } = req.body || {};
      let order = null;
      // Accept either Mongo _id or custom order_id/id
      if (mongoose.isValidObjectId(orderId)) {
        order = await Order.findById(orderId);
      }
      if (!order) {
        order = await Order.findOne({
          $or: [
            { order_id: orderId },
            { id: orderId },
            ...(mongoose.isValidObjectId(orderId) ? [{ _id: orderId }] : []),
          ],
        });
      }
      if (!order) return res.status(404).json({ error: "Order not found" });

      order.delivery = order.delivery || {};
      order.delivery.delivery_address = order.delivery.delivery_address || {};
      const da = order.delivery.delivery_address;

      // 1) Determine UA, if any
      let ua = null;
      if (da.address_id) {
        try {
          ua = await UserAddress.findById(da.address_id);
        } catch (_) {}
      }
      if (
        !ua &&
        typeof da.full_address === "string" &&
        /^[0-9a-fA-F]{24}$/.test(da.full_address)
      ) {
        try {
          ua = await UserAddress.findById(da.full_address);
        } catch (_) {}
      }

      // 2) Direct lat/lng in body
      const nlat = typeof lat === "string" ? Number(lat) : lat;
      const nlng = typeof lng === "string" ? Number(lng) : lng;
      if (
        typeof nlat === "number" &&
        typeof nlng === "number" &&
        !Number.isNaN(nlat) &&
        !Number.isNaN(nlng)
      ) {
        da.location = { lat: nlat, lng: nlng };
        await order.save();
        let uaUpdated = false;
        if (
          ua &&
          (!ua.location ||
            typeof ua.location.lat !== "number" ||
            typeof ua.location.lng !== "number")
        ) {
          ua.location = { lat: nlat, lng: nlng };
          await ua.save();
          uaUpdated = true;
        }
        return res.json({
          ok: true,
          order_id: String(order._id),
          location: { lat: nlat, lng: nlng },
          uaUpdated,
          method: "direct",
        });
      }

      // 3) Derive address string
      let addr =
        typeof address === "string" && address.trim() ? address.trim() : "";
      if (!addr && ua) {
        const parts = [
          ua.full_address,
          ua.street,
          ua.city,
          ua.state,
          ua.pincode,
        ].filter((x) => x && String(x).trim().length > 0);
        addr = parts.join(", ");
      }
      if (
        !addr &&
        typeof da.full_address === "string" &&
        !/^[0-9a-fA-F]{24}$/.test(da.full_address)
      ) {
        addr = da.full_address.trim();
      }

      // 4) If address is "lat,lng" text
      const parsed = _parseLatLngText(addr);
      if (parsed) {
        da.location = { lat: parsed.lat, lng: parsed.lng };
        await order.save();
        let uaUpdated = false;
        if (
          ua &&
          (!ua.location ||
            typeof ua.location.lat !== "number" ||
            typeof ua.location.lng !== "number")
        ) {
          ua.location = { lat: parsed.lat, lng: parsed.lng };
          await ua.save();
          uaUpdated = true;
        }
        return res.json({
          ok: true,
          order_id: String(order._id),
          location: parsed,
          uaUpdated,
          method: "coords-from-text",
        });
      }

      // 5) Reuse UA coords if present
      let loc = null;
      if (
        ua &&
        ua.location &&
        typeof ua.location.lat === "number" &&
        typeof ua.location.lng === "number"
      ) {
        loc = { lat: ua.location.lat, lng: ua.location.lng };
      }

      // 6) Try Place Details if any place_id available
      if (!loc) {
        const pId = place_id || ua?.place_id || da.place_id;
        if (pId) {
          loc = await _placeDetails(pId, GOOGLE_KEY);
        }
      }

      // 7) Geocode address text
      if (!loc) {
        if (!addr) {
          return res.status(400).json({
            error:
              "No address available to geocode. Provide 'address', 'lat/lng', or 'place_id'.",
          });
        }
        loc = await _geocodeAddress(addr, GOOGLE_KEY);
      }
      if (!loc) {
        return res
          .status(400)
          .json({ error: "Geocoding failed for provided/resolved address" });
      }

      // 8) Persist
      da.location = { lat: loc.lat, lng: loc.lng };
      if (loc.formatted) {
        da.full_address = loc.formatted;
      } else if (addr) {
        // fallback: store provided text if no formatted available
        da.full_address = addr;
      }
      await order.save();
      let uaUpdated = false;
      if (
        ua &&
        (!ua.location ||
          typeof ua.location.lat !== "number" ||
          typeof ua.location.lng !== "number")
      ) {
        ua.location = { lat: loc.lat, lng: loc.lng };
        await ua.save();
        uaUpdated = true;
      }
      return res.json({
        ok: true,
        order_id: String(order._id),
        location: loc,
        uaUpdated,
        method: "geocode",
      });
    } catch (e) {
      console.error("admin fix-address error", e);
      return res.status(500).json({ error: "failed to fix address" });
    }
  }

  // Get available delivery agents for an order with distance calculation
  async availableAgents(req, res) {
    try {
      const { orderId } = req.params;

      // Resolve order
      let order = null;
      if (mongoose.isValidObjectId(orderId)) {
        order = await Order.findById(orderId);
      }
      if (!order) {
        order = await Order.findOne({
          $or: [
            { order_id: orderId },
            { id: orderId },
            ...(mongoose.isValidObjectId(orderId) ? [{ _id: orderId }] : []),
          ],
        });
      }
      if (!order) return res.status(404).json({ error: "Order not found" });

      // Check if order payment is completed
      if (order.payment?.status !== "paid") {
        return res.status(400).json({
          error: "Order must be paid before viewing available agents",
        });
      }

      // Get seller location
      const sellerId = order.seller_id;
      const seller = await Seller.findById(sellerId);
      // Seller schema uses {lat, lng} format, not GeoJSON coordinates
      if (
        !seller ||
        !seller.location ||
        typeof seller.location.lat !== "number" ||
        typeof seller.location.lng !== "number"
      ) {
        return res.status(400).json({ error: "Seller location not available" });
      }

      const sellerLat = seller.location.lat;
      const sellerLng = seller.location.lng;

      // Helper function to calculate distance (Haversine formula)
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

      // Get all approved delivery agents
      const agents = await DeliveryAgent.find({ approved: true })
        .select("_id name email phone active available current_location")
        .lean();

      // Calculate distance and format response
      const agentsWithDistance = agents.map((agent) => {
        let distance = null;
        // DeliveryAgent schema uses current_location: {lat, lng}
        if (
          agent.current_location &&
          typeof agent.current_location.lat === "number" &&
          typeof agent.current_location.lng === "number"
        ) {
          const agentLat = agent.current_location.lat;
          const agentLng = agent.current_location.lng;
          distance = calculateDistance(
            sellerLat,
            sellerLng,
            agentLat,
            agentLng,
          );
        }

        return {
          id: agent._id.toString(),
          name: agent.name || "Unnamed Agent",
          email: agent.email || "",
          phone: agent.phone || "",
          distance: distance !== null ? parseFloat(distance.toFixed(2)) : null,
          online: agent.active && agent.available,
          active: agent.active,
          available: agent.available,
        };
      });

      // Sort by distance (closest first), then by online status
      agentsWithDistance.sort((a, b) => {
        // Online agents first
        if (a.online !== b.online) return b.online ? 1 : -1;
        // Then by distance (nulls last)
        if (a.distance === null && b.distance === null) return 0;
        if (a.distance === null) return 1;
        if (b.distance === null) return -1;
        return a.distance - b.distance;
      });

      res.json({ agents: agentsWithDistance });
    } catch (e) {
      console.error("Get available agents error", e);
      res.status(500).json({ error: "Failed to get available agents" });
    }
  }

  // Manual delivery agent assignment (fallback when auto-assignment fails)
  async assignDeliveryAgent(req, res) {
    try {
      const { orderId } = req.params;
      const { agent_id, agent_email, force } = req.body || {};
      if (!agent_id && !agent_email) {
        return res
          .status(400)
          .json({ error: "agent_id or agent_email required" });
      }
      // Resolve order
      let order = null;
      if (mongoose.isValidObjectId(orderId)) {
        order = await Order.findById(orderId);
      }
      if (!order) {
        order = await Order.findOne({
          $or: [
            { order_id: orderId },
            { id: orderId },
            ...(mongoose.isValidObjectId(orderId) ? [{ _id: orderId }] : []),
          ],
        });
      }
      if (!order) return res.status(404).json({ error: "Order not found" });

      // Basic payment validation: only assign paid COD orders
      if (order.payment?.status !== "paid") {
        return res
          .status(400)
          .json({ error: "Order must be paid before manual assignment" });
      }
      order.delivery = order.delivery || {};

      // Resolve agent
      let agent = null;
      if (agent_id && mongoose.isValidObjectId(agent_id)) {
        agent = await DeliveryAgent.findById(agent_id);
      }
      if (!agent && agent_email) {
        agent = await DeliveryAgent.findOne({
          email: agent_email.toLowerCase(),
        });
      }
      if (!agent)
        return res.status(404).json({ error: "Delivery agent not found" });

      if (!agent.approved) {
        return res.status(400).json({ error: "Agent not approved" });
      }
      if ((!agent.active || !agent.available) && !force) {
        return res.status(400).json({
          error: "Agent not online/available (use force to override)",
        });
      }

      // If already assigned to same agent, just return snapshot
      if (
        String(order.delivery.delivery_agent_id || "") === String(agent._id)
      ) {
        const existingSnap = buildSnapshot(order);
        return res.json({
          ok: true,
          order_id: String(order._id),
          agent_id: String(agent._id),
          already_assigned: true,
          snapshot: existingSnap,
        });
      }

      // Decrement previous agent counter if changing assignment
      const prevAgentId = order.delivery.delivery_agent_id;
      if (prevAgentId && prevAgentId.toString() !== agent._id.toString()) {
        try {
          await DeliveryAgent.findByIdAndUpdate(prevAgentId, {
            $inc: { assigned_orders: -1 },
          });
        } catch (_) {}
      }

      // Apply assignment
      order.delivery.delivery_agent_id = agent._id;
      order.delivery.delivery_agent_response = "pending";
      if (order.delivery.delivery_status === "pending") {
        order.delivery.delivery_status = "assigned";
      }
      order.delivery.assignment_history = Array.isArray(
        order.delivery.assignment_history,
      )
        ? order.delivery.assignment_history
        : [];
      order.delivery.assignment_history.push({
        agent_id: agent._id,
        assigned_at: new Date(),
        response: "pending",
      });
      await order.save();

      // Increment agent counter
      await DeliveryAgent.findByIdAndUpdate(agent._id, {
        $inc: { assigned_orders: 1 },
      });

      // Publish SSE snapshot (order + seller)
      let snapshot = null;
      try {
        snapshot = buildSnapshot(order);
        publish(String(order._id), snapshot);
        if (snapshot.seller_id)
          publishToSeller(String(snapshot.seller_id), snapshot);
      } catch (pubErr) {
        console.warn("Manual assign publish error", pubErr);
      }

      res.json({
        ok: true,
        order_id: String(order._id),
        agent_id: String(agent._id),
        snapshot,
      });
    } catch (e) {
      console.error("manual assign error", e);
      res
        .status(500)
        .json({ error: "Failed to manually assign delivery agent" });
    }
  }

  // ---------------- Orders ----------------
  async list(req, res) {
    try {
      const {
        status,
        delivery_status,
        seller_id,
        client_id,
        from,
        to,
        page = 1,
        pageSize = 20,
        search,
        payment_method,
        min_amount,
        max_amount,
      } = req.query;
      const filter = {};
      if (status) filter["payment.status"] = status;
      if (delivery_status) filter["delivery.delivery_status"] = delivery_status;
      if (seller_id && mongoose.isValidObjectId(seller_id))
        filter["seller_id"] = seller_id;
      if (client_id) filter["client_id"] = client_id;

      // Payment method filter
      if (payment_method) {
        filter["payment.method"] = payment_method;
      }

      // Amount range filters
      if (min_amount || max_amount) {
        const amountFilter = {};
        if (min_amount) amountFilter.$gte = parseFloat(min_amount);
        if (max_amount) amountFilter.$lte = parseFloat(max_amount);
        filter["payment.amount"] = amountFilter;
      }

      if (from || to) {
        const idRange = {};
        if (from) {
          const d = new Date(from);
          if (!isNaN(d.getTime()))
            idRange.$gte = mongoose.Types.ObjectId.createFromTime(
              Math.floor(d.getTime() / 1000),
            );
        }
        if (to) {
          const d = new Date(to);
          if (!isNaN(d.getTime()))
            idRange.$lte = mongoose.Types.ObjectId.createFromTime(
              Math.floor(d.getTime() / 1000),
            );
        }
        if (Object.keys(idRange).length) filter._id = idRange;
      }
      if (search) {
        // Enhanced search: partial hex match on _id, match client/seller ids, or order_no
        const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        filter.$or = [{ client_id: rx }, { order_no: rx }];
        // If likely hex substring, add _id regex (inefficient without index but acceptable for small sets)
        if (/^[a-fA-F0-9]{3,24}$/.test(search)) {
          filter.$or.push({ _id: { $regex: rx } });
        }
      }
      const pg = Math.max(parseInt(page, 10) || 1, 1);
      const ps = Math.min(Math.max(parseInt(pageSize, 10) || 20, 1), 200);
      const [items, total] = await Promise.all([
        Order.find(filter)
          .sort({ _id: -1 })
          .skip((pg - 1) * ps)
          .limit(ps)
          .lean(),
        Order.countDocuments(filter),
      ]);
      const mapped = items.map((o) => {
        const itemsAmount =
          o.payment && typeof o.payment.amount === "number"
            ? o.payment.amount
            : Number(o.payment?.amount || 0);
        const deliveryCharge = Number(o.delivery?.delivery_charge || 0);
        const totalAmount = itemsAmount + deliveryCharge;

        return {
          order_id: o._id,
          created_at:
            o.created_at ||
            (o._id && o._id.getTimestamp ? o._id.getTimestamp() : new Date()),
          client_id: o.client_id,
          seller_id: o.seller_id,
          amount: totalAmount,
          items_amount: itemsAmount,
          delivery_charge: deliveryCharge,
          payment_status: o.payment?.status,
          payment_method: o.payment?.method,
          delivery_status: o.delivery?.delivery_status || "pending",
          delivery_address: o.delivery?.delivery_address?.full_address || null,
          delivery_recipient:
            o.delivery?.delivery_address?.recipient_name || null,
          delivery_phone: o.delivery?.delivery_address?.recipient_phone || null,
        };
      });
      res.json({ rows: mapped, total, page: pg, limit: ps });
    } catch (e) {
      console.error("Error listing orders", e);
      res.status(500).json({ error: "failed to list orders" });
    }
  }

  payment(req, res, next) {
    return verifyPayment(req, res, next);
  }

  delivery(req, res, next) {
    return updateDelivery(req, res, next);
  }

  // Admin cancel order
  async cancel(req, res) {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      const order = await Order.findById(id);
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      if (order.status === "delivered") {
        return res.status(400).json({ error: "Cannot cancel delivered orders" });
      }

      if (order.status === "cancelled") {
        return res.status(400).json({ error: "Order is already cancelled" });
      }

      order.status = "cancelled";
      order.cancelled_by = `admin:${req.admin.id}`;
      order.cancellation_reason = reason || "Cancelled by admin";
      order.cancelled_at = new Date();

      await order.save();

      // Free up delivery agent if assigned
      if (order.delivery?.delivery_agent_id) {
        const agent = await DeliveryAgent.findById(
          order.delivery.delivery_agent_id,
        );
        if (agent) {
          agent.available = true;
          agent.assigned_orders = Math.max(0, (agent.assigned_orders || 1) - 1);
          await agent.save();
        }
      }

      // Publish SSE updates
      try {
        const snapshot = await buildEnrichedSnapshot(order);
        publish(String(order._id), snapshot);
        if (snapshot.seller_id)
          publishToSeller(String(snapshot.seller_id), snapshot);
        publishToAdmin(snapshot);
        // Removed notifyOrderUpdate as per user request to avoid sending push notifications on admin status updates
      } catch (sseError) {
        console.error("Failed to publish cancel event:", sseError);
      }

      res.json({ message: "Order cancelled successfully", order });
    } catch (error) {
      console.error("Admin cancel order error:", error);
      res.status(500).json({ error: "Failed to cancel order" });
    }
  }

  // Admin delete order
  async remove(req, res) {
    try {
      const { id } = req.params;

      const order = await Order.findById(id);
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      // Free up delivery agent if assigned (and not already cancelled/delivered properly)
      if (
        order.delivery?.delivery_agent_id &&
        order.status !== "delivered" &&
        order.status !== "cancelled"
      ) {
        const agent = await DeliveryAgent.findById(
          order.delivery.delivery_agent_id,
        );
        if (agent) {
          agent.available = true;
          agent.assigned_orders = Math.max(0, (agent.assigned_orders || 1) - 1);
          await agent.save();
        }
      }

      await Order.findByIdAndDelete(id);

      // Also remove from EarningLog if exists? Usually better to keep financial logs or mark as deleted,
      // but pure delete implies removal. Let's delete related logs too to keep clean state if requested.
      await EarningLog.deleteMany({ order_id: id });

      res.json({ message: "Order deleted successfully" });
    } catch (error) {
      console.error("Admin delete order error:", error);
      res.status(500).json({ error: "Failed to delete order" });
    }
  }

  // ---------------- ORDER MANAGEMENT ----------------
  async update(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ error: "Invalid order ID" });
      }

      const updatedOrder = await Order.findByIdAndUpdate(
        id,
        { $set: req.body },
        { new: true, runValidators: true },
      );

      if (!updatedOrder) {
        return res.status(404).json({ error: "Order not found" });
      }

      res.json(updatedOrder);
    } catch (error) {
      console.error("update order error", error);
      res.status(500).json({ error: "Failed to update order" });
    }
  }
}

module.exports = new OrdersController();
