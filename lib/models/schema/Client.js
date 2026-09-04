const mongoose = require("mongoose");
const { Schema } = mongoose;

// Corresponds to the 'Client' table
const clientSchema = new Schema({
  // Legacy single name retained for backwards compatibility; new first/last fields below drive profile completion.
  name: { type: String },
  first_name: { type: String },
  last_name: { type: String },
  dob: { type: Date },
  phone: { type: String }, // primary identifier besides firebase_uid (email removed Oct 2025)
  // email removed from active client profile spec; legacy documents may still have this field but it's no longer enforced/updated
  // Keep field absence: do NOT declare email so Mongoose won't enforce validation; existing data remains in MongoDB.
  // Optional link to Firebase Auth UID for profile enrichment / mapping
  firebase_uid: { type: String, unique: true, sparse: true },
  // Optional profile image URL
  avatar_url: { type: String },
  otp_verified: { type: Boolean, default: false },
  profile_completed: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now },
});

// Additional indexes (moved from the legacy bottom-of-file block)
// Add performance indexes
// Enforce unique phone numbers platform-wide for clients (allow sparse so empty/undefined not duplicated)
// NOTE: If legacy duplicates exist, index build will fail; run a cleanup script before deploying.
clientSchema.index({ phone: 1 }, { unique: true, sparse: true });
// Ensure email uniqueness (optional for accounts without email)
clientSchema.index({ email: 1 }, { unique: true, sparse: true });
clientSchema.index({ created_at: -1 });

module.exports = mongoose.model("Client", clientSchema);
