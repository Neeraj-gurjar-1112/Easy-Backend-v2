require("module-alias/register");
const mongoose = require("mongoose");
require("dotenv").config();

// Import models to trigger index creation
const { Client, Seller, Product, Order, Admin } = require("../lib/models");

async function createIndexes() {
  try {
    // Connect to MongoDB
    await mongoose.connect(
      process.env.MONGODB_URI || "mongodb://localhost:27017/your-database"
    );
    console.log("Connected to MongoDB");

    // Create indexes - this will create them if they don't exist
    console.log("Creating indexes...");

    // Client indexes
    await Client.ensureIndexes();
    console.log("✓ Client indexes created");

    // Seller indexes
    await Seller.ensureIndexes();
    console.log("✓ Seller indexes created");

    // Product indexes
    await Product.ensureIndexes();
    console.log("✓ Product indexes created");

    // Order indexes
    await Order.ensureIndexes();
    console.log("✓ Order indexes created");

    // Admin indexes
    await Admin.ensureIndexes();
    console.log("✓ Admin indexes created");

    console.log("All indexes created successfully!");

    // List all indexes for verification
    console.log("\n--- Index Summary ---");

    const clientIndexes = await Client.collection.getIndexes();
    console.log("Client indexes:", Object.keys(clientIndexes));

    const sellerIndexes = await Seller.collection.getIndexes();
    console.log("Seller indexes:", Object.keys(sellerIndexes));

    const productIndexes = await Product.collection.getIndexes();
    console.log("Product indexes:", Object.keys(productIndexes));

    const orderIndexes = await Order.collection.getIndexes();
    console.log("Order indexes:", Object.keys(orderIndexes));

    const adminIndexes = await Admin.collection.getIndexes();
    console.log("Admin indexes:", Object.keys(adminIndexes));
  } catch (error) {
    console.error("Error creating indexes:", error);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB");
    process.exit(0);
  }
}

// Run if called directly
if (require.main === module) {
  createIndexes();
}

module.exports = createIndexes;
