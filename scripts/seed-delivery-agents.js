/**
 * Seed delivery agents (and the default admin if missing) for local development / demos.
 *
 *   node scripts/seed-delivery-agents.js            # upsert 32 agents by email, keep existing docs
 *   node scripts/seed-delivery-agents.js --reset    # delete all delivery agents first
 *
 * Idempotent: re-running updates the same 32 rows. Admin login after seeding: admin@example.com with
 * SEED_ADMIN_PASSWORD (or the local default inside lib/seed/deliveryAgents.js — never use that on a shared host).
 * Connects exactly like the running server (lib/db/mongoose.js), so the data lands where the API reads it.
 */
require("module-alias/register");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const { getUri, getDbName } = require("@lib/db/mongoose");
const { seedDeliveryAgents } = require("@lib/seed/deliveryAgents");

async function main() {
  const uri = getUri();
  await mongoose.connect(uri, { dbName: getDbName(uri) });
  console.log(`Connected to ${uri} (db: ${mongoose.connection.name})`);

  await seedDeliveryAgents({
    reset: process.argv.includes("--reset"),
    log: (msg) => console.log(msg),
  });

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
