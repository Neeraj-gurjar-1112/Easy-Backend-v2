const express = require("express");
const { requireAdmin } = require("../../util/auth");
const RolesController = require("./RolesController");

const router = express.Router();

// ---------------- Roles (admin accounts) ----------------
router.get("/roles", requireAdmin, RolesController.list);
router.post("/roles", requireAdmin, RolesController.create);
router.patch("/roles/:id", requireAdmin, RolesController.update);
router.delete("/roles/:id", requireAdmin, RolesController.remove);

module.exports = router;
