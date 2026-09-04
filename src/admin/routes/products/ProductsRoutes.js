const express = require("express");
const { requireAdmin } = require("../../util/auth");
const ProductsController = require("./ProductsController");

const router = express.Router();

// ---------------- Products ----------------
router.get("/products", requireAdmin, ProductsController.list);

// Distinct product categories for filters
router.get("/product-categories", requireAdmin, ProductsController.categories);

// ---------------- PRODUCT CRUD ----------------
router.post("/products", requireAdmin, ProductsController.create);

// Allow both PUT and PATCH for flexibility
router.put("/products/:id", requireAdmin, ProductsController.update);

// Backward compatible PATCH update for products
router.patch("/products/:id", requireAdmin, ProductsController.patch);

// Activate product (set status to 'active')
router.post("/products/:id/activate", requireAdmin, ProductsController.activate);

// Deactivate product (set status to 'inactive')
router.post("/products/:id/deactivate", requireAdmin, ProductsController.deactivate);

router.delete("/products/:id", requireAdmin, ProductsController.remove);

module.exports = router;
