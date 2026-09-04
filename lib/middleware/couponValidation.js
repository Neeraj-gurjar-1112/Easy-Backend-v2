const logger = require("@util/logger");
const { PlatformSettings } = require("@models");

/**
 * Validate coupon code and calculate discount
 * This middleware checks:
 * - Coupon exists and is active
 * - Date validity (validFrom/validTo)
 * - Usage limits (total and per-user)
 * - Minimum subtotal requirements
 * - Category restrictions
 *
 * Usage: Add to order creation routes
 * The validated coupon and discount will be attached to req.couponData
 */
async function validateCoupon(req, res, next) {
  try {
    const { coupon_code, client_id, subtotal, category } = req.body;

    // If no coupon code provided, skip validation
    if (!coupon_code) {
      req.couponData = {
        valid: false,
        discount: 0,
        coupon: null,
      };
      return next();
    }

    // Get platform settings with coupons
    const settings = await PlatformSettings.findOne();
    if (!settings || !settings.coupons || settings.coupons.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid coupon code",
      });
    }

    // Find the coupon
    const coupon = settings.coupons.find(
      (c) => c.code === coupon_code.toUpperCase()
    );

    if (!coupon) {
      return res.status(400).json({
        success: false,
        message: "Invalid coupon code",
      });
    }

    // Check if coupon is active
    if (!coupon.active) {
      return res.status(400).json({
        success: false,
        message: "This coupon is no longer active",
      });
    }

    // Check date validity
    const now = new Date();
    if (coupon.validFrom && new Date(coupon.validFrom) > now) {
      return res.status(400).json({
        success: false,
        message: "This coupon is not yet valid",
      });
    }

    if (coupon.validTo && new Date(coupon.validTo) < now) {
      return res.status(400).json({
        success: false,
        message: "This coupon has expired",
      });
    }

    // Check total usage limit
    if (
      coupon.usage_limit !== null &&
      coupon.usage_limit !== undefined &&
      (coupon.usage_count || 0) >= coupon.usage_limit
    ) {
      return res.status(400).json({
        success: false,
        message: "This coupon has reached its usage limit",
      });
    }

    // Check per-user usage limit
    if (client_id) {
      const userUsage = coupon.used_by
        ? coupon.used_by.find((u) => u.client_id === client_id)
        : null;

      if (userUsage) {
        const maxUsesPerUser = coupon.max_uses_per_user || 1;
        if (userUsage.usage_count >= maxUsesPerUser) {
          return res.status(400).json({
            success: false,
            message:
              "You have already used this coupon the maximum number of times",
          });
        }
      }
    }

    // Check minimum subtotal
    if (subtotal && coupon.minSubtotal && subtotal < coupon.minSubtotal) {
      return res.status(400).json({
        success: false,
        message: `Minimum order amount of ₹${coupon.minSubtotal} required for this coupon`,
      });
    }

    // Check category restrictions
    if (
      category &&
      coupon.categories &&
      coupon.categories.length > 0 &&
      !coupon.categories.includes(category.toLowerCase())
    ) {
      return res.status(400).json({
        success: false,
        message: `This coupon is only valid for ${coupon.categories.join(
          ", "
        )} categories`,
      });
    }

    // Calculate discount
    const discount = subtotal ? (subtotal * coupon.percent) / 100 : 0;

    // Attach validated coupon data to request
    req.couponData = {
      valid: true,
      discount: Math.round(discount * 100) / 100, // Round to 2 decimal places
      coupon: {
        code: coupon.code,
        percent: coupon.percent,
      },
    };

    logger.info(
      `Coupon validated: ${coupon.code} for client ${client_id}, discount: ₹${discount}`
    );

    next();
  } catch (error) {
    logger.error("Error validating coupon:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to validate coupon",
      error: error.message,
    });
  }
}

/**
 * Update coupon usage after successful order creation
 * Call this function after an order is created with a coupon
 *
 * @param {string} couponCode - The coupon code used
 * @param {string} clientId - The client/user ID
 */
async function updateCouponUsage(couponCode, clientId) {
  try {
    if (!couponCode) return;

    const settings = await PlatformSettings.findOne();
    if (!settings || !settings.coupons) return;

    const coupon = settings.coupons.find(
      (c) => c.code === couponCode.toUpperCase()
    );
    if (!coupon) return;

    // Increment total usage count
    coupon.usage_count = (coupon.usage_count || 0) + 1;
    coupon.updated_at = new Date();

    // Update user-specific usage
    if (clientId) {
      if (!coupon.used_by) {
        coupon.used_by = [];
      }

      const userIndex = coupon.used_by.findIndex(
        (u) => u.client_id === clientId
      );

      if (userIndex >= 0) {
        // User has used this coupon before, increment their count
        coupon.used_by[userIndex].usage_count += 1;
        coupon.used_by[userIndex].last_used = new Date();
      } else {
        // First time user uses this coupon
        coupon.used_by.push({
          client_id: clientId,
          usage_count: 1,
          last_used: new Date(),
        });
      }
    }

    await settings.save();

    logger.info(
      `Coupon usage updated: ${couponCode}, total uses: ${coupon.usage_count}`
    );
  } catch (error) {
    logger.error("Error updating coupon usage:", error);
    // Don't throw error - this is a non-critical operation
  }
}

module.exports = {
  validateCoupon,
  updateCouponUsage,
};
