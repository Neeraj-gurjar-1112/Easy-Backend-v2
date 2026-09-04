require("module-alias/register");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const mongoose = require("mongoose");
const { Seller } = require("../lib/models");
const uri =
  process.env.DB_CONNECTION_STRING || "mongodb://127.0.0.1:27017/easy_app";
(async () => {
  try {
    await mongoose.connect(uri);
    const sellers = await Seller.find({})
      .select("email business_name firebase_uid approved")
      .lean();
    console.log("Total sellers:", sellers.length);
    console.table(sellers);
  } catch (e) {
    console.error("Error listing sellers:", e);
  } finally {
    await mongoose.connection.close();
  }
})();
