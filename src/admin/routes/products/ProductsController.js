const mongoose = require("mongoose");
const { Seller, Product } = require("@models");
const { invalidateCache } = require("@middleware/cache");
const { parsePagination } = require("../../util/helpers");

class ProductsController {
  // ---------------- Products ----------------
  async list(req, res) {
    try {
      const { search, category, sellerId } = req.query;
      const filter = {};

      // Special handling for "restaurant" category - filter by seller business_type
      if (category && category.toLowerCase() === "restaurant") {
        // Find all sellers with business_type: "restaurant"
        const restaurantSellers = await Seller.find({
          business_type: "restaurant",
        })
          .select("_id")
          .lean();

        filter.seller_id = {
          $in: restaurantSellers.map((s) => s._id),
        };
      } else if (category) {
        // For other categories, filter by product category field
        filter.category = new RegExp(`^${category}$`, "i");
      }

      if (sellerId) filter.seller_id = sellerId;
      if (search) filter.name = { $regex: search, $options: "i" };

      const { page, limit, skip } = parsePagination(req);
      const [total, products] = await Promise.all([
        Product.countDocuments(filter),
        Product.find(filter)
          .sort({ created_at: -1 })
          .skip(skip)
          .limit(limit)
          .populate("seller_id", "business_name cuisine")
          // include description for richer admin/product UI contexts
          .select(
            "name category price stock status seller_id description mrp discounted_price image",
          )
          .lean(),
      ]);

      // Format products with seller info
      const rows = products.map((product) => ({
        ...product,
        seller_name: product.seller_id?.business_name || null,
        seller_cuisine: product.seller_id?.cuisine || null,
        seller_id: product.seller_id?._id || product.seller_id,
      }));

      res.json({ page, limit, total, rows });
    } catch (e) {
      console.error("admin products list error", e);
      res.status(500).json({ message: "Failed to list products" });
    }
  }

  // Distinct product categories for filters
  async categories(req, res) {
    try {
      const cats = await Product.distinct("category", {
        category: { $exists: true, $ne: null },
      });
      // Sort case-insensitively
      cats.sort((a, b) =>
        String(a).toLowerCase().localeCompare(String(b).toLowerCase()),
      );
      res.json({ categories: cats });
    } catch (e) {
      console.error("admin product categories error", e);
      res.status(500).json({ error: "failed to load categories" });
    }
  }

  // ---------------- PRODUCT CRUD ----------------
  async create(req, res) {
    try {
      const {
        name,
        description,
        price,
        seller_id,
        category,
        image_url,
        image,
        in_stock,
        published,
      } = req.body;

      if (!name || !price || !seller_id) {
        return res
          .status(400)
          .json({ error: "Name, price, and seller ID are required" });
      }

      const catStr = (category || "").toString().toLowerCase();
      const newProduct = new Product({
        name,
        description,
        price,
        seller_id: mongoose.isValidObjectId(seller_id) ? seller_id : undefined,
        category,
        image: image || image_url,
        stock:
          in_stock === false
            ? 0
            : typeof req.body.stock === "number"
              ? req.body.stock
              : catStr.includes("restaurant") || catStr.includes("food")
                ? 100000
                : 100,
        status: published === false ? "inactive" : "active",
      });

      await newProduct.save();
      // Invalidate products cache
      await invalidateCache("cache:products:*");
      res.status(201).json(newProduct);
    } catch (error) {
      console.error("create product error", error);
      res.status(500).json({ error: "Failed to create product" });
    }
  }

  // Allow both PUT and PATCH for flexibility
  async update(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ error: "Invalid product ID" });
      }

      const update = { ...req.body };
      if (update.published !== undefined) {
        update.status = update.published ? "active" : "inactive";
        delete update.published;
      }
      if (update.in_stock !== undefined) {
        // if explicit stock not given, toggle between 0 and keep/existing > 0
        if (update.in_stock === false) update.stock = 0;
        delete update.in_stock;
      }
      if (update.image_url && !update.image) {
        update.image = update.image_url;
        delete update.image_url;
      }

      const updatedProduct = await Product.findByIdAndUpdate(
        id,
        { $set: update },
        { new: true, runValidators: true },
      );

      if (!updatedProduct) {
        return res.status(404).json({ error: "Product not found" });
      }

      // Invalidate products cache
      await invalidateCache("cache:products:*");
      res.json(updatedProduct);
    } catch (error) {
      console.error("update product error", error);
      res.status(500).json({ error: "Failed to update product" });
    }
  }

  // Backward compatible PATCH update for products
  async patch(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ error: "Invalid product ID" });
      }

      const update = { ...req.body };
      if (update.published !== undefined) {
        update.status = update.published ? "active" : "inactive";
        delete update.published;
      }
      if (update.in_stock !== undefined) {
        if (update.in_stock === false) update.stock = 0;
        delete update.in_stock;
      }
      if (update.image_url && !update.image) {
        update.image = update.image_url;
        delete update.image_url;
      }

      const updatedProduct = await Product.findByIdAndUpdate(
        id,
        { $set: update },
        { new: true, runValidators: true },
      );
      if (!updatedProduct)
        return res.status(404).json({ error: "Product not found" });
      // Invalidate products cache
      await invalidateCache("cache:products:*");
      res.json(updatedProduct);
    } catch (error) {
      console.error("patch product error", error);
      res.status(500).json({ error: "Failed to update product" });
    }
  }

  // Activate product (set status to 'active')
  async activate(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ error: "Invalid product ID" });
      }

      const product = await Product.findByIdAndUpdate(
        id,
        { $set: { status: "active" } },
        { new: true, runValidators: true },
      );

      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }

      // Invalidate products cache
      await invalidateCache("cache:products:*");
      res.json({ success: true, product });
    } catch (error) {
      console.error("activate product error", error);
      res.status(500).json({ error: "Failed to activate product" });
    }
  }

  // Deactivate product (set status to 'inactive')
  async deactivate(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ error: "Invalid product ID" });
      }

      const product = await Product.findByIdAndUpdate(
        id,
        { $set: { status: "inactive" } },
        { new: true, runValidators: true },
      );

      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }

      // Invalidate products cache
      await invalidateCache("cache:products:*");
      res.json({ success: true, product });
    } catch (error) {
      console.error("deactivate product error", error);
      res.status(500).json({ error: "Failed to deactivate product" });
    }
  }

  async remove(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ error: "Invalid product ID" });
      }

      const deletedProduct = await Product.findByIdAndDelete(id);

      if (!deletedProduct) {
        return res.status(404).json({ error: "Product not found" });
      }

      // Invalidate products cache
      await invalidateCache("cache:products:*");
      res.json({ message: "Product deleted successfully" });
    } catch (error) {
      console.error("delete product error", error);
      res.status(500).json({ error: "Failed to delete product" });
    }
  }
}

module.exports = new ProductsController();
