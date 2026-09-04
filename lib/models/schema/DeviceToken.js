const mongoose = require("mongoose");
const { Schema } = mongoose;

// Device tokens for push notifications (FCM)
const deviceTokenSchema = new Schema({
  user_id: { type: String, required: true }, // firebase uid or seller/admin id as string - removed index: true to avoid duplicate with compound index
  token: { type: String, required: true },
  platform: { type: String }, // android/ios/web
  last_seen: { type: Date, default: Date.now },
});
deviceTokenSchema.index({ user_id: 1, token: 1 }, { unique: true }); // This covers user_id indexing

module.exports = mongoose.model("DeviceToken", deviceTokenSchema);
