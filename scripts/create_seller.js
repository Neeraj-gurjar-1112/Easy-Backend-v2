require("module-alias/register");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const mongoose = require("mongoose");
const { Seller } = require("../lib/models");
const uri =
  process.env.DB_CONNECTION_STRING || "mongodb://127.0.0.1:27017/easy_app";
(async () => {
  try {
    const [email, businessName, phone, businessType, firebaseUid] =
      process.argv.slice(2);
    if (!email || !businessName || !phone || !businessType) {
      console.error(
        "Usage: node scripts/create_seller.js <email> <business_name> <phone> <business_type> [firebase_uid]"
      );
      process.exit(1);
    }
    await mongoose.connect(uri);
    const seller = await Seller.create({
      email: String(email).toLowerCase().trim(),
      business_name: businessName,
      phone,
      business_type: businessType,
      approved: true,
      firebase_uid: firebaseUid || undefined,
      address: "Udaipur, Rajasthan",
      location: { lat: 24.58, lng: 73.68 },
    });
    console.log("✅ Created seller:", seller.email, seller._id.toString());
  } catch (e) {
    console.error("Error creating seller:", e);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
  }
})();
