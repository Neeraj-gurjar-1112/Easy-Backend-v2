/**
 * Image Optimization Middleware Tests
 * Tests for image optimization, resizing, format conversion, and validation
 */

const sharp = require("sharp");
const fs = require("fs").promises;
const path = require("path");
const {
  optimizeImage,
  generateMultipleSizes,
  autoOptimizeMiddleware,
  validateImage,
  convertToWebP,
  IMAGE_QUALITY,
} = require("../../lib/middleware/imageOptimization");

// Mock sharp
jest.mock("sharp");

// Mock fs promises
jest.mock("fs", () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    stat: jest.fn(),
  },
}));

describe("Image Optimization Middleware Tests", () => {
  let mockSharpInstance;

  beforeEach(() => {
    // Create a chainable mock for sharp
    mockSharpInstance = {
      resize: jest.fn().mockReturnThis(),
      jpeg: jest.fn().mockReturnThis(),
      png: jest.fn().mockReturnThis(),
      webp: jest.fn().mockReturnThis(),
      rotate: jest.fn().mockReturnThis(),
      toBuffer: jest.fn().mockResolvedValue(Buffer.from("optimized")),
      metadata: jest.fn().mockResolvedValue({
        width: 1920,
        height: 1080,
        format: "jpeg",
      }),
    };

    sharp.mockReturnValue(mockSharpInstance);

    // Reset all mocks
    jest.clearAllMocks();
  });

  describe("optimizeImage()", () => {
    const testBuffer = Buffer.from("test-image");

    it("should optimize image with default options (JPEG)", async () => {
      const result = await optimizeImage(testBuffer);

      expect(sharp).toHaveBeenCalledWith(testBuffer);
      expect(mockSharpInstance.resize).toHaveBeenCalledWith(1200, 1200, {
        fit: "inside",
        withoutEnlargement: true,
      });
      expect(mockSharpInstance.jpeg).toHaveBeenCalledWith({
        quality: 90,
        progressive: true,
        mozjpeg: true,
      });
      expect(mockSharpInstance.rotate).toHaveBeenCalled();
      expect(result).toEqual(Buffer.from("optimized"));
    });

    it("should optimize image with custom width and height", async () => {
      await optimizeImage(testBuffer, { width: 800, height: 600 });

      expect(mockSharpInstance.resize).toHaveBeenCalledWith(800, 600, {
        fit: "inside",
        withoutEnlargement: true,
      });
    });

    it("should optimize image with custom quality", async () => {
      await optimizeImage(testBuffer, { quality: 75 });

      expect(mockSharpInstance.jpeg).toHaveBeenCalledWith({
        quality: 75,
        progressive: true,
        mozjpeg: true,
      });
    });

    it("should optimize image with custom fit option", async () => {
      await optimizeImage(testBuffer, { fit: "cover" });

      expect(mockSharpInstance.resize).toHaveBeenCalledWith(
        1200,
        1200,
        expect.objectContaining({ fit: "cover" })
      );
    });

    it("should convert to PNG format", async () => {
      await optimizeImage(testBuffer, { format: "png", quality: 85 });

      expect(mockSharpInstance.png).toHaveBeenCalledWith({
        quality: 85,
        compressionLevel: 9,
        progressive: true,
      });
    });

    it("should convert to WebP format", async () => {
      await optimizeImage(testBuffer, { format: "webp", quality: 80 });

      expect(mockSharpInstance.webp).toHaveBeenCalledWith({
        quality: 80,
        effort: 6,
      });
    });

    it("should default to JPEG for unknown format", async () => {
      await optimizeImage(testBuffer, { format: "unknown" });

      expect(mockSharpInstance.jpeg).toHaveBeenCalledWith({
        quality: 90,
        progressive: true,
      });
    });

    it("should handle JPG format (alias for JPEG)", async () => {
      await optimizeImage(testBuffer, { format: "jpg" });

      expect(mockSharpInstance.jpeg).toHaveBeenCalled();
    });

    it("should throw error on sharp failure", async () => {
      mockSharpInstance.toBuffer.mockRejectedValueOnce(
        new Error("Sharp error")
      );

      await expect(optimizeImage(testBuffer)).rejects.toThrow(
        "Failed to optimize image"
      );
    });
  });

  describe("generateMultipleSizes()", () => {
    const testBuffer = Buffer.from("test-image");

    it("should generate all image sizes (thumbnail, small, medium, large)", async () => {
      const result = await generateMultipleSizes(testBuffer, "jpeg");

      expect(result).toHaveProperty("thumbnail");
      expect(result).toHaveProperty("small");
      expect(result).toHaveProperty("medium");
      expect(result).toHaveProperty("large");

      // Verify resize was called for each size
      expect(mockSharpInstance.resize).toHaveBeenCalledTimes(4);
    });

    it("should generate sizes with correct dimensions", async () => {
      await generateMultipleSizes(testBuffer, "jpeg");

      // Check thumbnail size (150x150)
      expect(mockSharpInstance.resize).toHaveBeenCalledWith(
        150,
        150,
        expect.any(Object)
      );

      // Check small size (300x300)
      expect(mockSharpInstance.resize).toHaveBeenCalledWith(
        300,
        300,
        expect.any(Object)
      );

      // Check medium size (600x600)
      expect(mockSharpInstance.resize).toHaveBeenCalledWith(
        600,
        600,
        expect.any(Object)
      );

      // Check large size (1200x1200)
      expect(mockSharpInstance.resize).toHaveBeenCalledWith(
        1200,
        1200,
        expect.any(Object)
      );
    });

    it("should generate sizes in WebP format", async () => {
      await generateMultipleSizes(testBuffer, "webp");

      expect(mockSharpInstance.webp).toHaveBeenCalledTimes(4);
    });

    it("should throw error if size generation fails", async () => {
      mockSharpInstance.toBuffer.mockRejectedValueOnce(
        new Error("Generation failed")
      );

      await expect(generateMultipleSizes(testBuffer)).rejects.toThrow(
        "Failed to optimize image"
      );
    });
  });

  describe("autoOptimizeMiddleware()", () => {
    let req, res, next;

    beforeEach(() => {
      req = {};
      res = {};
      next = jest.fn();

      fs.readFile.mockResolvedValue(Buffer.from("original"));
      fs.writeFile.mockResolvedValue();
      fs.stat.mockResolvedValue({ size: 5000 });
    });

    it("should call next if no files uploaded", async () => {
      const middleware = autoOptimizeMiddleware();
      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(fs.readFile).not.toHaveBeenCalled();
    });

    it("should optimize single image file", async () => {
      req.file = {
        path: "/tmp/test.jpg",
        mimetype: "image/jpeg",
        originalname: "test.jpg",
        size: 10000,
      };

      const middleware = autoOptimizeMiddleware();
      await middleware(req, res, next);

      expect(fs.readFile).toHaveBeenCalledWith("/tmp/test.jpg");
      expect(fs.writeFile).toHaveBeenCalledWith(
        "/tmp/test.jpg",
        Buffer.from("optimized")
      );
      expect(fs.stat).toHaveBeenCalledWith("/tmp/test.jpg");
      expect(req.file.size).toBe(5000);
      expect(next).toHaveBeenCalled();
    });

    it("should optimize multiple image files", async () => {
      req.files = [
        {
          path: "/tmp/test1.jpg",
          mimetype: "image/jpeg",
          originalname: "test1.jpg",
        },
        {
          path: "/tmp/test2.png",
          mimetype: "image/png",
          originalname: "test2.png",
        },
      ];

      const middleware = autoOptimizeMiddleware();
      await middleware(req, res, next);

      expect(fs.readFile).toHaveBeenCalledTimes(2);
      expect(fs.writeFile).toHaveBeenCalledTimes(2);
      expect(req.files).toHaveLength(2);
      expect(next).toHaveBeenCalled();
    });

    it("should skip non-image files", async () => {
      req.files = [
        { path: "/tmp/doc.pdf", mimetype: "application/pdf" },
        {
          path: "/tmp/test.jpg",
          mimetype: "image/jpeg",
          originalname: "test.jpg",
        },
      ];

      const middleware = autoOptimizeMiddleware();
      await middleware(req, res, next);

      expect(fs.readFile).toHaveBeenCalledTimes(1);
      expect(fs.readFile).toHaveBeenCalledWith("/tmp/test.jpg");
    });

    it("should use custom optimization options", async () => {
      req.file = {
        path: "/tmp/test.jpg",
        mimetype: "image/jpeg",
        originalname: "test.jpg",
      };

      const middleware = autoOptimizeMiddleware({
        width: 800,
        height: 600,
        quality: 75,
        format: "webp",
      });

      await middleware(req, res, next);

      expect(mockSharpInstance.resize).toHaveBeenCalledWith(
        800,
        600,
        expect.any(Object)
      );
      expect(mockSharpInstance.webp).toHaveBeenCalledWith({
        quality: 75,
        effort: 6,
      });
    });

    it("should continue on optimization error (non-blocking)", async () => {
      req.file = {
        path: "/tmp/test.jpg",
        mimetype: "image/jpeg",
        originalname: "test.jpg",
      };

      fs.readFile.mockRejectedValueOnce(new Error("Read failed"));

      const middleware = autoOptimizeMiddleware();
      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe("validateImage()", () => {
    let req, res, next;

    beforeEach(() => {
      req = {};
      res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      next = jest.fn();
    });

    it("should call next if no files uploaded", async () => {
      const middleware = validateImage();
      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it("should reject image exceeding file size limit", async () => {
      req.file = {
        path: "/tmp/test.jpg",
        mimetype: "image/jpeg",
        size: 15 * 1024 * 1024, // 15MB (exceeds 10MB default)
      };

      const middleware = validateImage();
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: expect.stringContaining("Image too large"),
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("should reject image exceeding max dimensions", async () => {
      req.file = {
        path: "/tmp/test.jpg",
        mimetype: "image/jpeg",
        size: 1024,
      };

      mockSharpInstance.metadata.mockResolvedValueOnce({
        width: 6000, // Exceeds 5000 default max
        height: 4000,
      });

      const middleware = validateImage();
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: expect.stringContaining("Image dimensions too large"),
      });
    });

    it("should reject image below min dimensions", async () => {
      req.file = {
        path: "/tmp/test.jpg",
        mimetype: "image/jpeg",
        size: 1024,
      };

      mockSharpInstance.metadata.mockResolvedValueOnce({
        width: 50, // Below 100 default min
        height: 50,
      });

      const middleware = validateImage();
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: expect.stringContaining("Image dimensions too small"),
      });
    });

    it("should accept valid image dimensions and size", async () => {
      req.file = {
        path: "/tmp/test.jpg",
        mimetype: "image/jpeg",
        size: 1024 * 1024, // 1MB
      };

      mockSharpInstance.metadata.mockResolvedValueOnce({
        width: 1920,
        height: 1080,
      });

      const middleware = validateImage();
      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it("should use custom validation options", async () => {
      req.file = {
        path: "/tmp/test.jpg",
        mimetype: "image/jpeg",
        size: 3 * 1024 * 1024, // 3MB
      };

      mockSharpInstance.metadata.mockResolvedValueOnce({
        width: 2000,
        height: 1500,
      });

      const middleware = validateImage({
        maxWidth: 3000,
        maxHeight: 2000,
        maxFileSize: 5 * 1024 * 1024, // 5MB
        minWidth: 500,
        minHeight: 500,
      });

      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it("should skip non-image files", async () => {
      req.file = {
        path: "/tmp/doc.pdf",
        mimetype: "application/pdf",
        size: 1024,
      };

      const middleware = validateImage();
      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(sharp).not.toHaveBeenCalled();
    });

    it("should validate multiple files", async () => {
      req.files = [
        {
          path: "/tmp/test1.jpg",
          mimetype: "image/jpeg",
          size: 1024,
        },
        {
          path: "/tmp/test2.png",
          mimetype: "image/png",
          size: 2048,
        },
      ];

      mockSharpInstance.metadata.mockResolvedValue({
        width: 1920,
        height: 1080,
      });

      const middleware = validateImage();
      await middleware(req, res, next);

      expect(sharp).toHaveBeenCalledTimes(2);
      expect(next).toHaveBeenCalled();
    });

    it("should return error on invalid image file", async () => {
      req.file = {
        path: "/tmp/corrupt.jpg",
        mimetype: "image/jpeg",
        size: 1024,
      };

      mockSharpInstance.metadata.mockRejectedValueOnce(
        new Error("Invalid image")
      );

      const middleware = validateImage();
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Invalid image file",
      });
    });
  });

  describe("convertToWebP()", () => {
    const testBuffer = Buffer.from("test-image");

    it("should convert image to WebP with default quality", async () => {
      await convertToWebP(testBuffer);

      expect(sharp).toHaveBeenCalledWith(testBuffer);
      expect(mockSharpInstance.webp).toHaveBeenCalledWith({
        quality: 90,
        effort: 6,
      });
      expect(mockSharpInstance.toBuffer).toHaveBeenCalled();
    });

    it("should convert image to WebP with custom quality", async () => {
      await convertToWebP(testBuffer, 75);

      expect(mockSharpInstance.webp).toHaveBeenCalledWith({
        quality: 75,
        effort: 6,
      });
    });
  });

  describe("IMAGE_QUALITY constants", () => {
    it("should have correct thumbnail dimensions", () => {
      expect(IMAGE_QUALITY.thumbnail).toEqual({
        width: 150,
        height: 150,
        quality: 80,
      });
    });

    it("should have correct small dimensions", () => {
      expect(IMAGE_QUALITY.small).toEqual({
        width: 300,
        height: 300,
        quality: 85,
      });
    });

    it("should have correct medium dimensions", () => {
      expect(IMAGE_QUALITY.medium).toEqual({
        width: 600,
        height: 600,
        quality: 90,
      });
    });

    it("should have correct large dimensions", () => {
      expect(IMAGE_QUALITY.large).toEqual({
        width: 1200,
        height: 1200,
        quality: 90,
      });
    });
  });
});
