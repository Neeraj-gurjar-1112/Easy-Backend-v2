const mongoose = require("mongoose");
const { Schema } = mongoose;

// Corresponds to 'Orolog', 'OrderItem', 'Payment', and 'Delivery' tables combined
const orderSchema = new Schema({
  // Store Firebase Auth UID (string) directly as client identifier.
  // If later a separate Client collection mapping is needed, we can add client_ref ObjectId.
  client_id: { type: String, required: true }, // Removed index: true to avoid duplicate with compound index
  seller_id: { type: Schema.Types.ObjectId, ref: "Seller" },
  catalog_id: { type: Schema.Types.ObjectId, ref: "Catalog" }, // from Orolog
  published: { type: Boolean, default: true }, // from Orolog

  // Main order status (root level - most authoritative)
  status: {
    type: String,
    enum: [
      "pending",
      "confirmed",
      "processing",
      "cancelled",
      "delivered",
      "refunded",
    ],
    default: "pending",
  },

  // Cancellation metadata (root level for easy querying)
  cancelled_by: { type: String }, // 'customer', 'seller', 'admin', 'system', 'delivery_agent'
  cancellation_reason: { type: String },
  cancelled_at: { type: Date },

  order_items: [
    {
      // from OrderItem
      product_id: { type: Schema.Types.ObjectId, ref: "Product" },
      qty: { type: Number, required: true },
      // Best practice: snapshot price and name for historical accuracy
      price_snapshot: Number,
      name_snapshot: String,
    },
  ],

  payment: {
    // from Payment
    amount: { type: Number, required: true },
    method: {
      type: String,
      // Keep legacy values in enum to avoid validation failures on existing documents.
      enum: ["COD", "UPI", "razorpay", "card"],
      default: "COD",
    },
    status: {
      type: String,
      enum: [
        "pending", // order created, awaiting user action
        "claimed", // user claimed paid (provided UTR/response)
        "paid", // verified paid
        "failed",
        "cancelled",
        "expired",
      ],
      default: "pending",
    },
    payment_date: { type: Date },

    // UPI-specific fields removed for COD-only flow

    // Verification details (who/when finalized)
    verified: {
      by: String, // identifier for admin/verifier
      note: String,
      at: { type: Date },
    },
  },

  // Optional coupon code applied at checkout (used to recompute discount in snapshots)
  coupon_code: { type: String },
  // Persisted absolute discount amount allocated to this order (positive number). Applied once at creation for immutable accounting.
  applied_discount_amount: { type: Number, default: 0 },

  delivery: {
    // from Delivery
    delivery_status: {
      type: String,
      enum: [
        "pending",
        "dispatched",
        "assigned",
        "accepted",
        "picked_up",
        "in_transit",
        "delivered",
        "cancelled",
        "escalated", // Added: When order cannot be assigned after max retry attempts
      ],
      default: "pending",
    },
    // Escalation metadata (when no agents available after multiple retries)
    escalated_at: { type: Date },
    escalation_reason: { type: String },
    delivery_agent_id: { type: Schema.Types.ObjectId, ref: "DeliveryAgent" },
    delivery_agent_response: {
      type: String,
      enum: ["pending", "accepted", "rejected", "timeout"],
      default: "pending",
    },
    assignment_history: [
      {
        agent_id: { type: Schema.Types.ObjectId, ref: "DeliveryAgent" },
        assigned_at: { type: Date, default: Date.now },
        response: {
          type: String,
          enum: ["pending", "accepted", "rejected", "timeout"],
        },
        response_at: { type: Date },
      },
    ],
    delivery_start_time: { type: Date },
    delivery_end_time: { type: Date },
    pickup_time: { type: Date },
    estimated_delivery_time: { type: Date },

    // Agent's location when accepting the order
    accept_location: {
      lat: { type: Number },
      lng: { type: Number },
    },

    // Pickup address (seller/store location) for route tracking
    pickup_address: {
      full_address: { type: String },
      location: {
        lat: { type: Number },
        lng: { type: Number },
      },
    },



    // Delivery Address Information
    delivery_address: {
      address_id: { type: Schema.Types.ObjectId, ref: "UserAddress" },
      full_address: { type: String, required: true },
      street: { type: String },
      recipient_name: { type: String },
      recipient_phone: { type: String },
      location: {
        lat: { type: Number },
        lng: { type: Number },
      },
    },
    // Per-order delivery charge (in currency units, e.g., INR)
    delivery_charge: { type: Number, default: 0 },
    // Flag indicating if admin compensates agent for this delivery (when delivery appears free to customer)
    admin_pays_agent: { type: Boolean, default: false },
    // Amount admin pays to agent for "free" deliveries (overrides delivery_charge for agent earnings)
    admin_agent_payment: { type: Number, default: 0 },
    // Cancellation metadata (when order is cancelled/rejected)
    cancellation_reason: { type: String },
    cancelled_by: { type: String }, // e.g., 'seller', 'client', 'admin', 'system', 'delivery_agent'
    cancelled_at: { type: Date },
  },

  expires_at: { type: Date },
  created_at: { type: Date, default: Date.now },
});

// Middleware to automatically fix any invalid legacy 'accepted' enum values
orderSchema.pre('validate', function(next) {
  if (this.status === 'accepted') {
    this.status = 'processing';
  }
  next();
});

// Performance indexes for common queries
// 1. Efficient retrieval of recent orders per client
orderSchema.index({ client_id: 1, created_at: -1 });

// 2. Orders by seller (for seller dashboard, recent first)
orderSchema.index({ "items.seller_id": 1, created_at: -1 });

// 3. Orders by delivery status (for delivery management queries)
orderSchema.index({ "delivery.delivery_status": 1, created_at: -1 });

// 4. Orders by payment status (for payment reconciliation)
orderSchema.index({ payment_status: 1, created_at: -1 });

// 5. Delivery agent assignment queries (find orders assigned to agent)
orderSchema.index({
  "delivery.delivery_agent_id": 1,
  "delivery.delivery_status": 1,
});

// 6. Escalated orders (for admin monitoring)
orderSchema.index({ "delivery.escalated_at": 1 }, { sparse: true });

// Additional indexes (moved from the legacy bottom-of-file block)
orderSchema.index({ seller_id: 1 });
orderSchema.index({ payment_method: 1 });
orderSchema.index({ total_amount: 1 });
// Index for discount analytics (query orders with discounts applied)
orderSchema.index({ applied_discount_amount: 1 });
orderSchema.index({ created_at: -1 });

module.exports = mongoose.model("Order", orderSchema);
