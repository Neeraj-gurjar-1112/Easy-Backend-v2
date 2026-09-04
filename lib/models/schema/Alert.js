const mongoose = require("mongoose");
const { Schema } = mongoose;

// Automated alert records (admin monitoring)
const alertSchema = new Schema({
  type: { type: String, required: true }, // e.g. 'fraud_signal','revenue_drop','high_refund_rate'
  severity: {
    type: String,
    enum: ["info", "low", "medium", "high", "critical"],
    default: "low",
  },
  message: { type: String, required: true },
  meta: { type: Object }, // structured details (ids, values, window, rule)
  acknowledged: { type: Boolean, default: false },
  acknowledged_at: { type: Date },
  created_at: { type: Date, default: Date.now },
});
alertSchema.index({ type: 1, severity: 1, created_at: -1 });
alertSchema.index({ acknowledged: 1, created_at: -1 });

module.exports = mongoose.model("Alert", alertSchema);
