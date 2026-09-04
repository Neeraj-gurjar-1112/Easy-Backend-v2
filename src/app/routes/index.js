/**
 * App service route table. Order matters (same order as the legacy app.js):
 * /api/auth is mounted before /api/auth/otp so the auth router gets first look.
 * Each module folder exports an express.Router from its index.js.
 */
const express = require("express");

const router = express.Router();

const mounts = [
  ["/api/products", "./products"],
  ["/api/orders", "./orders"],
  ["/api/cart", "./cart"],
  ["/api/restaurants", "./restaurants"],
  ["/api/restaurant-manage", "./restaurant-manage"],
  ["/api/clients", "./clients"],
  ["/api/seller", "./seller"],
  ["/api/auth", "./auth"],
  ["/api/auth/otp", "./otp"],
  ["/api/tokens", "./tokens"],
  ["/api/users", "./users"],
  ["/api/delivery", "./delivery"],
  ["/api/uploads", "./uploads"],
  ["/api/reviews", "./reviews"],
  ["/api/wishlist", "./wishlist"],
  ["/legal", "./legal"],
  ["/", "./misc"], // /api/app-version, /api/auth/debug/verify-token
];

for (const [prefix, modulePath] of mounts) {
  router.use(prefix, require(modulePath));
}

module.exports = router;
