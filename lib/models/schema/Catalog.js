const mongoose = require("mongoose");
const { Schema } = mongoose;

// Corresponds to the 'Catalog' table
const catalogSchema = new Schema({
  seller_id: {
    type: Schema.Types.ObjectId,
    ref: "Seller",
    required: true,
    unique: true,
  },
  min_products_required: { type: Number, default: 0 },
  published: { type: Boolean, default: false },
});

module.exports = mongoose.model("Catalog", catalogSchema);
