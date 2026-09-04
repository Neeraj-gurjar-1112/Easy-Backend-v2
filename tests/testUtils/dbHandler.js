const mongoose = require("mongoose");
require("dotenv").config();

/**
 * Connect to MongoDB Atlas test database
 * Uses your existing MongoDB Atlas connection
 */
async function connectTestDB() {
  // Close existing connection if any
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }

  // Use your MongoDB Atlas connection with a separate test database
  const testDbUri = process.env.DB_CONNECTION_STRING.replace(
    /\/\?/,
    "/grocery_db_test?"
  );

  await mongoose.connect(testDbUri, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
  });

  console.log("✅ Connected to MongoDB Atlas test database");
}

/**
 * Drop test database and close connection
 */
async function closeTestDB() {
  try {
    if (mongoose.connection.readyState !== 0) {
      // Drop the entire test database (grocery_db_test)
      await mongoose.connection.dropDatabase();
      console.log("✅ Test database dropped");

      // Close connection
      await mongoose.connection.close(true);
      console.log("✅ Test database connection closed");
    }
  } catch (error) {
    console.error("Test DB cleanup error:", error.message);
  }
}

/**
 * Clear all collections in database
 */
async function clearTestDB() {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    try {
      await collections[key].deleteMany({}, { timeout: 5000 });
    } catch (error) {
      // Ignore individual collection errors
      console.warn(`Failed to clear collection ${key}:`, error.message);
    }
  }
}

/**
 * Setup test database (alias for connectTestDB)
 */
async function setupTestDB() {
  return await connectTestDB();
}

/**
 * Cleanup test database (alias for closeTestDB)
 */
async function cleanupTestDB() {
  return await closeTestDB();
}

module.exports = {
  connectTestDB,
  closeTestDB,
  clearTestDB,
  setupTestDB,
  cleanupTestDB,
};
