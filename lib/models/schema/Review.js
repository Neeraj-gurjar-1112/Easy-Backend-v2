const mongoose = require("mongoose");
const { Schema } = mongoose;

// ========================================
// PRODUCT REVIEWS & RATINGS
// ========================================
const reviewSchema = new Schema({
  product_id: {
    type: Schema.Types.ObjectId,
    ref: "Product",
    required: [true, "Product ID is required"],
  },
  client_id: {
    type: String,
    required: [true, "Client ID is required"],
  },
  rating: {
    type: Number,
    required: [true, "Rating is required"],
    min: [1, "Rating must be at least 1"],
    max: [5, "Rating cannot exceed 5"],
  },
  comment: {
    type: String,
    trim: true,
    maxlength: [1000, "Comment cannot exceed 1000 characters"],
  },
  images: [
    {
      type: String,
      validate: {
        validator: function (v) {
          return /^https?:\/\/.+/.test(v);
        },
        message: "Image must be a valid URL",
      },
    },
  ],
  helpful_count: {
    type: Number,
    default: 0,
    min: 0,
  },
  verified_purchase: {
    type: Boolean,
    default: false,
  },
  seller_response: {
    message: {
      type: String,
      trim: true,
      maxlength: [500, "Response cannot exceed 500 characters"],
    },
    responded_at: { type: Date },
    seller_id: { type: Schema.Types.ObjectId, ref: "Seller" },
  },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
});

// Indexes for reviews
reviewSchema.index({ product_id: 1, created_at: -1 });
reviewSchema.index({ client_id: 1, created_at: -1 });
reviewSchema.index({ rating: 1 });
// Prevent duplicate reviews from same client for same product
reviewSchema.index({ product_id: 1, client_id: 1 }, { unique: true });

module.exports = mongoose.model("Review", reviewSchema);
