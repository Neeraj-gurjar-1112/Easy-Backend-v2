const express = require("express");
const multer = require("multer");
const { getCDNUrl, setCacheHeaders } = require("@middleware/cdn");
const UploadsController = require("./UploadsController");

const router = express.Router();
const MAX_SIZE = Number(process.env.UPLOAD_MAX_BYTES || 5 * 1024 * 1024);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE },
});

// POST /api/uploads (multipart/form-data; field: file)
router.post("/", upload.single("file"), UploadsController.upload);

// GET /api/uploads/:id - streams the image back
router.get("/:id", setCacheHeaders("images"), UploadsController.get);

// OPTIONS /api/uploads/:id - Handle CORS preflight requests
router.options("/:id", UploadsController.preflight);

module.exports = router;
