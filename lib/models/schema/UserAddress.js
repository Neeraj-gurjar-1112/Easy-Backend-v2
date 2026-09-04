const mongoose = require("mongoose");
const { Schema } = mongoose;

// User Addresses
const userAddressSchema = new Schema({
  user_id: { type: String, required: true }, // Removed index: true to avoid duplicate with compound index
  label: { type: String }, // "Home", "Office", "Other"
  full_address: { type: String, required: true },
  street: { type: String },
  city: { type: String },
  state: { type: String },
  pincode: { type: String },
  landmark: { type: String },
  recipient_name: { type: String },
  recipient_phone: { type: String },
  is_default: { type: Boolean, default: false },
  location: {
    lat: { type: Number },
    lng: { type: Number },
  },
  // Google Place ID (if captured from Places Autocomplete / Map Picker)
  place_id: { type: String },
  created_at: { type: Date, default: Date.now },
});
// Compound index for efficient user address queries - only defined once
userAddressSchema.index({ user_id: 1, created_at: -1 });

module.exports = mongoose.model("UserAddress", userAddressSchema);
