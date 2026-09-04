const mongoose = require("mongoose");
const { Admin } = require("@models");

class RolesController {
  async list(req, res) {
    try {
      const admins = await Admin.find().select("email role created_at").lean();
      res.json({ admins });
    } catch (e) {
      console.error("admin roles list error", e);
      res.status(500).json({ error: "failed to list roles" });
    }
  }

  async create(req, res) {
    try {
      const { email, role, password } = req.body || {};
      if (!email || !/^.+@.+\..+$/.test(email))
        return res.status(400).json({ error: "valid email required" });
      if (!role || !["superadmin", "moderator"].includes(role))
        return res.status(400).json({ error: "invalid role" });
      if (!password || typeof password !== "string" || password.length < 4)
        return res.status(400).json({ error: "password required (min 4 chars)" });
      const existing = await Admin.findOne({ email: email.toLowerCase() });
      if (existing)
        return res.status(409).json({ error: "admin already exists" });
      const toCreate = { email: email.toLowerCase(), role, password };
      const doc = await Admin.create(toCreate);
      res.status(201).json({
        id: doc._id,
        email: doc.email,
        role: doc.role,
        created_at: doc.created_at,
      });
    } catch (e) {
      console.error("admin create role error", e);
      res.status(500).json({ error: "failed to create admin" });
    }
  }

  async update(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.isValidObjectId(id))
        return res.status(400).json({ error: "invalid admin id" });
      const { role } = req.body || {};
      if (!role || !["superadmin", "moderator"].includes(role))
        return res.status(400).json({ error: "invalid role" });
      // Prevent demoting the last remaining superadmin
      const target = await Admin.findById(id).lean();
      if (!target) return res.status(404).json({ error: "admin not found" });
      if (target.role === "superadmin" && role !== "superadmin") {
        const supCount = await Admin.countDocuments({ role: "superadmin" });
        if (supCount <= 1) {
          return res
            .status(400)
            .json({ error: "cannot demote the last superadmin" });
        }
      }
      const upd = await Admin.findByIdAndUpdate(
        id,
        { $set: { role } },
        { new: true },
      );
      if (!upd) return res.status(404).json({ error: "admin not found" });
      res.json({
        id: upd._id,
        email: upd.email,
        role: upd.role,
        created_at: upd.created_at,
      });
    } catch (e) {
      console.error("admin update role error", e);
      res.status(500).json({ error: "failed to update role" });
    }
  }

  async remove(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.isValidObjectId(id))
        return res.status(400).json({ error: "invalid admin id" });
      // Prevent deleting the last remaining superadmin
      const toDel = await Admin.findById(id).lean();
      if (!toDel) return res.status(404).json({ error: "admin not found" });
      if (toDel.role === "superadmin") {
        const supCount = await Admin.countDocuments({ role: "superadmin" });
        if (supCount <= 1) {
          return res
            .status(400)
            .json({ error: "cannot delete the last superadmin" });
        }
      }
      const del = await Admin.findByIdAndDelete(id);
      if (!del) return res.status(404).json({ error: "admin not found" });
      res.status(204).end();
    } catch (e) {
      console.error("admin delete role error", e);
      res.status(500).json({ error: "failed to delete admin" });
    }
  }
}

module.exports = new RolesController();
