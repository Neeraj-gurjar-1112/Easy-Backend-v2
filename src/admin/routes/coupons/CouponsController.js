const { Order, PlatformSettings } = require("@models");

class CouponsController {
  // GET /api/admin/coupons - List all coupons with usage statistics
  async list(req, res) {
    try {
      const settings = await PlatformSettings.findOne();
      if (!settings) {
        return res.json({ success: true, coupons: [] });
      }

      // Return coupons with calculated statistics
      const coupons = settings.coupons.map((coupon) => {
        return {
          code: coupon.code,
          percent: coupon.percent,
          active: coupon.active,
          minSubtotal: coupon.minSubtotal,
          categories: coupon.categories,
          validFrom: coupon.validFrom,
          validTo: coupon.validTo,
          usage_count: coupon.usage_count || 0,
          usage_limit: coupon.usage_limit,
          max_uses_per_user: coupon.max_uses_per_user,
          unique_users: coupon.used_by ? coupon.used_by.length : 0,
          created_at: coupon.created_at,
          updated_at: coupon.updated_at,
        };
      });

      res.json({ success: true, coupons });
    } catch (error) {
      console.error("Error fetching coupons:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch coupons",
        error: error.message,
      });
    }
  }

  // POST /api/admin/coupons - Create a new coupon
  async create(req, res) {
    try {
      const {
        code,
        percent,
        active = true,
        minSubtotal = 0,
        categories = [],
        validFrom,
        validTo,
        usage_limit = null,
        max_uses_per_user = 1,
      } = req.body;

      // Validate required fields
      if (!code || percent === undefined) {
        return res.status(400).json({
          success: false,
          message: "Code and percent are required",
        });
      }

      // Validate percent range
      if (percent < 0 || percent > 100) {
        return res.status(400).json({
          success: false,
          message: "Percent must be between 0 and 100",
        });
      }

      let settings = await PlatformSettings.findOne();
      if (!settings) {
        settings = new PlatformSettings();
      }

      // Check if coupon code already exists
      const existingCoupon = settings.coupons.find((c) => c.code === code);
      if (existingCoupon) {
        return res.status(400).json({
          success: false,
          message: "Coupon code already exists",
        });
      }

      // Create new coupon
      const newCoupon = {
        code: code.toUpperCase(),
        percent,
        active,
        minSubtotal,
        categories,
        validFrom: validFrom ? new Date(validFrom) : null,
        validTo: validTo ? new Date(validTo) : null,
        usage_count: 0,
        usage_limit,
        max_uses_per_user,
        used_by: [],
        created_at: new Date(),
        updated_at: new Date(),
      };

      settings.coupons.push(newCoupon);
      settings.updated_at = new Date();
      await settings.save();

      console.log(`[ADMIN] Coupon created: ${code} by ${req.admin?.email}`);

      res.status(201).json({
        success: true,
        message: "Coupon created successfully",
        coupon: newCoupon,
      });
    } catch (error) {
      console.error("Error creating coupon:", error);
      res.status(500).json({
        success: false,
        message: "Failed to create coupon",
        error: error.message,
      });
    }
  }

  // PUT /api/admin/coupons/:code - Update a coupon
  async update(req, res) {
    try {
      const { code } = req.params;
      const updates = req.body;

      const settings = await PlatformSettings.findOne();
      if (!settings) {
        return res.status(404).json({
          success: false,
          message: "Settings not found",
        });
      }

      const couponIndex = settings.coupons.findIndex(
        (c) => c.code === code.toUpperCase(),
      );
      if (couponIndex === -1) {
        return res.status(404).json({
          success: false,
          message: "Coupon not found",
        });
      }

      const coupon = settings.coupons[couponIndex];

      // Update allowed fields
      if (updates.percent !== undefined) {
        if (updates.percent < 0 || updates.percent > 100) {
          return res.status(400).json({
            success: false,
            message: "Percent must be between 0 and 100",
          });
        }
        coupon.percent = updates.percent;
      }
      if (updates.active !== undefined) coupon.active = updates.active;
      if (updates.minSubtotal !== undefined)
        coupon.minSubtotal = updates.minSubtotal;
      if (updates.categories !== undefined)
        coupon.categories = updates.categories;
      if (updates.validFrom !== undefined)
        coupon.validFrom = updates.validFrom ? new Date(updates.validFrom) : null;
      if (updates.validTo !== undefined)
        coupon.validTo = updates.validTo ? new Date(updates.validTo) : null;
      if (updates.usage_limit !== undefined)
        coupon.usage_limit = updates.usage_limit;
      if (updates.max_uses_per_user !== undefined)
        coupon.max_uses_per_user = updates.max_uses_per_user;

      coupon.updated_at = new Date();
      settings.coupons[couponIndex] = coupon;
      settings.updated_at = new Date();

      await settings.save();

      console.log(`[ADMIN] Coupon updated: ${code} by ${req.admin?.email}`);

      res.json({
        success: true,
        message: "Coupon updated successfully",
        coupon,
      });
    } catch (error) {
      console.error("Error updating coupon:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update coupon",
        error: error.message,
      });
    }
  }

  // DELETE /api/admin/coupons/:code - Delete a coupon
  async remove(req, res) {
    try {
      const { code } = req.params;

      const settings = await PlatformSettings.findOne();
      if (!settings) {
        return res.status(404).json({
          success: false,
          message: "Settings not found",
        });
      }

      const couponIndex = settings.coupons.findIndex(
        (c) => c.code === code.toUpperCase(),
      );
      if (couponIndex === -1) {
        return res.status(404).json({
          success: false,
          message: "Coupon not found",
        });
      }

      settings.coupons.splice(couponIndex, 1);
      settings.updated_at = new Date();
      await settings.save();

      console.log(`[ADMIN] Coupon deleted: ${code} by ${req.admin?.email}`);

      res.json({
        success: true,
        message: "Coupon deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting coupon:", error);
      res.status(500).json({
        success: false,
        message: "Failed to delete coupon",
        error: error.message,
      });
    }
  }

  // GET /api/admin/coupons/:code/usage - Get detailed usage statistics for a coupon
  async usage(req, res) {
    try {
      const { code } = req.params;

      const settings = await PlatformSettings.findOne();
      if (!settings) {
        return res.status(404).json({
          success: false,
          message: "Settings not found",
        });
      }

      const coupon = settings.coupons.find((c) => c.code === code.toUpperCase());
      if (!coupon) {
        return res.status(404).json({
          success: false,
          message: "Coupon not found",
        });
      }

      // Get orders that used this coupon
      const orders = await Order.find({ coupon_code: code.toUpperCase() })
        .select("client_id total_amount applied_discount_amount created_at")
        .sort("-created_at")
        .limit(100);

      res.json({
        success: true,
        coupon: {
          code: coupon.code,
          usage_count: coupon.usage_count || 0,
          usage_limit: coupon.usage_limit,
          unique_users: coupon.used_by ? coupon.used_by.length : 0,
          used_by: coupon.used_by || [],
        },
        recent_orders: orders,
        total_discount_given: orders.reduce(
          (sum, o) => sum + (o.applied_discount_amount || 0),
          0,
        ),
      });
    } catch (error) {
      console.error("Error fetching coupon usage:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch coupon usage",
        error: error.message,
      });
    }
  }
}

module.exports = new CouponsController();
