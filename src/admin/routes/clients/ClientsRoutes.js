const express = require("express");
const { requireAdmin } = require("../../util/auth");
const ClientsController = require("./ClientsController");

const router = express.Router();

// ---------------- Clients ----------------
router.get("/clients", requireAdmin, ClientsController.list);

// ---------------- CLIENT/USER CRUD ----------------
router.post("/clients", requireAdmin, ClientsController.create);
router.put("/clients/:id", requireAdmin, ClientsController.update);
router.delete("/clients/:id", requireAdmin, ClientsController.remove);

module.exports = router;
