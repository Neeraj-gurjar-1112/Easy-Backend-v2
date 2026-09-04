const mongoose = require("mongoose");
const { Schema } = mongoose;
const bcrypt = require("bcryptjs");

// Corresponds to the 'Seller' table
const sellerSchema = new Schema({
  business_name: {
    type: String,
    required: [true, "Business name is required"],
    trim: true,
    minlength: [2, "Business name must be at least 2 characters long"],
    maxlength: [100, "Business name cannot exceed 100 characters"],
  },
  email: {
    type: String,
    required: [true, "Email is required"],
    lowercase: true,
    trim: true,
    validate: {
      validator: function (v) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      },
      message: "Please provide a valid email address",
    },
  },
  phone: {
    type: String,
    required: [true, "Phone number is required"],
    trim: true,
    validate: {
      validator: function (v) {
        return /^[\d\s\-\+\(\)]+$/.test(v) && v.replace(/\D/g, "").length >= 10;
      },
      message: "Please provide a valid phone number (minimum 10 digits)",
    },
  },
  business_type: {
    type: String,
    enum: {
      values: ["restaurant", "grocery", "pharmacy", "other"],
      message: "Business type must be restaurant, grocery, pharmacy, or other",
    },
  },
  // Optional link to Firebase Auth UID for mapping
  firebase_uid: { type: String, unique: true, sparse: true },
  approved: { type: Boolean, default: false },
  // Open / closed (active) toggle exposed to dashboards
  is_open: { type: Boolean, default: false },
  // Optional password for admin-created accounts (hashed)
  password: { type: String },
  // Restaurant details (REQUIRED)
  address: {
    type: String,
    required: [true, "Business address is required"],
  },
  cuisine: { type: String },
  logo_url: { type: String },
  banner_url: { type: String },
  opening_hours: { type: String }, // simple text or JSON string
  // Short description/about for restaurant profile
  description: { type: String },
  location: {
    lat: {
      type: Number,
      required: [true, "Location latitude is required"],
      min: [-90, "Latitude must be between -90 and 90"],
      max: [90, "Latitude must be between -90 and 90"],
    },
    lng: {
      type: Number,
      required: [true, "Location longitude is required"],
      min: [-180, "Longitude must be between -180 and 180"],
      max: [180, "Longitude must be between -180 and 180"],
    },
  },
  // Google Place ID (for precise geocoding & details)
  place_id: { type: String },
  delivery_radius_km: {
    type: Number,
    default: 5,
    min: [0, "Delivery radius cannot be negative"],
    max: [100, "Delivery radius cannot exceed 100 km"],
  },
  delivery_fee: {
    type: Number,
    default: 0,
    min: [0, "Delivery fee cannot be negative"],
  },
  admin_sort_order: { type: Number, default: 0 },
  created_at: { type: Date, default: Date.now },
  // Password reset fields
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },
});

// Performance indexes for seller queries
// 1. Find approved sellers by business type
sellerSchema.index({ approved: 1, business_type: 1 });

// 2. Geospatial index for finding nearby sellers
// NOTE: 2dsphere index removed - location uses {lat, lng} format
// which conflicts with GeoJSON requirement. To add geospatial queries later,
// refactor location to proper GeoJSON: {type: "Point", coordinates: [lng, lat]}
// sellerSchema.index({ location: "2dsphere" });

// 3. Firebase UID lookup
// NOTE: Do NOT add a separate schema.index here because the path-level
// unique:true,sparse:true on firebase_uid already creates the necessary index.
// Defining both causes Mongoose duplicate index warnings.

sellerSchema.pre("save", async function (next) {
  if (!this.isModified("password") || !this.password) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (e) {
    next(e);
  }
});

sellerSchema.methods.comparePassword = async function (candidate) {
  if (!this.password) return false;
  return bcrypt.compare(candidate, this.password);
};

// Additional indexes (moved from the legacy bottom-of-file block)
// Single-field indexes for common lookups
sellerSchema.index({ business_name: 1 });
sellerSchema.index({ phone: 1 });
// Ensure email uniqueness for sellers (sparse to allow optional emails)
sellerSchema.index({ email: 1 }, { unique: true, sparse: true });
sellerSchema.index({ created_at: -1 });

sellerSchema.index({ cuisine: 1 });
sellerSchema.index({ description: 1 });

module.exports = mongoose.model("Seller", sellerSchema);
