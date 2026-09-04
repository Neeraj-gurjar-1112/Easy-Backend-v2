const jwt = require("jsonwebtoken");

/**
 * Mock data generators for testing
 * Counter to ensure absolutely unique values across all test runs
 */
let mockCounter = 0;

function generateMockAdmin() {
  mockCounter++;
  return {
    // Remove fixed _id to avoid duplicate key errors
    email: `admin${mockCounter}_${Date.now()}@test.com`,
    role: "superadmin",
  };
}

function generateMockSeller() {
  mockCounter++;
  const uniquePhone = "+1" + String(9000000000 + mockCounter).slice(-10);
  return {
    // Remove fixed _id to avoid duplicate key errors
    firebase_uid: "seller_firebase_uid_" + mockCounter + "_" + Date.now(),
    email: `seller${mockCounter}_${Date.now()}@test.com`,
    phone: uniquePhone,
    business_name: `Test Business ${mockCounter}`,
    business_type: "grocery",
    address: "123 Test St, Test City, TS 12345",
    location: {
      lat: 40.7128,
      lng: -74.006,
    },
    approved: true, // Add approved flag for sellers
  };
}

function generateMockClient() {
  mockCounter++;
  const uniqueId = Date.now() + Math.random() + mockCounter;
  const uniquePhone = "+1" + String(mockCounter).padStart(10, "0");
  const uniqueEmail = `client${mockCounter}_${Date.now()}@test.com`;

  return {
    // Remove fixed _id to avoid duplicate key errors
    firebase_uid: "test_firebase_uid_" + uniqueId,
    phone: uniquePhone, // Unique phone with counter
    email: uniqueEmail, // Unique email with counter
    name: "Test Client",
    first_name: "Test",
    last_name: "Client",
    otp_verified: true,
    profile_completed: true,
  };
}

function generateMockDeliveryAgent() {
  mockCounter++;
  const uniquePhone = "+1" + String(8000000000 + mockCounter).slice(-10);
  return {
    // Remove fixed _id to avoid duplicate key errors
    firebase_uid: "agent_firebase_uid_" + mockCounter + "_" + Date.now(),
    name: `Test Agent ${mockCounter}`,
    email: `agent${mockCounter}_${Date.now()}@test.com`,
    phone: uniquePhone,
    vehicle_type: "bike",
    available: true,
    current_location: {
      type: "Point",
      coordinates: [0, 0],
    },
  };
}

function generateMockProduct(sellerId) {
  return {
    // Remove fixed _id to avoid duplicate key errors
    seller_id: sellerId,
    name: "Test Product",
    description: "Test Description",
    category: "fruits",
    price: 100,
    stock: 50, // Changed from stock_quantity to match Product schema
    image: "https://example.com/image.jpg", // Changed from image_url to match schema
    status: "active", // Changed from available to match Product schema
  };
}

function generateMockOrder(clientId, sellerId) {
  return {
    // Remove fixed _id to avoid duplicate key errors
    client_id: clientId,
    items: [
      {
        // Product and seller IDs should come from actual created documents
        seller_id: sellerId,
        quantity: 2,
        price: 100,
      },
    ],
    total_amount: 200,
    payment_method: "cash",
    delivery_address: {
      street: "456 Test Ave",
      city: "Test City",
      state: "TS",
      zip: "12345",
      location: {
        type: "Point",
        coordinates: [0, 0],
      },
    },
    status: "pending",
  };
}

function generateJWT(userId, role) {
  const secret = process.env.JWT_SECRET || "test_secret_key";
  return jwt.sign({ userId, role }, secret, { expiresIn: "1h" });
}

module.exports = {
  generateMockAdmin,
  generateMockSeller,
  generateMockClient,
  generateMockDeliveryAgent,
  generateMockProduct,
  generateMockOrder,
  generateJWT,
};
