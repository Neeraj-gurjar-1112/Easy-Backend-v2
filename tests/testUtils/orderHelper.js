/**
 * Helper functions for creating valid test orders
 */

/**
 * Creates a valid order with all required fields for testing
 * @param {ObjectId} clientId - Client ObjectId
 * @param {ObjectId} sellerId - Seller ObjectId  
 * @param {ObjectId} productId - Product ObjectId
 * @param {string} status - Order status (default: 'pending')
 * @returns {Promise<Order>} Created order
 */
async function createValidTestOrder(Order, clientId, sellerId, productId, status = 'pending') {
  return await Order.create({
    client_id: clientId,
    order_items: [{
      product_id: productId,
      seller_id: sellerId,
      quantity: 2,
      qty: 2,
      price: 100,
      name: "Test Product"
    }],
    total: 200,
    status: status,
    delivery: {
      delivery_address: {
        full_address: `${Math.random().toString().substring(2, 8)} Test Street, Test City`,
        recipient_name: "Test Customer",
        recipient_phone: `987${Date.now()}${Math.floor(Math.random()*1000)}`
      },
      delivery_charge: 0
    },
    payment: {
      amount: 200,
      method: "COD",
      status: "pending"
    }
  });
}

/**
 * Generate unique phone number for testing
 * @returns {string} Unique phone number
 */
function generateUniquePhone() {
  return `987${Date.now()}${Math.floor(Math.random()*10000)}`;
}

/**
 * Generate unique email for testing
 * @param {string} prefix - Email prefix (default: 'test')
 * @returns {string} Unique email
 */
function generateUniqueEmail(prefix = 'test') {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random()*1000)}@test.com`;
}

module.exports = {
  createValidTestOrder,
  generateUniquePhone,
  generateUniqueEmail
};
