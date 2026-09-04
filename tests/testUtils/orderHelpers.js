/**
 * Test utility helpers for Orders
 */

/**
 * Generate a valid Order document matching the Order schema
 */
function generateMockOrderData(clientId, overrides = {}) {
  const defaults = {
    client_id: clientId,
    order_items: [
      {
        product_id: "507f1f77bcf86cd799439011",
        qty: 2, // Note: schema requires 'qty' not 'quantity'
        price_snapshot: 100,
        name_snapshot: "Test Product",
      },
    ],
    payment: {
      method: "COD", // Mongoose schema uses uppercase "COD"
      amount: 200,
      status: "pending",
    },
    delivery: {
      delivery_status: "pending",
      delivery_address: {
        full_address: "123 Test St, Test City, TS 12345", // Required field
        recipient_name: "Test User",
        recipient_phone: "+1234567890",
        location: {
          lat: 0,
          lng: 0,
        },
      },
      delivery_charge: 0,
    },
    status: "pending",
    created_at: new Date(),
  };

  return { ...defaults, ...overrides };
}

module.exports = {
  generateMockOrderData,
};
