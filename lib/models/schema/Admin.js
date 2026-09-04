const mongoose = require("mongoose");
const { Schema } = mongoose;
const bcrypt = require("bcryptjs");

// Corresponds to the 'Admin' table
const adminSchema = new Schema({
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
  role: {
    type: String,
    enum: {
      values: ["superadmin", "moderator"],
      message: "Role must be either superadmin or moderator",
    },
    required: [true, "Role is required"],
  },
  // Hashed password (bcrypt)
  password: {
    type: String,
    minlength: [6, "Password must be at least 6 characters long"],
  },
  // Optional link to Firebase Auth UID for admin login mapping
  firebase_uid: { type: String, unique: true, sparse: true },
  created_at: { type: Date, default: Date.now },
  // Password reset fields
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },
});

adminSchema.pre("save", async function (next) {
  if (!this.isModified("password") || !this.password) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (e) {
    next(e);
  }
});

adminSchema.methods.comparePassword = async function (candidate) {
  if (!this.password) return false;
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model("Admin", adminSchema);
