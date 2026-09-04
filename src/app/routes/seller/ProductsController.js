const { Product } = require("@models");
const mongoose = require("mongoose");
const { invalidateCache } = require("@middleware/cache");

class ProductsController {
  // Create product
  // POST /products
  async createProduct(req, res) {
    try {
      const {
        name,
        category,
        price,
        stock,
        image,
        description,
        status,
        mrp,
        discounted_price,
      } = req.body || {};

      // MRP is now required, price is auto-calculated from discounted_price or mrp
      if (!name || typeof price !== "number" || typeof mrp !== "number")
        return res
          .status(400)
          .json({ error: "name, price, and MRP are required" });

      const prod = await Product.create({
        seller_id: req.sellerId,
        name,
        category,
        price, // This should be discounted_price || mrp (calculated on frontend)
        mrp,
        discounted_price: discounted_price || null,
        // For restaurant items, stock isn't tracked; default to a generous number
        stock:
          typeof stock === "number"
            ? stock
            : (category || "").toString().toLowerCase().includes("restaurant") ||
                (category || "").toString().toLowerCase().includes("food")
              ? 100000
              : 0,
        image,
        description,
        status: status || "active",
      });
      // Invalidate products cache so user dashboard shows new product immediately
      await invalidateCache("cache:products:*");
      res.status(201).json(prod);
    } catch (e) {
      console.error("Error creating product", e);
      res.status(500).json({ error: "failed to create product" });
    }
  }

  // Update product (full replace fields provided)
  // PUT /products/:id
  async updateProduct(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.isValidObjectId(id))
        return res.status(400).json({ error: "invalid product id" });
      const update = { ...req.body };
      delete update.seller_id; // prevent seller takeover
      const prod = await Product.findOneAndUpdate(
        { _id: id, seller_id: req.sellerId },
        update,
        { new: true },
      );
      if (!prod) return res.status(404).json({ error: "product not found" });
      // Invalidate products cache so user dashboard shows updated prices
      await invalidateCache("cache:products:*");
      res.json(prod);
    } catch (e) {
      console.error("Error updating product", e);
      res.status(500).json({ error: "failed to update product" });
    }
  }

  // Patch product (partial update)
  // PATCH /products/:id
  async patchProduct(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.isValidObjectId(id))
        return res.status(400).json({ error: "invalid product id" });
      const update = { ...req.body };
      delete update.seller_id;
      const prod = await Product.findOneAndUpdate(
        { _id: id, seller_id: req.sellerId },
        { $set: update },
        { new: true },
      );
      if (!prod) return res.status(404).json({ error: "product not found" });
      // Invalidate products cache so user dashboard shows updated prices
      await invalidateCache("cache:products:*");
      res.json(prod);
    } catch (e) {
      console.error("Error patching product", e);
      res.status(500).json({ error: "failed to patch product" });
    }
  }

  // Delete (soft deactivate)
  // DELETE /products/:id
  async deleteProduct(req, res) {
    try {
      const { id } = req.params;
      const { permanent } = req.query; // Check if permanent delete requested

      if (!mongoose.isValidObjectId(id))
        return res.status(400).json({ error: "invalid product id" });

      // If permanent=true, actually delete the product
      if (permanent === "true") {
        const prod = await Product.findOneAndDelete({
          _id: id,
          seller_id: req.sellerId,
        });
        if (!prod) return res.status(404).json({ error: "product not found" });
        // Invalidate products cache
        await invalidateCache("cache:products:*");
        return res.json({ success: true, deleted: true, product: prod });
      }

      // Otherwise, soft delete (deactivate)
      const prod = await Product.findOneAndUpdate(
        { _id: id, seller_id: req.sellerId },
        { $set: { status: "inactive" } },
        { new: true },
      );
      if (!prod) return res.status(404).json({ error: "product not found" });
      // Invalidate products cache
      await invalidateCache("cache:products:*");
      res.json({ success: true, product: prod });
    } catch (e) {
      console.error("Error deleting product", e);
      res.status(500).json({ error: "failed to delete product" });
    }
  }

  // List seller products
  // GET /products
  async listProducts(req, res) {
    try {
      const prods = await Product.find({ seller_id: req.sellerId }).lean();
      res.json(prods);
    } catch (e) {
      console.error("Error listing products", e);
      res.status(500).json({ error: "failed to list products" });
    }
  }

  // ============================================================================
  // BULK CSV UPLOAD (For Restaurants)
  // ============================================================================

  // Upload products via CSV
  // POST /products/upload-csv
  async uploadCsv(req, res) {
    try {
      const { products } = req.body; // Array of product objects from CSV

      if (!Array.isArray(products) || products.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Products array is required",
        });
      }

      const results = {
        created: [],
        updated: [],
        failed: [],
      };

      for (let i = 0; i < products.length; i++) {
        try {
          const productData = products[i];
          const { name, price, stock, category, description, image } =
            productData;

          // Validation
          if (!name || !price || typeof price !== "number") {
            results.failed.push({
              row: i + 1,
              data: productData,
              reason: "Missing or invalid name/price",
            });
            continue;
          }

          // Check if product exists (by name for same seller)
          const existing = await Product.findOne({
            seller_id: req.sellerId,
            name: name.trim(),
          });

          if (existing) {
            // Update existing product
            existing.price = price;
            existing.stock = stock || 0;
            if (category) existing.category = category;
            if (description) existing.description = description;
            if (image) existing.image = image;

            await existing.save();

            results.updated.push({
              row: i + 1,
              product_id: existing._id,
              name: existing.name,
            });
          } else {
            // Create new product
            const newProduct = new Product({
              seller_id: req.sellerId,
              name: name.trim(),
              price,
              stock: stock || 0,
              category: category || "General",
              description: description || "",
              image: image || "",
              status: "active",
            });

            await newProduct.save();

            results.created.push({
              row: i + 1,
              product_id: newProduct._id,
              name: newProduct.name,
            });
          }
        } catch (err) {
          results.failed.push({
            row: i + 1,
            data: products[i],
            reason: err.message,
          });
        }
      }

      res.json({
        success: true,
        message: `Processed ${products.length} products: ${results.created.length} created, ${results.updated.length} updated, ${results.failed.length} failed`,
        data: results,
      });
    } catch (error) {
      console.error("CSV upload error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to process CSV upload",
        error: error.message,
      });
    }
  }

  // ============================================================================
  // INVENTORY MANAGEMENT (For Restaurants)
  // ============================================================================

  // Get inventory with low stock alerts
  // GET /inventory
  async getInventory(req, res) {
    try {
      const { lowStockOnly, threshold = 10 } = req.query;

      const query = { seller_id: req.sellerId };

      // Build products query
      const products = await Product.find(query)
        .select("name stock price category status image created_at updated_at")
        .sort({ stock: 1, name: 1 })
        .lean();

      // Filter low stock if requested
      let filteredProducts = products;
      if (lowStockOnly === "true") {
        filteredProducts = products.filter(
          (p) => (p.stock || 0) <= parseInt(threshold),
        );
      }

      // Calculate stats
      const stats = {
        totalProducts: products.length,
        lowStockCount: products.filter(
          (p) => (p.stock || 0) <= parseInt(threshold),
        ).length,
        outOfStockCount: products.filter((p) => (p.stock || 0) === 0).length,
        activeProducts: products.filter((p) => p.status === "active").length,
        inactiveProducts: products.filter((p) => p.status === "inactive").length,
      };

      res.json({
        success: true,
        data: {
          products: filteredProducts,
          stats,
          threshold: parseInt(threshold),
        },
      });
    } catch (error) {
      console.error("Get inventory error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch inventory",
        error: error.message,
      });
    }
  }

  // Update product stock
  // PUT /inventory/:productId/stock
  async updateStock(req, res) {
    try {
      const { productId } = req.params;
      const { stock } = req.body;

      if (typeof stock !== "number" || stock < 0) {
        return res.status(400).json({
          success: false,
          message: "Stock must be a non-negative number",
        });
      }

      const product = await Product.findOne({
        _id: productId,
        seller_id: req.sellerId,
      });

      if (!product) {
        return res.status(404).json({
          success: false,
          message: "Product not found",
        });
      }

      product.stock = stock;
      await product.save();

      res.json({
        success: true,
        message: "Stock updated successfully",
        data: {
          product_id: product._id,
          name: product.name,
          stock: product.stock,
        },
      });
    } catch (error) {
      console.error("Update stock error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update stock",
        error: error.message,
      });
    }
  }

  // Bulk update stock (for multiple products)
  // POST /inventory/bulk-update
  async bulkUpdateStock(req, res) {
    try {
      const { updates } = req.body; // [{product_id, stock}, ...]

      if (!Array.isArray(updates) || updates.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Updates array is required",
        });
      }

      const results = {
        success: [],
        failed: [],
      };

      for (const update of updates) {
        try {
          const { product_id, stock } = update;

          if (typeof stock !== "number" || stock < 0) {
            results.failed.push({
              product_id,
              reason: "Invalid stock value",
            });
            continue;
          }

          const product = await Product.findOneAndUpdate(
            { _id: product_id, seller_id: req.sellerId },
            { $set: { stock } },
            { new: true, select: "_id name stock" },
          );

          if (!product) {
            results.failed.push({
              product_id,
              reason: "Product not found",
            });
          } else {
            results.success.push({
              product_id: product._id,
              name: product.name,
              stock: product.stock,
            });
          }
        } catch (err) {
          results.failed.push({
            product_id: update.product_id,
            reason: err.message,
          });
        }
      }

      res.json({
        success: true,
        message: `Updated ${results.success.length} products, ${results.failed.length} failed`,
        data: results,
      });
    } catch (error) {
      console.error("Bulk update error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to bulk update stock",
        error: error.message,
      });
    }
  }
}

module.exports = new ProductsController();
