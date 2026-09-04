const mongoose = require("mongoose");
const {
  Client,
  Seller,
  Order,
  Cart,
  UserAddress,
  DeviceToken,
  DeliveryAgent,
  Feedback,
  Wishlist,
  Review,
} = require("@models");
const { parsePagination } = require("../../util/helpers");

class ClientsController {
  // ---------------- Clients ----------------
  async list(req, res) {
    try {
      const { page, limit, skip } = parsePagination(req);
      const { search } = req.query;
      const filter = {};
      if (search) {
        const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        filter.$or = [
          { name: rx },
          { email: rx },
          { phone: rx },
        ];
      }
      const [total, rows] = await Promise.all([
        Client.countDocuments(filter),
        Client.find(filter)
          .sort({ created_at: -1 })
          .skip(skip)
          .limit(limit)
          .select("name email phone created_at")
          .lean(),
      ]);

      // Role tagging enrichment (seller / restaurant / delivery)
      try {
        const emails = Array.from(
          new Set(rows.map((r) => (r.email || "").toLowerCase()).filter(Boolean)),
        );
        const phones = Array.from(
          new Set(rows.map((r) => (r.phone || "").trim()).filter(Boolean)),
        );
        const [matchedSellers, matchedAgents] = await Promise.all([
          emails.length || phones.length
            ? Seller.find({
                $or: [
                  emails.length ? { email: { $in: emails } } : null,
                  phones.length ? { phone: { $in: phones } } : null,
                ].filter(Boolean),
              })
                .select("email phone business_type")
                .lean()
            : [],
          emails.length || phones.length
            ? DeliveryAgent.find({
                $or: [
                  emails.length ? { email: { $in: emails } } : null,
                  phones.length ? { phone: { $in: phones } } : null,
                ].filter(Boolean),
              })
                .select("email phone")
                .lean()
            : [],
        ]);
        const sellerByKey = new Map();
        for (const s of matchedSellers) {
          const keys = [s.email, s.phone].filter(Boolean);
          for (const k of keys) sellerByKey.set(String(k).toLowerCase(), s);
        }
        const agentByKey = new Map();
        for (const a of matchedAgents) {
          const keys = [a.email, a.phone].filter(Boolean);
          for (const k of keys) agentByKey.set(String(k).toLowerCase(), a);
        }
        for (const r of rows) {
          const roles = ["client"]; // base role
          const lookups = [r.email, r.phone]
            .filter(Boolean)
            .map((v) => v.toLowerCase());
          let sellerType = null;
          for (const k of lookups) {
            const s = sellerByKey.get(k);
            if (s) {
              sellerType = s.business_type || "seller";
              break;
            }
          }
          if (sellerType) {
            // Normalize restaurant vs seller
            if (/rest/i.test(sellerType)) roles.push("restaurant");
            else roles.push("seller");
          }
          let isDelivery = false;
          for (const k of lookups) {
            if (agentByKey.has(k)) {
              isDelivery = true;
              break;
            }
          }
          if (isDelivery) roles.push("delivery");
          r.roles = roles;
        }
      } catch (enrichErr) {
        console.warn("client roles enrichment failed", enrichErr);
      }

      res.json({ page, limit, total, rows });
    } catch (e) {
      console.error("admin clients list error", e);
      res.status(500).json({ message: "Failed to list clients" });
    }
  }

  // ---------------- CLIENT/USER CRUD ----------------
  async create(req, res) {
    try {
      const { name, email, phone, avatar_url } = req.body;

      if (!name || !email || !phone) {
        return res
          .status(400)
          .json({ error: "Name, email, and phone are required" });
      }

      const newClient = new Client({
        name,
        email,
        phone,
        avatar_url,
        otp_verified: true, // Admin created users are auto-verified
      });

      await newClient.save();
      res.status(201).json(newClient);
    } catch (error) {
      if (error.code === 11000) {
        return res.status(400).json({ error: "Email already exists" });
      }
      console.error("create client error", error);
      res.status(500).json({ error: "Failed to create client" });
    }
  }

  async update(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ error: "Invalid client ID" });
      }

      const updatedClient = await Client.findByIdAndUpdate(
        id,
        { $set: req.body },
        { new: true, runValidators: true },
      );

      if (!updatedClient) {
        return res.status(404).json({ error: "Client not found" });
      }

      res.json(updatedClient);
    } catch (error) {
      if (error.code === 11000) {
        return res.status(400).json({ error: "Email already exists" });
      }
      console.error("update client error", error);
      res.status(500).json({ error: "Failed to update client" });
    }
  }

  async remove(req, res) {
    try {
      const { id } = req.params;
      const full = req.query.full === "1" || req.query.full === "true";

      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ error: "Invalid client ID" });
      }

      const client = await Client.findById(id);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }

      const cascade = {};

      if (full) {
        // 1. Delete addresses
        const addressesDel = await UserAddress.deleteMany({
          user_id: client._id,
        });
        cascade.addressesDeleted = addressesDel?.deletedCount || 0;

        // 2. Delete device tokens
        const tokensDel = await DeviceToken.deleteMany({
          user_id: `client_${client._id}`,
        });
        cascade.deviceTokensDeleted = tokensDel?.deletedCount || 0;

        // 3. Delete wishlist items
        const wishlistDel = await Wishlist.deleteMany({ client_id: client._id });
        cascade.wishlistDeleted = wishlistDel?.deletedCount || 0;

        // 4. Delete cart items
        const cartDel = await Cart.deleteMany({
          user_id: client._id,
        });
        cascade.cartDeleted = cartDel?.deletedCount || 0;

        // 5. Anonymize orders (keep for business records but remove personal data)
        await Order.updateMany(
          { client_id: client._id },
          {
            $set: {
              client_phone: "[deleted]",
              "delivery_address.full_address": "[deleted]",
              "delivery_address.label": "[deleted]",
              "delivery_address.location": null,
            },
          },
        );
        cascade.ordersAnonymized = await Order.countDocuments({
          client_id: client._id,
        });

        // 6. Delete reviews
        const reviewsDel = await Review.deleteMany({ client_id: client._id });
        cascade.reviewsDeleted = reviewsDel?.deletedCount || 0;

        // 7. Delete feedback
        const feedbackDel = await Feedback.deleteMany({ user_id: client._id });
        cascade.feedbackDeleted = feedbackDel?.deletedCount || 0;
      }

      // 9. Delete client document
      await Client.findByIdAndDelete(client._id);
      cascade.clientDeleted = true;

      console.log(`✅ Admin deleted client: ${client._id}`, { full, cascade });

      res.json({
        message: "Client deleted successfully",
        full,
        cascade,
      });
    } catch (error) {
      console.error("delete client error", error);
      res.status(500).json({ error: "Failed to delete client" });
    }
  }
}

module.exports = new ClientsController();
