/**
 * Joi schemas for the admin delivery-agent endpoints (create / update / list query).
 * Rules mirror lib/models/schema/DeliveryAgent.js so the API rejects the same input the
 * model would, but with one clear message per field. The Next.js admin frontend copies these
 * limits 1:1 (AGENT_RULES in src/utils/constants.ts) so client and server validation never disagree:
 *   name 2–100 · email format · phone chars + ≥10 digits · vehicle enum · license ≤50 · password 8–72
 */
const Joi = require("joi");

const VEHICLE_TYPES = ["bike", "scooter", "bicycle", "car"];
const SORT_FIELDS = [
  "created_at",
  "name",
  "rating",
  "completed_orders",
  "assigned_orders",
];
const PRESENCE = ["online", "busy", "offline"];
const APPROVAL = ["approved", "pending"];

const LIMITS = {
  name: { min: 2, max: 100 },
  phoneMinDigits: 10,
  license: { max: 50 },
  password: { min: 8, max: 72 }, // 72 = bcrypt input limit
};

// Same rule as the schema: only phone characters, and at least 10 digits once stripped.
const phone = Joi.string()
  .trim()
  .pattern(/^[\d\s\-+()]+$/)
  .custom((value, helpers) =>
    value.replace(/\D/g, "").length >= LIMITS.phoneMinDigits
      ? value
      : helpers.error("any.invalid"),
  )
  .messages({
    "string.pattern.base":
      "Phone may only contain digits, spaces, +, -, ( and )",
    "any.invalid": `Phone must contain at least ${LIMITS.phoneMinDigits} digits`,
    "string.empty": "Phone is required",
    "any.required": "Phone is required",
  });

const workingHours = Joi.object({
  start: Joi.string()
    .pattern(/^([01]\d|2[0-3]):[0-5]\d$/)
    .messages({ "string.pattern.base": "Start time must be HH:MM" }),
  end: Joi.string()
    .pattern(/^([01]\d|2[0-3]):[0-5]\d$/)
    .messages({ "string.pattern.base": "End time must be HH:MM" }),
});

const password = Joi.string()
  .min(LIMITS.password.min)
  .max(LIMITS.password.max)
  .messages({
    "string.min": `Password must be at least ${LIMITS.password.min} characters long`,
    "string.max": `Password cannot exceed ${LIMITS.password.max} characters`,
    "string.empty": "Password is required",
    "any.required": "Password is required",
  });

const agentFields = {
  name: Joi.string()
    .trim()
    .min(LIMITS.name.min)
    .max(LIMITS.name.max)
    .messages({
      "string.min": `Name must be at least ${LIMITS.name.min} characters long`,
      "string.max": `Name cannot exceed ${LIMITS.name.max} characters`,
      "string.empty": "Name is required",
      "any.required": "Name is required",
    }),
  email: Joi.string()
    .trim()
    .lowercase()
    .email({ tlds: { allow: false } })
    .messages({
      "string.email": "Please provide a valid email address",
      "string.empty": "Email is required",
      "any.required": "Email is required",
    }),
  phone,
  vehicle_type: Joi.string()
    .valid(...VEHICLE_TYPES)
    .messages({
      "any.only": "Vehicle type must be bike, scooter, bicycle, or car",
    }),
  license_number: Joi.string()
    .trim()
    .max(LIMITS.license.max)
    .allow("", null)
    .messages({
      "string.max": `License number cannot exceed ${LIMITS.license.max} characters`,
    }),
  approved: Joi.boolean(),
  active: Joi.boolean(),
  available: Joi.boolean(),
  working_hours: workingHours,
};

// POST /api/admin/delivery-agents — an admin-created agent needs a password to sign in to the partner app
const createAgentSchema = Joi.object({
  ...agentFields,
  name: agentFields.name.required(),
  email: agentFields.email.required(),
  phone: agentFields.phone.required(),
  vehicle_type: agentFields.vehicle_type.default("bike"),
  password: password.required(),
  approved: agentFields.approved.default(false),
  active: agentFields.active.default(true),
  available: agentFields.available.default(true),
});

// PATCH /api/admin/delivery-agents/:id — every field optional, at least one present; blank password = keep current
const updateAgentSchema = Joi.object({
  ...agentFields,
  password: password.allow("", null),
})
  .min(1)
  .messages({ "object.min": "Send at least one field to update" });

// GET /api/admin/delivery-agents query string
const listAgentsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  q: Joi.string().trim().max(100).allow(""),
  vehicle_type: Joi.string().valid(...VEHICLE_TYPES, ""),
  approval: Joi.string().valid(...APPROVAL, ""),
  presence: Joi.string().valid(...PRESENCE, ""),
  sort: Joi.string()
    .valid(...SORT_FIELDS)
    .default("created_at"),
  order: Joi.string().valid("asc", "desc").default("desc"),
});

/**
 * Like @middleware/validation `validate`, but also writes the cleaned value back
 * (trim, lowercase, defaults applied, unknown keys dropped) so controllers can trust req[source].
 */
function validateAndClean(schema, source = "body") {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[source], {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });
    if (error) {
      const details = error.details.map((d) => ({
        field: d.path.join("."),
        message: d.message.replace(/"/g, ""),
      }));
      return res.status(400).json({ error: "Validation failed", details });
    }
    req[source] = value;
    next();
  };
}

module.exports = {
  VEHICLE_TYPES,
  SORT_FIELDS,
  LIMITS,
  createAgentSchema,
  updateAgentSchema,
  listAgentsQuerySchema,
  validateAndClean,
};
