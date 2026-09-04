const Joi = require("joi");

// ========================================
// INPUT VALIDATION MIDDLEWARE
// ========================================

// Helper function to validate request body
const validate = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body, {
      abortEarly: false, // Return all errors
      stripUnknown: true, // Remove unknown fields
    });

    if (error) {
      const errors = error.details.map((detail) => ({
        field: detail.path.join("."),
        message: detail.message,
      }));

      return res.status(400).json({
        error: "Validation failed",
        details: errors,
      });
    }

    next();
  };
};

// ========================================
// VALIDATION SCHEMAS
// ========================================

// Order Creation
const createOrderSchema = Joi.object({
  items: Joi.array()
    .items(
      Joi.object({
        product_id: Joi.string().required(),
        quantity: Joi.number().integer().min(1).max(100).required(),
        price: Joi.number().min(0).optional(), // Optional, will be fetched from product
        name: Joi.string().optional(),
        seller_id: Joi.string().optional(),
      })
    )
    .min(1)
    .required(),

  client_id: Joi.string().optional(), // Optional, can be extracted from JWT or generated for guest
  seller_id: Joi.string().optional(),

  delivery_address_id: Joi.string().optional(),
  delivery_address: Joi.object({
    id: Joi.alternatives().try(Joi.string(), Joi.number()).optional(),
    label: Joi.string().allow(null, "").optional(),
    full_address: Joi.string().max(500).allow(null, "").optional(),
    address: Joi.string().max(500).allow(null, "").optional(),
    street: Joi.string().max(200).allow(null, "").optional(),
    city: Joi.string().max(100).allow(null, "").optional(),
    state: Joi.string().max(100).allow(null, "").optional(),
    zip: Joi.string().max(20).allow(null, "").optional(),
    pincode: Joi.string().max(20).allow(null, "").optional(),
    postal_code: Joi.string().max(20).allow(null, "").optional(),
    country: Joi.string().max(100).allow(null, "").optional(),
    recipient_name: Joi.string().max(100).allow(null, "").optional(),
    recipient_phone: Joi.string().max(20).allow(null, "").optional(),
    landmark: Joi.string().max(200).allow(null, "").optional(),
    location: Joi.object({
      lat: Joi.number().min(-90).max(90).allow(null, "").optional(),
      lng: Joi.number().min(-180).max(180).allow(null, "").optional(),
    }).optional(),
    latitude: Joi.number().min(-90).max(90).allow(null, "").optional(),
    longitude: Joi.number().min(-180).max(180).allow(null, "").optional(),
    lat: Joi.number().min(-90).max(90).allow(null, "").optional(),
    lng: Joi.number().min(-180).max(180).allow(null, "").optional(),
    place_id: Joi.string().allow(null, "").optional(),
    is_default: Joi.boolean().optional(),
    created_at: Joi.string().allow(null, "").optional(),
    updated_at: Joi.string().allow(null, "").optional(),
  }).unknown(true).optional(),

  note: Joi.string().max(500).allow("").optional(),

  // App is COD/cash ONLY - Controller enforces COD regardless (line 731 in ordersController.js)
  payment_method: Joi.string().valid("cod", "cash").optional(),
  method: Joi.string().valid("cod", "cash").optional(), // Alias for payment_method

  total: Joi.number().min(0).optional(),
  subtotal: Joi.number().min(0).optional(),
  delivery_fee: Joi.number().min(0).optional(),

  coupon_code: Joi.string().max(50).optional(),
  coupon: Joi.string().max(50).optional(), // Alias for coupon_code
});

// User Signup
const signupSchema = Joi.object({
  email: Joi.string().email().max(255).optional(),
  phone: Joi.string()
    .pattern(/^\+?[1-9]\d{1,14}$/)
    .optional(), // E.164 format
  password: Joi.string().min(6).max(128).optional(),
  name: Joi.string().max(100).optional(),
  role: Joi.string()
    .valid("client", "seller", "admin", "delivery_agent")
    .optional(),
  uid: Joi.string().max(128).optional(),
  fcm_token: Joi.string().max(500).optional(),
}).or("email", "phone"); // At least one required

// User Login
const loginSchema = Joi.object({
  email: Joi.string().email().max(255).optional(),
  phone: Joi.string()
    .pattern(/^\+?[1-9]\d{1,14}$/)
    .optional(),
  password: Joi.string().min(6).max(128).required(),
  role: Joi.string()
    .valid("client", "seller", "admin", "delivery_agent")
    .optional(),
}).or("email", "phone");

// Product Creation/Update
const productSchema = Joi.object({
  name: Joi.string().min(1).max(200).required(),
  description: Joi.string().max(2000).allow("").optional(),
  price: Joi.number().min(0).max(1000000).required(),
  category: Joi.string().max(100).optional(),
  image: Joi.string().uri().max(500).optional(),
  images: Joi.array().items(Joi.string().uri().max(500)).max(10).optional(),
  stock_quantity: Joi.number().integer().min(0).optional(),
  seller_id: Joi.string().optional(),
  available: Joi.boolean().optional(),
  unit: Joi.string().max(50).optional(),
  discount_percentage: Joi.number().min(0).max(100).optional(),
});

// Cart Operations
const addToCartSchema = Joi.object({
  client_id: Joi.string().required(),
  product_id: Joi.string().required(),
  quantity: Joi.number().integer().min(1).max(100).required(),
});

// Address Creation
const addressSchema = Joi.object({
  client_id: Joi.string().required(),
  label: Joi.string().max(50).optional(), // "Home", "Work", etc.
  street: Joi.string().max(200).required(),
  city: Joi.string().max(100).required(),
  state: Joi.string().max(100).required(),
  postal_code: Joi.string().max(20).required(),
  country: Joi.string().max(100).optional(),
  lat: Joi.number().min(-90).max(90).allow(null, "").optional(),
  lng: Joi.number().min(-180).max(180).allow(null, "").optional(),
  is_default: Joi.boolean().optional(),
});

// Delivery Agent Location Update
const locationUpdateSchema = Joi.object({
  lat: Joi.number().min(-90).max(90).required(),
  lng: Joi.number().min(-180).max(180).required(),
  heading: Joi.number().min(0).max(360).optional(),
  speed: Joi.number().min(0).optional(),
});

// Review/Rating
const reviewSchema = Joi.object({
  product_id: Joi.string().required(),
  order_id: Joi.string().required(),
  rating: Joi.number().integer().min(1).max(5).required(),
  comment: Joi.string().max(500).allow("").optional(),
  images: Joi.array().items(Joi.string().uri().max(500)).max(5).optional(),
});

// FCM Token
const fcmTokenSchema = Joi.object({
  user_id: Joi.string().required(),
  token: Joi.string().min(50).max(500).required(),
  device_type: Joi.string().valid("android", "ios", "web").optional(),
});

// Order Status Update
const orderStatusSchema = Joi.object({
  status: Joi.string()
    .valid(
      "pending",
      "confirmed",
      "preparing",
      "ready",
      "assigned",
      "picked_up",
      "in_transit",
      "delivered",
      "cancelled",
      "rejected"
    )
    .required(),
  reason: Joi.string().max(500).optional(),
  note: Joi.string().max(500).optional(),
});

// Coupon Application
const applyCouponSchema = Joi.object({
  code: Joi.string().max(50).required(),
  order_total: Joi.number().min(0).required(),
  client_id: Joi.string().optional(),
});

// ========================================
// SANITIZATION HELPERS
// ========================================

// Remove potentially dangerous characters
function sanitizeString(str) {
  if (typeof str !== "string") return str;

  // Remove MongoDB operators
  str = str.replace(/\$\w+/g, "");

  // Remove script tags
  str = str.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");

  // Remove HTML tags (optional, comment out if you need HTML)
  // str = str.replace(/<[^>]*>/g, '');

  return str.trim();
}

// Recursively sanitize object
function sanitizeObject(obj) {
  if (typeof obj !== "object" || obj === null) {
    return obj;
  }

  const sanitized = Array.isArray(obj) ? [] : {};

  for (const key in obj) {
    // Skip MongoDB operators in keys
    if (key.startsWith("$")) continue;

    if (typeof obj[key] === "string") {
      sanitized[key] = sanitizeString(obj[key]);
    } else if (typeof obj[key] === "object") {
      sanitized[key] = sanitizeObject(obj[key]);
    } else {
      sanitized[key] = obj[key];
    }
  }

  return sanitized;
}

// Sanitization middleware
const sanitize = (req, res, next) => {
  if (req.body) {
    req.body = sanitizeObject(req.body);
  }
  if (req.query) {
    req.query = sanitizeObject(req.query);
  }
  if (req.params) {
    req.params = sanitizeObject(req.params);
  }
  next();
};

// ========================================
// EXPORTS
// ========================================

module.exports = {
  validate,
  sanitize,

  // Schemas
  createOrderSchema,
  signupSchema,
  loginSchema,
  productSchema,
  addToCartSchema,
  addressSchema,
  locationUpdateSchema,
  reviewSchema,
  fcmTokenSchema,
  orderStatusSchema,
  applyCouponSchema,

  // Helpers
  sanitizeString,
  sanitizeObject,
};
