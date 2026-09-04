const mongoose = require("mongoose");
require("dotenv").config({ quiet: true });

/**
 * Test database handler.
 *
 * - When DB_CONNECTION_STRING is set (the legacy setup) the suite runs against that
 *   cluster using a separate `grocery_db_test` database, exactly as before.
 * - Otherwise an in-process MongoDB (mongodb-memory-server) is started so the suite
 *   runs with no external dependencies. The first run downloads the mongod binary.
 */
let memoryServer = null;

async function resolveTestUri() {
  if (process.env.DB_CONNECTION_STRING) {
    return process.env.DB_CONNECTION_STRING.replace(/\/\?/, "/grocery_db_test?");
  }
  const { MongoMemoryServer } = require("mongodb-memory-server");
  if (!memoryServer) {
    memoryServer = await MongoMemoryServer.create({ instance: { dbName: "grocery_db_test" } });
  }
  return memoryServer.getUri("grocery_db_test");
}

async function connectTestDB() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }

  const testDbUri = await resolveTestUri();

  await mongoose.connect(testDbUri, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
  });

  console.log(memoryServer ? "Connected to in-memory MongoDB test database" : "Connected to MongoDB Atlas test database");
}

/**
 * Drop test database and close connection
 */
async function closeTestDB() {
  try {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.dropDatabase();
      console.log("Test database dropped");
      await mongoose.connection.close(true);
      console.log("Test database connection closed");
    }
  } catch (error) {
    console.error("Test DB cleanup error:", error.message);
  }
  if (memoryServer) {
    try {
      await memoryServer.stop();
    } catch (error) {
      console.error("In-memory MongoDB stop error:", error.message);
    }
    memoryServer = null;
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
      console.warn(`Failed to clear collection ${key}:`, error.message);
    }
  }
}

async function setupTestDB() {
  return connectTestDB();
}

async function cleanupTestDB() {
  return closeTestDB();
}

module.exports = {
  connectTestDB,
  closeTestDB,
  clearTestDB,
  setupTestDB,
  cleanupTestDB,
};
