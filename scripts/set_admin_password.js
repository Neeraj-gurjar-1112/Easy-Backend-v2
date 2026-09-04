require("module-alias/register");
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const { Admin } = require('../lib/models');

const newPass = process.argv[2];
const email = (process.argv[3] || 'admin@example.com').toLowerCase();

if (!newPass) {
  console.error('Usage: node set_admin_password.js <newPassword> [email]');
  process.exit(1);
}

const uri = process.env.DB_CONNECTION_STRING || 'mongodb://127.0.0.1:27017/easy_app';

(async () => {
  try {
    await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log('Connected to MongoDB');
    const admin = await Admin.findOne({ email });
    if (!admin) {
      console.error(`No admin found with email: ${email}`);
      process.exit(2);
    }
    admin.password = newPass;
    await admin.save();
    console.log(`Password updated for ${email}`);
    process.exit(0);
  } catch (e) {
    console.error('Error updating password:', e);
    process.exit(3);
  }
})();
