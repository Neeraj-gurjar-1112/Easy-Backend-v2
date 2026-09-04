require("module-alias/register");
/**
 * Create Missing 2dsphere Index for DeliveryAgent
 * 
 * This script manually creates the geospatial index for delivery agents
 * if it wasn't created automatically by Mongoose.
 */

require('dotenv').config();
const mongoose = require('mongoose');

async function createGeoIndex() {
  try {
    // Connect to MongoDB
    console.log('Connecting to MongoDB...');
    const uri = process.env.DB_CONNECTION_STRING || "mongodb://127.0.0.1:27017/easy_app";
    await mongoose.connect(uri);
    console.log('✅ Connected to MongoDB\n');

    const db = mongoose.connection.db;
    const deliveryAgentsCollection = db.collection('deliveryagents');
    
    console.log('Creating 2dsphere index on current_location...');
    
    // Create the geospatial index
    await deliveryAgentsCollection.createIndex(
      { current_location: '2dsphere' },
      { name: 'current_location_2dsphere' }
    );
    
    console.log('✅ Geospatial index created successfully');
    
    // Verify
    const indexes = await deliveryAgentsCollection.listIndexes().toArray();
    const geoIndex = indexes.find(idx => idx.name === 'current_location_2dsphere');
    
    if (geoIndex) {
      console.log('\n✅ Verification successful!');
      console.log('Index details:', JSON.stringify(geoIndex, null, 2));
    } else {
      console.log('\n⚠️  Index not found after creation');
    }
    
  } catch (error) {
    if (error.code === 85 || error.codeName === 'IndexOptionsConflict') {
      console.log('✅ Index already exists');
    } else {
      console.error('❌ Error creating index:', error);
    }
  } finally {
    await mongoose.connection.close();
    console.log('\nMongoDB connection closed');
  }
}

createGeoIndex();
