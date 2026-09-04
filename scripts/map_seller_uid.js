require("module-alias/register");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const mongoose = require("mongoose");
const { Seller } = require("../lib/models");

const uri =
  process.env.DB_CONNECTION_STRING || "mongodb://127.0.0.1:27017/easy_app";

async function run() {
  try {
    const email = process.env.SELLER_EMAIL || process.argv[2];
    const firebaseUid = process.env.SELLER_UID || process.argv[3];

    if (!email || !firebaseUid) {
      console.error(
        "Usage: SELLER_EMAIL=<email> SELLER_UID=<uid> node scripts/map_seller_uid.js\n       or: node scripts/map_seller_uid.js <email> <uid>"
      );
      process.exit(1);
    }

    await mongoose.connect(uri);
    console.log("✅ Connected to MongoDB");
    const normEmail = String(email).toLowerCase().trim();
    const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const ciQuery = {
      email: { $regex: new RegExp(`^${escapeRegex(normEmail)}$`, "i") },
    };
    const res = await Seller.updateOne(ciQuery, {
      $set: { firebase_uid: firebaseUid, email: normEmail },
    });
    if (res.matchedCount === 0) {
      console.error(`❌ No Seller found with email: ${email}`);
      process.exit(2);
    }
    console.log(`🎉 Seller ${email} mapped to firebase_uid=${firebaseUid}`);
  } catch (e) {
    console.error("Error mapping seller uid:", e);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
  }
}

run();
