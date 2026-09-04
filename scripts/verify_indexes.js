require("module-alias/register");
/**
 * Verify Database Indexes Script
 * 
 * This script connects to MongoDB and lists all indexes on each collection
 * to verify that performance indexes have been created successfully.
 */

require('dotenv').config();
const mongoose = require('mongoose');

// Import models to register schemas
require('../lib/models');

async function verifyIndexes() {
  try {
    // Connect to MongoDB
    console.log('Connecting to MongoDB...');
    const uri = process.env.DB_CONNECTION_STRING || "mongodb://127.0.0.1:27017/easy_app";
    await mongoose.connect(uri);
    console.log('✅ Connected to MongoDB\n');

    // Get all model names
    const modelNames = mongoose.modelNames();
    
    console.log('📊 Database Indexes Report');
    console.log('='.repeat(60));
    
    for (const modelName of modelNames) {
      const model = mongoose.model(modelName);
      const collection = model.collection;
      
      console.log(`\n📦 Collection: ${collection.collectionName}`);
      console.log('-'.repeat(60));
      
      // Get indexes
      const indexes = await collection.listIndexes().toArray();
      
      if (indexes.length === 0) {
        console.log('  ⚠️  No indexes found');
      } else {
        indexes.forEach((index, i) => {
          console.log(`  ${i + 1}. ${index.name}`);
          console.log(`     Keys: ${JSON.stringify(index.key)}`);
          if (index.unique) console.log(`     Unique: true`);
          if (index.sparse) console.log(`     Sparse: true`);
          if (index['2dsphereIndexVersion']) console.log(`     Type: Geospatial (2dsphere)`);
        });
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ Index verification complete\n');
    
  } catch (error) {
    console.error('❌ Error verifying indexes:', error);
  } finally {
    await mongoose.connection.close();
    console.log('MongoDB connection closed');
  }
}

// Run verification
verifyIndexes();
