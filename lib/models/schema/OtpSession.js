const mongoose = require("mongoose");
const { Schema } = mongoose;

// ========================================
// OTP SESSION (temporary — auto-expires via TTL index)
// Tracks active OTP verification sessions for phone-based auth.
// Populated by POST /api/auth/otp/send and consumed by POST /api/auth/otp/verify.
// ========================================
const otpSessionSchema = new Schema({
  // E.164 phone number e.g. '+919876543210'
  phone: {
    type: String,
    required: [true, "Phone is required"],
    trim: true,
  },
  // verificationId returned by Message Central's send-OTP call
  verificationId: {
    type: String,
    required: [true, "verificationId is required"],
  },
  // Identifies the reason for this OTP session
  purpose: {
    type: String,
    enum: ["client_login", "partner_signup"],
    required: [true, "Purpose is required"],
  },
  // Short-lived signed token issued after OTP success (partner_signup only)
  // Passed to /signup/seller or /signup/delivery-agent to prove phone ownership
  phoneVerifiedToken: { type: String },
  // Number of failed verification attempts (to prevent brute-force)
  failedAttempts: { type: Number, default: 0 },
  // Soft-lock: no further attempts allowed after this (null = not locked)
  lockedUntil: { type: Date },
  created_at: { type: Date, default: Date.now },
  // MongoDB TTL index removes the document automatically after expiry
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    required: true,
  },
});

// Compound index: one active session per phone+purpose
otpSessionSchema.index({ phone: 1, purpose: 1 });
// TTL index: MongoDB auto-deletes documents after expiresAt
otpSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("OtpSession", otpSessionSchema);
