const mongoose = require("mongoose");
const { Schema } = mongoose;

// Notification / marketing campaign (very lightweight)
const notificationCampaignSchema = new Schema({
  title: { type: String, required: true },
  message: { type: String, required: true },
  segment: {
    type: String,
    enum: ["all", "clients", "sellers"],
    default: "all",
  },
  scheduled_at: { type: Date },
  status: {
    type: String,
    enum: ["draft", "scheduled", "sent", "canceled"],
    default: "draft",
  },
  created_at: { type: Date, default: Date.now },
});
notificationCampaignSchema.index({ status: 1, scheduled_at: 1 });

module.exports = mongoose.model("NotificationCampaign", notificationCampaignSchema);
