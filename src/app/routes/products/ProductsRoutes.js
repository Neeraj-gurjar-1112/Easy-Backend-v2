const express = require("express");
const { cacheMiddleware } = require("@middleware/cache");
const { paginationMiddleware } = require("@middleware/pagination");
const ProductsController = require("./ProductsController");

const router = express.Router();

// GET /api/products?category=Grocery&q=milk&page=1&limit=20
router.get(
  "/",
  paginationMiddleware({ defaultLimit: 20, maxLimit: 100 }),
  cacheMiddleware(300, (req) => {
    const { category, q, page, limit } = req.query;
    return `cache:products:${category || "all"}:${q || "none"}:${page || 1}:${
      limit || 20
    }`;
  }),
  ProductsController.list
);

// GET /api/products/:id - Get single product details
router.get("/:id", ProductsController.getById);

// POST /api/products/prices  { ids: ["..."] }
router.post("/prices", ProductsController.prices);

// POST /api/products/stock  { items: [{product_id, qty}] }
router.post("/stock", ProductsController.stock);

// POST /api/products/quote { items: [{ product_id, qty }] }
router.post("/quote", ProductsController.quote);

module.exports = router;
