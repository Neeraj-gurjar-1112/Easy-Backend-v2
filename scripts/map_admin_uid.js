require("module-alias/register");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const mongoose = require("mongoose");
const { Admin } = require("../lib/models");

const uri =
  process.env.DB_CONNECTION_STRING || "mongodb://127.0.0.1:27017/easy_app";

async function run() {
  try {
    // Supports either env vars or CLI args: node scripts/map_admin_uid.js <email> <firebase_uid>
    const email = process.env.ADMIN_EMAIL || process.argv[2];
    const firebaseUid = process.env.ADMIN_UID || process.argv[3];

    if (!email || !firebaseUid) {
      console.error(
        "Usage: ADMIN_EMAIL=<email> ADMIN_UID=<uid> node scripts/map_admin_uid.js\n       or: node scripts/map_admin_uid.js <email> <uid>"
      );
      process.exit(1);
    }

    await mongoose.connect(uri);
    console.log("✅ Connected to MongoDB");
    const res = await Admin.updateOne(
      { email },
      { $set: { firebase_uid: firebaseUid } }
    );
    if (res.matchedCount === 0) {
      console.error(`❌ No Admin found with email: ${email}`);
      process.exit(2);
    }
    console.log(`🎉 Admin ${email} mapped to firebase_uid=${firebaseUid}`);
  } catch (e) {
    console.error("Error mapping admin uid:", e);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
  }
}

run();
