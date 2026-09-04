const mongoose = require("mongoose");
const { Schema } = mongoose;

// ========================================
// WISHLIST / FAVORITES
// ========================================
const wishlistSchema = new Schema({
  client_id: {
    type: String,
    required: [true, "Client ID is required"],
  },
  product_id: {
    type: Schema.Types.ObjectId,
    ref: "Product",
    required: [true, "Product ID is required"],
  },
  added_at: { type: Date, default: Date.now },
});

// Indexes for wishlist
wishlistSchema.index({ client_id: 1, added_at: -1 });
wishlistSchema.index({ product_id: 1 });
// Prevent duplicate entries
wishlistSchema.index({ client_id: 1, product_id: 1 }, { unique: true });

module.exports = mongoose.model("Wishlist", wishlistSchema);
