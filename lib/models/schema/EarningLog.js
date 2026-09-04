const mongoose = require("mongoose");
const { Schema } = mongoose;

// Earnings log for payouts/accounting
const earningLogSchema = new Schema({
  role: { type: String, enum: ["seller", "delivery"], required: true },
  order_id: { type: Schema.Types.ObjectId, ref: "Order", required: true },
  seller_id: { type: Schema.Types.ObjectId, ref: "Seller" },
  agent_id: { type: Schema.Types.ObjectId, ref: "DeliveryAgent" },
  // monetary fields
  item_total: { type: Number, default: 0 }, // sum of products for this role scope
  delivery_charge: { type: Number, default: 0 },
  platform_commission: { type: Number, default: 0 },
  net_earning: { type: Number, default: 0 }, // for seller: item_total - commission; for agent: delivery_share
  meta: { type: Object },
  paid: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now },
});
earningLogSchema.index(
  { order_id: 1, role: 1, seller_id: 1, agent_id: 1 },
  { unique: true, sparse: true },
);

module.exports = mongoose.model("EarningLog", earningLogSchema);
