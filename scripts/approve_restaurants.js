require("module-alias/register");
/**
 * approve_restaurants.js
 *
 * Script to approve all existing restaurant sellers that are currently unapproved.
 * Run this once to fix existing restaurants, then new restaurants will auto-approve.
 */

require("dotenv").config();
const mongoose = require("mongoose");
const { Seller } = require("../lib/models");

async function approveRestaurants() {
  try {
    // Connect to MongoDB
    const mongoUri =
      process.env.MONGO_URI || "mongodb://localhost:27017/grocery";
    await mongoose.connect(mongoUri);
    console.log("✅ Connected to MongoDB");

    // Find all unapproved restaurants
    const unapprovedRestaurants = await Seller.find({
      business_type: { $regex: /restaurant/i },
      approved: false,
    });

    console.log(
      `\n📊 Found ${unapprovedRestaurants.length} unapproved restaurant(s)\n`
    );

    if (unapprovedRestaurants.length === 0) {
      console.log("✅ All restaurants are already approved!");
      await mongoose.disconnect();
      return;
    }

    // Approve each restaurant
    for (const restaurant of unapprovedRestaurants) {
      console.log(
        `Approving: ${restaurant.business_name} (${restaurant.email})`
      );
      restaurant.approved = true;
      await restaurant.save();
    }

    console.log(
      `\n✅ Successfully approved ${unapprovedRestaurants.length} restaurant(s)!`
    );
    console.log("🎉 They should now appear in the Easy Food section.");

    await mongoose.disconnect();
    console.log("\n✅ Disconnected from MongoDB");
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

// Run the script
approveRestaurants();
