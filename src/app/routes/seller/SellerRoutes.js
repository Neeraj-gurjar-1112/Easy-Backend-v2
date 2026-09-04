/**
 * Seller module routes. Mounted at /api/seller (see src/app/routes/index.js).
 *
 * Registration order mirrors legacy routes/seller.js EXACTLY - express matches in
 * registration order, so the relative position of e.g. GET /:sellerId/status,
 * GET /orders/pending vs GET /orders/:id, and GET /products vs GET /products/reviews
 * must not change. The "L<n>" comments are the legacy source line numbers.
 */
const express = require("express");
const { requireSeller } = require("./helpers");
const StoreController = require("./StoreController");
const ProductsController = require("./ProductsController");
const OrdersController = require("./OrdersController");
const AnalyticsController = require("./AnalyticsController");
const ReviewsController = require("./ReviewsController");
const EarningsController = require("./EarningsController");

const router = express.Router();

// L39  Toggle seller open/closed status (availability)
router.post("/toggle-open", requireSeller, StoreController.toggleOpen);
// L62  Get seller/restaurant open/closed status (public)
router.get("/:sellerId/status", StoreController.getStatus);
// L91  SSE endpoint for real-time seller status updates (public)
router.get("/status-stream", StoreController.statusStream);

// L131 Create product
router.post("/products", requireSeller, ProductsController.createProduct);
// L180 Update product (full replace fields provided)
router.put("/products/:id", requireSeller, ProductsController.updateProduct);
// L203 Patch product (partial update)
router.patch("/products/:id", requireSeller, ProductsController.patchProduct);
// L226 Delete (soft deactivate)
router.delete("/products/:id", requireSeller, ProductsController.deleteProduct);
// L263 List seller products
router.get("/products", requireSeller, ProductsController.listProducts);

// L274 Seller orders listing
router.get("/orders", requireSeller, OrdersController.listOrders);
// L342 Get pending orders for seller approval
router.get("/orders/pending", requireSeller, OrdersController.listPendingOrders);
// L402 Get a single order details (validated for this seller)
router.get("/orders/:id", requireSeller, OrdersController.getOrder);
// L467 SSE stream for all seller-related order updates
router.get("/stream", requireSeller, OrdersController.stream);
// L484 Accept order
router.post("/orders/accept", requireSeller, OrdersController.acceptOrder);
// L585 Reject order
router.post("/orders/reject", requireSeller, OrdersController.rejectOrder);

// L668 Delivery agent availability check (before order acceptance)
router.post(
  "/check-delivery-availability",
  requireSeller,
  StoreController.checkDeliveryAvailability,
);

// L806 Create feedback from seller perspective
router.post("/:sellerId/feedback", EarningsController.createFeedback);
// L831 List feedback created by this seller
router.get("/:sellerId/feedback", EarningsController.listFeedback);
// L857 Seller earnings summary
router.get("/:sellerId/earnings/summary", EarningsController.earningsSummary);
// L917 Seller earnings logs (history)
router.get("/:sellerId/earnings/logs", EarningsController.earningsLogs);

// L959 Sales analytics dashboard
router.get("/analytics", requireSeller, AnalyticsController.getAnalytics);

// L1366 Product reviews & ratings
router.get("/products/reviews", requireSeller, ReviewsController.listProductReviews);
// L1486 Seller responds to a customer review
router.post("/reviews/:reviewId/respond", requireSeller, ReviewsController.respondToReview);
// L1545 Delete seller's response to a review
router.delete("/reviews/:reviewId/respond", requireSeller, ReviewsController.deleteReviewResponse);

// L1588 Analytics export (CSV)
router.get("/analytics/export", requireSeller, AnalyticsController.exportAnalytics);
// L1661 Real-time analytics SSE
router.get("/analytics/stream", requireSeller, AnalyticsController.analyticsStream);

// L1777 Get inventory with low stock alerts
router.get("/inventory", requireSeller, ProductsController.getInventory);
// L1827 Update product stock
router.put("/inventory/:productId/stock", requireSeller, ProductsController.updateStock);
// L1874 Bulk update stock (for multiple products)
router.post("/inventory/bulk-update", requireSeller, ProductsController.bulkUpdateStock);

// L1948 Upload products via CSV
router.post("/products/upload-csv", requireSeller, ProductsController.uploadCsv);

// L1770 Export for use in other files (legacy: router.broadcastAnalyticsUpdate = broadcastAnalyticsUpdate)
router.broadcastAnalyticsUpdate = AnalyticsController.broadcastAnalyticsUpdate;

module.exports = router;
