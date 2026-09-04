const express = require("express");
const { cacheMiddleware } = require("@middleware/cache");
const { paginationMiddleware } = require("@middleware/pagination");
const RestaurantsController = require("./RestaurantsController");

const router = express.Router();

// GET /api/restaurants?q=pizza&page=1&limit=20 -> list restaurants with optional search
router.get(
  "/",
  paginationMiddleware({ defaultLimit: 20, maxLimit: 50 }),
  cacheMiddleware(60, (req) => {
    const { q, page, limit } = req.query;
    return `cache:restaurants:${q || "all"}:${page || 1}:${limit || 20}`;
  }),
  RestaurantsController.list
);

module.exports = router;
