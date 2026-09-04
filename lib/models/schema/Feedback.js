const mongoose = require("mongoose");
const { Schema } = mongoose;

// Customer feedback / support ticket
const feedbackSchema = new Schema({
  user_id: { type: String, required: true },
  order_id: { type: Schema.Types.ObjectId, ref: "Order" }, // Optional order reference
  type: {
    type: String,
    enum: ["bug", "feature", "complaint", "other"],
    default: "other",
  },
  message: { type: String, required: true },
  status: {
    type: String,
    enum: ["open", "in_progress", "resolved", "closed"],
    default: "open",
  },
  resolution_note: { type: String },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
});
feedbackSchema.pre("save", function (next) {
  this.updated_at = new Date();
  next();
});

module.exports = mongoose.model("Feedback", feedbackSchema);
