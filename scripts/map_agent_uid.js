require("module-alias/register");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const mongoose = require("mongoose");
const { DeliveryAgent } = require("../lib/models");

const uri =
  process.env.DB_CONNECTION_STRING || "mongodb://127.0.0.1:27017/easy_app";

function looksLikeObjectId(s) {
  return typeof s === 'string' && /^[a-fA-F0-9]{24}$/.test(s);
}

async function run() {
  try {
    // Supports either env vars or CLI args:
    //   AGENT_ID=<id> AGENT_UID=<uid> node scripts/map_agent_uid.js
    //   or: AGENT_EMAIL=<email> AGENT_UID=<uid> node scripts/map_agent_uid.js
    //   or: node scripts/map_agent_uid.js <agentIdOrEmail> <firebase_uid>
    const idOrEmail = process.env.AGENT_ID || process.env.AGENT_EMAIL || process.argv[2];
    const firebaseUid = process.env.AGENT_UID || process.argv[3];

    if (!idOrEmail || !firebaseUid) {
      console.error(
        "Usage: AGENT_ID=<id>|AGENT_EMAIL=<email> AGENT_UID=<uid> node scripts/map_agent_uid.js\n       or: node scripts/map_agent_uid.js <agentIdOrEmail> <uid>"
      );
      process.exit(1);
    }

    await mongoose.connect(uri);
    console.log("✅ Connected to MongoDB");

    let query;
    if (looksLikeObjectId(idOrEmail) && !idOrEmail.includes('@')) {
      query = { _id: idOrEmail };
    } else {
      // Case-insensitive email match
      const normEmail = String(idOrEmail).toLowerCase().trim();
      const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query = { email: { $regex: new RegExp(`^${escapeRegex(normEmail)}$`, 'i') } };
    }

    const res = await DeliveryAgent.updateOne(query, {
      $set: { firebase_uid: firebaseUid },
    });
    if (res.matchedCount === 0) {
      console.error(`❌ No DeliveryAgent found for ${JSON.stringify(query)}`);
      process.exit(2);
    }
    console.log(`🎉 DeliveryAgent mapped to firebase_uid=${firebaseUid}`);
  } catch (e) {
    console.error("Error mapping delivery agent uid:", e);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
  }
}

run();
