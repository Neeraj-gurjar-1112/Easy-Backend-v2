require("module-alias/register");
// Migration script to normalize existing orders' client_id field to string.
// Usage: node scripts/migrate_client_id.js
// It will scan orders where client_id is an ObjectId (legacy) and convert to its hex string.
// Safe to re-run; it skips documents already strings.

require("dotenv").config();
const mongoose = require("mongoose");
const { Order } = require("../lib/models");

async function run() {
  const uri =
    process.env.DB_CONNECTION_STRING || "mongodb://127.0.0.1:27017/easy_app";
  await mongoose.connect(uri);
  console.log("Connected to MongoDB");

  // Find orders where client_id stored as ObjectId (not a string)
  const legacy = await Order.find({ client_id: { $type: "objectId" } }).lean();
  if (!legacy.length) {
    console.log("No legacy orders needing migration.");
    await mongoose.disconnect();
    return;
  }
  console.log(`Found ${legacy.length} legacy orders. Migrating...`);

  const bulk = Order.collection.initializeUnorderedBulkOp();
  for (const o of legacy) {
    bulk
      .find({ _id: o._id })
      .updateOne({ $set: { client_id: o.client_id.toString() } });
  }
  const result = await bulk.execute();
  console.log("Bulk update result:", result.result || result);

  // Verify
  const remaining = await Order.countDocuments({
    client_id: { $type: "objectId" },
  });
  console.log("Remaining legacy count:", remaining);

  await mongoose.disconnect();
  console.log("Migration complete.");
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
