const mongoose = require("mongoose");
const { Schema } = mongoose;

// User Cart (simple full replace model)
const cartSchema = new Schema({
  user_id: { type: String, required: true, unique: true },
  items: [
    {
      product_id: { type: String, required: true },
      name: String,
      price: Number,
      qty: { type: Number, required: true },
      seller_id: String,
    },
  ],
  updated_at: { type: Date, default: Date.now },
});
cartSchema.pre("save", function (next) {
  this.updated_at = new Date();
  next();
});

module.exports = mongoose.model("Cart", cartSchema);
