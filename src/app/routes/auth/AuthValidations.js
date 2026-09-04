/**
 * Joi schemas used by the auth routes. The legacy routes/auth.js pulled these
 * straight from middleware/validation; they stay defined there (shared with
 * other modules) and are re-exported here so AuthRoutes reads from one place.
 */
const { signupSchema, loginSchema } = require("@middleware/validation");

module.exports = { signupSchema, loginSchema };
