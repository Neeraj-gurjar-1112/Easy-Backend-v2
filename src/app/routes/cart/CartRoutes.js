const express = require("express");
const { sanitize } = require("@middleware/validation");
const CartController = require("./CartController");

const router = express.Router();

// GET /api/cart/:uid
router.get("/:uid", CartController.getCart);

// PUT /api/cart/:uid  { items: [ { product_id, name, price, qty, seller_id? } ] }
router.put("/:uid", sanitize, CartController.saveCart);

module.exports = router;
