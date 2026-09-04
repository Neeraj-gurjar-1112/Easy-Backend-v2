require("module-alias/register");
#!/usr/bin/env node
// One-off script to migrate existing Seller plaintext passwords to bcrypt
// Usage: node scripts/migrate_seller_passwords_bcrypt.js
require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { Seller } = require("../lib/models");

async function run() {
  const uri =
    process.env.MONGODB_URI ||
    process.env.DB_CONNECTION_STRING ||
    "mongodb://127.0.0.1:27017/easyapp";
  console.log("Connecting to MongoDB:", uri.replace(/:\\S+@/, ":****@"));
  await mongoose.connect(uri).catch((e) => {
    console.error("Failed to connect to MongoDB:", e.message);
    console.error(
      "Tip: set MONGODB_URI or DB_CONNECTION_STRING in Backend/.env or start local MongoDB on 127.0.0.1:27017"
    );
    process.exit(1);
  });
  const sellers = await Seller.find({ password: { $exists: true, $ne: null } });
  let migrated = 0,
    skipped = 0,
    errors = 0;
  for (const s of sellers) {
    try {
      const pw = s.password;
      // Heuristic: bcrypt hashes start with $2a$ or $2b$ or $2y$
      if (typeof pw === "string" && pw.startsWith("$2")) {
        skipped++;
        continue;
      }
      // Hash and save
      const salt = await bcrypt.genSalt(10);
      s.password = await bcrypt.hash(String(pw), salt);
      await s.save();
      migrated++;
    } catch (e) {
      errors++;
      console.error("Failed to migrate seller", s._id, e.message);
    }
  }
  console.log(
    `Migration complete. Migrated: ${migrated}, Skipped(already hashed): ${skipped}, Errors: ${errors}`
  );
  await mongoose.disconnect();
}
run().catch((e) => {
  console.error("Migration error", e);
  process.exit(1);
});
