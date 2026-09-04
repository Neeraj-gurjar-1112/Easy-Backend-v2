const sharp = require("sharp");
const path = require("path");
const fs = require("fs").promises;

/**
 * Image Optimization Middleware using Sharp
 * Automatically optimizes uploaded images
 */

const IMAGE_QUALITY = {
  thumbnail: { width: 150, height: 150, quality: 80 },
  small: { width: 300, height: 300, quality: 85 },
  medium: { width: 600, height: 600, quality: 90 },
  large: { width: 1200, height: 1200, quality: 90 },
};

/**
 * Optimize a single image file
 * @param {Buffer} imageBuffer - Original image buffer
 * @param {Object} options - Optimization options
 * @returns {Promise<Buffer>} - Optimized image buffer
 */
async function optimizeImage(imageBuffer, options = {}) {
  const {
    width = 1200,
    height = 1200,
    quality = 90,
    format = "jpeg",
    fit = "inside", // 'cover', 'contain', 'fill', 'inside', 'outside'
  } = options;

  try {
    let sharpInstance = sharp(imageBuffer);

    // Resize image
    sharpInstance = sharpInstance.resize(width, height, {
      fit,
      withoutEnlargement: true, // Don't upscale small images
    });

    // Convert and optimize based on format
    switch (format.toLowerCase()) {
      case "jpeg":
      case "jpg":
        sharpInstance = sharpInstance.jpeg({
          quality,
          progressive: true,
          mozjpeg: true, // Better compression
        });
        break;
      case "png":
        sharpInstance = sharpInstance.png({
          quality,
          compressionLevel: 9,
          progressive: true,
        });
        break;
      case "webp":
        sharpInstance = sharpInstance.webp({
          quality,
          effort: 6, // 0-6, higher = better compression but slower
        });
        break;
      default:
        // Default to JPEG
        sharpInstance = sharpInstance.jpeg({ quality, progressive: true });
    }

    // Remove metadata to reduce file size
    sharpInstance = sharpInstance.rotate(); // Auto-rotate based on EXIF

    return await sharpInstance.toBuffer();
  } catch (error) {
    console.error("Image optimization error:", error);
    throw new Error("Failed to optimize image");
  }
}

/**
 * Generate multiple sizes (thumbnail, small, medium, large)
 * @param {Buffer} imageBuffer - Original image buffer
 * @param {string} format - Output format (jpeg, png, webp)
 * @returns {Promise<Object>} - Object with different sizes
 */
async function generateMultipleSizes(imageBuffer, format = "jpeg") {
  try {
    const sizes = {};

    for (const [sizeName, options] of Object.entries(IMAGE_QUALITY)) {
      sizes[sizeName] = await optimizeImage(imageBuffer, {
        ...options,
        format,
      });
    }

    return sizes;
  } catch (error) {
    console.error("Error generating multiple sizes:", error);
    throw error;
  }
}

/**
 * Express middleware for automatic image optimization
 * Use after multer upload middleware
 */
function autoOptimizeMiddleware(options = {}) {
  return async (req, res, next) => {
    try {
      // Check if files were uploaded
      if (!req.file && !req.files) {
        return next();
      }

      const files = req.files || [req.file];
      const optimizedFiles = [];

      for (const file of files) {
        // Only process image files
        if (!file.mimetype.startsWith("image/")) {
          optimizedFiles.push(file);
          continue;
        }

        // Read original file
        const originalBuffer = await fs.readFile(file.path);

        // Optimize image
        const optimizedBuffer = await optimizeImage(originalBuffer, {
          width: options.width || 1200,
          height: options.height || 1200,
          quality: options.quality || 90,
          format: options.format || "jpeg",
        });

        // Save optimized image (overwrite original)
        await fs.writeFile(file.path, optimizedBuffer);

        // Update file size in metadata
        const stats = await fs.stat(file.path);
        file.size = stats.size;

        optimizedFiles.push(file);

        console.log(
          `✅ Image optimized: ${file.originalname} (${(
            originalBuffer.length / 1024
          ).toFixed(2)}KB → ${(stats.size / 1024).toFixed(2)}KB)`
        );
      }

      // Replace files with optimized versions
      if (req.files) {
        req.files = optimizedFiles;
      } else {
        req.file = optimizedFiles[0];
      }

      next();
    } catch (error) {
      console.error("Auto-optimize middleware error:", error);
      // Don't block request on optimization failure
      next();
    }
  };
}

/**
 * Validate image dimensions and file size
 */
function validateImage(options = {}) {
  const {
    maxWidth = 5000,
    maxHeight = 5000,
    maxFileSize = 10 * 1024 * 1024, // 10MB
    minWidth = 100,
    minHeight = 100,
  } = options;

  return async (req, res, next) => {
    try {
      if (!req.file && !req.files) {
        return next();
      }

      const files = req.files || [req.file];

      for (const file of files) {
        if (!file.mimetype.startsWith("image/")) {
          continue;
        }

        // Check file size
        if (file.size > maxFileSize) {
          return res.status(400).json({
            error: `Image too large. Maximum size: ${
              maxFileSize / 1024 / 1024
            }MB`,
          });
        }

        // Check image dimensions
        const metadata = await sharp(file.path).metadata();

        if (metadata.width > maxWidth || metadata.height > maxHeight) {
          return res.status(400).json({
            error: `Image dimensions too large. Maximum: ${maxWidth}x${maxHeight}px`,
          });
        }

        if (metadata.width < minWidth || metadata.height < minHeight) {
          return res.status(400).json({
            error: `Image dimensions too small. Minimum: ${minWidth}x${minHeight}px`,
          });
        }
      }

      next();
    } catch (error) {
      console.error("Image validation error:", error);
      return res.status(400).json({ error: "Invalid image file" });
    }
  };
}

/**
 * Convert image to WebP format (better compression)
 */
async function convertToWebP(imageBuffer, quality = 90) {
  return await sharp(imageBuffer).webp({ quality, effort: 6 }).toBuffer();
}

module.exports = {
  optimizeImage,
  generateMultipleSizes,
  autoOptimizeMiddleware,
  validateImage,
  convertToWebP,
  IMAGE_QUALITY,
};
