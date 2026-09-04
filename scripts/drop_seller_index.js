require("module-alias/register");
require('dotenv').config();
const mongoose = require('mongoose');

async function dropIndex() {
  try {
    const uri = process.env.DB_CONNECTION_STRING || "mongodb://127.0.0.1:27017/easy_app";
    await mongoose.connect(uri);
    console.log('✅ Connected to MongoDB');

    const collection = mongoose.connection.collection('sellers');
    
    // Check if the index exists
    const indexes = await collection.indexes();
    const geoIndex = indexes.find(idx => idx.key.location === '2dsphere');
    
    if (geoIndex) {
      console.log(`Found 2dsphere index: ${geoIndex.name}. Dropping it...`);
      await collection.dropIndex(geoIndex.name);
      console.log('✅ Index dropped successfully.');
    } else {
      console.log('⚠️ 2dsphere index on location not found in sellers collection.');
    }
  } catch (error) {
    console.error('❌ Error dropping index:', error);
  } finally {
    await mongoose.connection.close();
    console.log('MongoDB connection closed');
  }
}

dropIndex();
