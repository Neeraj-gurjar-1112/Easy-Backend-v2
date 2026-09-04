const mongoose = require("mongoose");
const { Schema } = mongoose;

// Platform-wide settings managed by admins
const platformSettingsSchema = new Schema({
  currency_symbol: { type: String, default: "₹" },
  locale: { type: String, default: "en_IN" },
  low_stock_threshold: { type: Number, default: 5 },
  order_status_notifications: { type: Boolean, default: true },
  // Delivery charge configuration (flat for now, per group)
  delivery_charge_grocery: { type: Number, default: 30 },
  delivery_charge_food: { type: Number, default: 40 },
  // Minimum subtotal required per group to waive delivery charge
  // If group subtotal >= this threshold, delivery charge for that group becomes 0
  min_total_for_delivery_charge: { type: Number, default: 100 },
  // Admin-paid delivery compensation settings
  // When true, admin compensates delivery agents for "free" deliveries (orders above threshold)
  free_delivery_admin_compensation: { type: Boolean, default: false },
  // Amount admin pays to delivery agent when delivery appears free to customer
  free_delivery_agent_payment: { type: Number, default: 0 },
  // Coupons (admin-managed)
  coupons: [
    new Schema(
      {
        code: { type: String, required: true },
        percent: { type: Number, required: true, min: 0, max: 100 },
        active: { type: Boolean, default: true },
        minSubtotal: { type: Number, default: 0 },
        // Optional category scoping for coupon applicability. Allowed values: 'grocery', 'vegetable', 'food'.
        categories: [
          {
            type: String,
            lowercase: true,
            enum: ["grocery", "vegetable", "food"],
          },
        ],
        // Seller-specific restrictions
        seller_ids: [{ type: Schema.Types.ObjectId, ref: "Seller" }], // If specified, coupon only applies to these sellers
        excluded_seller_ids: [{ type: Schema.Types.ObjectId, ref: "Seller" }], // Sellers excluded from using this coupon
        // Per-seller enablement tracking
        seller_enablement: [
          {
            seller_id: {
              type: Schema.Types.ObjectId,
              ref: "Seller",
              required: true,
            },
            enabled: { type: Boolean, default: true },
            disabled_at: { type: Date },
            disabled_by: { type: String }, // admin identifier
          },
        ],
        validFrom: { type: Date },
        validTo: { type: Date },
        // Usage tracking fields
        usage_count: { type: Number, default: 0 }, // Total times this coupon has been used
        usage_limit: { type: Number, default: null }, // Max total uses (null = unlimited)
        max_uses_per_user: { type: Number, default: 1 }, // Max uses per individual user
        used_by: [
          {
            client_id: { type: String, required: true },
            usage_count: { type: Number, default: 1 },
            last_used: { type: Date, default: Date.now },
          },
        ],
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
      },
      { _id: false },
    ),
  ],
  // Platform commission and delivery earnings split
  // Commission rate applied on item totals (exclude delivery charge). Example: 0.1 => 10%
  platform_commission_rate: { type: Number, default: 0.1 },
  // Portion of delivery charge that goes to delivery agent. Example: 0.8 => 80%
  delivery_agent_share_rate: { type: Number, default: 0.8 },
  // Max active orders a delivery agent can hold at once
  max_delivery_orders_per_agent: { type: Number, default: 3 },
  updated_at: { type: Date, default: Date.now },
});

module.exports = mongoose.model("PlatformSettings", platformSettingsSchema);
