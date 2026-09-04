const mongoose = require("mongoose");
const { Schema } = mongoose;

// Corresponds to the 'Product' table
const productSchema = new Schema({
  seller_id: {
    type: Schema.Types.ObjectId,
    ref: "Seller",
    required: [true, "Seller ID is required"],
  },
  name: {
    type: String,
    required: [true, "Product name is required"],
    trim: true,
    minlength: [2, "Product name must be at least 2 characters long"],
    maxlength: [200, "Product name cannot exceed 200 characters"],
  },
  category: {
    type: String,
    trim: true,
  }, // e.g., Grocery, Restaurant, Vegetables
  // Sub-category for Grocery items only (Oil & Ghee, Spices, etc.)
  sub_category: {
    type: String,
    trim: true,
  },
  // Custom sub-category when "Others" is selected
  custom_sub_category: {
    type: String,
    trim: true,
    maxlength: [100, "Custom sub-category cannot exceed 100 characters"],
  },
  price: {
    type: Number,
    required: [true, "Price is required"],
    min: [0, "Price cannot be negative"],
  },
  // MRP (Maximum Retail Price) - original price before discount
  mrp: {
    type: Number,
    min: [0, "MRP cannot be negative"],
  },
  // Discounted price (optional) - if set, this is shown as selling price
  discounted_price: {
    type: Number,
    min: [0, "Discounted price cannot be negative"],
  },
  stock: {
    type: Number,
    default: 100,
    min: [0, "Stock cannot be negative"],
  },
  image: { type: String }, // optional image URL
  description: {
    type: String,
    maxlength: [1000, "Description cannot exceed 1000 characters"],
  },
  status: {
    type: String,
    enum: {
      values: ["active", "inactive"],
      message: "Status must be either active or inactive",
    },
    default: "active",
  },
  admin_sort_order: { type: Number, default: 0 },
  created_at: { type: Date, default: Date.now },
});

// Performance indexes for product queries
// 1. Products by seller (for seller product management)
productSchema.index({ seller_id: 1, created_at: -1 });

// 2. Active products by category (for client browsing)
productSchema.index({ category: 1, status: 1 });

// 3. Active grocery products by sub-category (for grocery browsing with sub-categories)
productSchema.index({ category: 1, sub_category: 1, status: 1 });

// 4. Text search on product name and description (for search functionality)
productSchema.index({ name: "text", description: "text" });

// 5. Stock level monitoring (for low stock alerts)
productSchema.index({ stock: 1, status: 1 });

// Additional indexes (moved from the legacy bottom-of-file block)
productSchema.index({ seller_id: 1 });
productSchema.index({ category: 1 });
productSchema.index({ created_at: -1 });
// Text/regex-friendly indexes to assist search
productSchema.index({ name: 1 });
productSchema.index({ description: 1 });

module.exports = mongoose.model("Product", productSchema);
