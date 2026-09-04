/**
 * Uploads controller (mount: /api/uploads). Handlers copied verbatim from the
 * legacy routes/uploads.js. Files are written to <repo root>/uploads (ROOT from
 * @lib/config/env replaces the legacy path.join(__dirname, "../uploads")).
 * Legacy GridFS ObjectId ids are still served from the "uploads" bucket.
 */
const { GridFSBucket, ObjectId } = require("mongodb");
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const { optimizeImage } = require("@middleware/imageOptimization");
const { ROOT } = require("@lib/config/env");

class UploadsController {
  // POST / (multipart/form-data; field: file) - runs after multer upload.single("file")
  async upload(req, res) {
    try {
      if (!req.file) return res.status(400).json({ error: "file is required" });
      const allowed = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
      if (!allowed.includes(req.file.mimetype)) {
        return res.status(415).json({ error: "unsupported media type" });
      }

      // Optimize image before uploading
      let imageBuffer = req.file.buffer;
      const originalSize = imageBuffer.length;
      let isOptimized = false;
      try {
        imageBuffer = await optimizeImage(imageBuffer, {
          width: 1200,
          height: 1200,
          quality: 90,
          format: "jpeg",
        });
        isOptimized = true;
        const optimizedSize = imageBuffer.length;
        const savedPercent = ((1 - optimizedSize / originalSize) * 100).toFixed(
          1
        );
        console.log(
          `📸 Image optimized: ${(originalSize / 1024).toFixed(2)}KB → ${(
            optimizedSize / 1024
          ).toFixed(2)}KB (saved ${savedPercent}%)`
        );
      } catch (err) {
        console.error("Image optimization failed, using original:", err);
        // Continue with original if optimization fails
      }

      const filename = `${Date.now()}_${(
        req.file.originalname || "image"
      ).replace(/[^a-zA-Z0-9_.-]/g, "_")}`;
      const contentType = req.file.mimetype || "application/octet-stream";

      const uploadsDir = path.join(ROOT, "uploads");
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      const filepath = path.join(uploadsDir, filename);

      fs.writeFile(filepath, imageBuffer, (err) => {
        if (err) {
          console.error("File write error", err);
          return res.status(500).json({ error: "failed to upload" });
        }

        const endpointPath = `/api/uploads/${filename}`;
        // Use VPS URL
        const url = `${req.protocol}://${req.get("host")}${endpointPath}`;

        res.json({
          ok: true,
          id: filename,
          filename,
          contentType,
          url,
          optimized: isOptimized,
        });
      });
    } catch (e) {
      console.error("upload route error", e);
      res.status(500).json({ error: "upload failed" });
    }
  }

  // GET /:id - streams the image back
  async get(req, res) {
    try {
      const idParam = req.params.id;

      // Check if it might be an old GridFS ObjectId (24 char hex)
      if (/^[0-9a-fA-F]{24}$/.test(idParam)) {
        try {
          const id = new ObjectId(idParam);
          const db = mongoose.connection.db;
          const bucket = new GridFSBucket(db, { bucketName: "uploads" });

          // Try to see if it exists
          const files = await bucket.find({ _id: id }).toArray();
          if (files.length > 0) {
            const dl = bucket.openDownloadStream(id);

            dl.on("file", (file) => {
              // Set content type
              if (file?.contentType) {
                res.setHeader("Content-Type", file.contentType);
              }

              // CDN caching headers (1 year)
              res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

              // CORS headers for CDN access
              res.setHeader("Access-Control-Allow-Origin", "*");
              res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
              res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
              res.setHeader("Access-Control-Max-Age", "86400");

              // Additional CDN optimization headers
              res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
              res.setHeader("Timing-Allow-Origin", "*");

              // Cloudflare optimization hints
              if (process.env.CDN_PROVIDER === "cloudflare") {
                res.setHeader("CDN-Cache-Control", "max-age=31536000");
                res.setHeader("CF-Cache-Tag", `image-${id}`);
              }
            });

            dl.on("error", () => res.status(404).json({ error: "not found" }));
            return dl.pipe(res);
          }
        } catch (err) {
          console.error("GridFS fetch error:", err);
        }
      }

      // Otherwise serve from local VPS uploads directory
      const filepath = path.join(ROOT, "uploads", idParam);
      if (fs.existsSync(filepath)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
        res.setHeader("Access-Control-Max-Age", "86400");

        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
        res.setHeader("Timing-Allow-Origin", "*");

        return res.sendFile(filepath, (err) => {
          if (err && !res.headersSent) {
            res.status(404).json({ error: "not found" });
          }
        });
      }

      return res.status(404).json({ error: "not found" });
    } catch (e) {
      res.status(400).json({ error: "invalid id" });
    }
  }

  // OPTIONS /:id - Handle CORS preflight requests
  preflight(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
    res.setHeader("Access-Control-Max-Age", "86400");
    res.status(204).send();
  }
}

module.exports = new UploadsController();
