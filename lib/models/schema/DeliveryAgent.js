const mongoose = require("mongoose");
const { Schema } = mongoose;
const bcrypt = require("bcryptjs");

// Delivery agents (enhanced with Firebase auth and approval workflow)
const deliveryAgentSchema = new Schema({
  name: {
    type: String,
    required: [true, "Name is required"],
    trim: true,
    minlength: [2, "Name must be at least 2 characters long"],
    maxlength: [100, "Name cannot exceed 100 characters"],
  },
  email: {
    type: String,
    required: [true, "Email is required"],
    unique: true,
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
  firebase_uid: { type: String, unique: true, sparse: true },
  // Password for direct email+password login (hashed via bcrypt pre-save hook)
  password: { type: String },
  approved: { type: Boolean, default: false }, // Requires admin approval
  active: { type: Boolean, default: true }, // Online/offline status
  available: { type: Boolean, default: true }, // Available for new orders
  assigned_orders: {
    type: Number,
    default: 0,
    min: [0, "Assigned orders cannot be negative"],
  },
  completed_orders: {
    type: Number,
    default: 0,
    min: [0, "Completed orders cannot be negative"],
  },
  rating: {
    type: Number,
    default: 0,
    min: [0, "Rating cannot be negative"],
    max: [5, "Rating cannot exceed 5"],
  },
  total_ratings: {
    type: Number,
    default: 0,
    min: [0, "Total ratings cannot be negative"],
  },
  vehicle_type: {
    type: String,
    enum: {
      values: ["bike", "scooter", "bicycle", "car"],
      message: "Vehicle type must be bike, scooter, bicycle, or car",
    },
    default: "bike",
  },
  license_number: { type: String },
  current_location: {
    lat: {
      type: Number,
      min: [-90, "Latitude must be between -90 and 90"],
      max: [90, "Latitude must be between -90 and 90"],
    },
    lng: {
      type: Number,
      min: [-180, "Longitude must be between -180 and 180"],
      max: [180, "Longitude must be between -180 and 180"],
    },
    updated_at: { type: Date, default: Date.now },
  },
  working_hours: {
    start: { type: String, default: "09:00" }, // HH:MM format
    end: { type: String, default: "21:00" },
  },
  created_at: { type: Date, default: Date.now },
  // Password reset fields
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },
});

deliveryAgentSchema.pre("save", async function (next) {
  if (!this.isModified("password") || !this.password) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (e) {
    next(e);
  }
});

deliveryAgentSchema.methods.comparePassword = async function (candidate) {
  if (!this.password) return false;
  return bcrypt.compare(candidate, this.password);
};

// Performance indexes for delivery agent queries
// 1. Find available agents for assignment (approved, active, available)
deliveryAgentSchema.index({ approved: 1, active: 1, available: 1 });

// 2. Agent performance tracking (for admin reports)
deliveryAgentSchema.index({ completed_orders: -1, rating: -1 });

// NOTE: 2dsphere index removed - current_location uses {lat, lng, updated_at} format
// which conflicts with GeoJSON requirement. To add geospatial queries later,
// refactor current_location to proper GeoJSON: {type: "Point", coordinates: [lng, lat]}

module.exports = mongoose.model("DeliveryAgent", deliveryAgentSchema);
