require("module-alias/register");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const { Admin } = require("../lib/models");
const bcrypt = require("bcryptjs");

const uri =
  process.env.DB_CONNECTION_STRING || "mongodb://127.0.0.1:27017/easy_app";

(async () => {
  try {
    await mongoose.connect(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("Connected to MongoDB:", uri);

    const admins = await Admin.find({});
    console.log(`\nFound ${admins.length} admin(s):`);

    for (const admin of admins) {
      console.log("\n---");
      console.log("ID:", admin._id);
      console.log("Email:", admin.email);
      console.log("Role:", admin.role);
      console.log("Password hash:", admin.password);

      // Test if current hash matches Admin@123
      const matchesAdmin123 = await bcrypt.compare("Admin@123", admin.password);
      console.log('Matches "Admin@123":', matchesAdmin123);

      // Test other common passwords
      const matchesadmin123 = await bcrypt.compare("admin123", admin.password);
      console.log('Matches "admin123":', matchesadmin123);
    }

    process.exit(0);
  } catch (e) {
    console.error("Error:", e);
    process.exit(1);
  }
})();
