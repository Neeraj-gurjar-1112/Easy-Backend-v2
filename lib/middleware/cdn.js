/**
 * CDN Configuration for Static Assets
 * Middleware to add CDN headers and configure caching
 */

const CDN_CONFIG = {
  // CDN Provider (cloudflare, cloudinary, aws-cloudfront, custom)
  provider: process.env.CDN_PROVIDER || "none",

  // CDN domain (e.g., https://cdn.example.com)
  domain: process.env.CDN_DOMAIN || "",

  // CDN prefix for URLs (e.g., /cdn)
  prefix: process.env.CDN_PREFIX || "",

  // Cache duration in seconds
  cacheDuration: {
    images: 31536000, // 1 year
    static: 2592000, // 30 days
    api: 0, // No cache
  },
};

/**
 * Add cache control headers for CDN
 */
function setCacheHeaders(type = "images") {
  return (req, res, next) => {
    const duration = CDN_CONFIG.cacheDuration[type] || 0;

    if (duration > 0) {
      res.set({
        "Cache-Control": `public, max-age=${duration}, immutable`,
        Expires: new Date(Date.now() + duration * 1000).toUTCString(),
      });
    } else {
      res.set({
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      });
    }

    next();
  };
}

/**
 * Generate CDN URL for assets
 */
function getCDNUrl(path) {
  if (!path) return "";

  // If path already has a protocol, return as-is
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  // If CDN is configured, prepend CDN domain
  if (CDN_CONFIG.domain) {
    // Remove leading slash from path
    const cleanPath = path.startsWith("/") ? path.slice(1) : path;
    return `${CDN_CONFIG.domain}/${cleanPath}`;
  }

  // If CDN prefix is configured (for reverse proxy setup)
  if (CDN_CONFIG.prefix) {
    return `${CDN_CONFIG.prefix}${path}`;
  }

  // Return original path
  return path;
}

/**
 * Middleware to optimize static file serving
 */
function optimizeStaticServing() {
  return (req, res, next) => {
    // Enable gzip compression for responses
    res.set("Vary", "Accept-Encoding");

    // Add CORS headers for CDN
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");

    // Security headers
    res.set("X-Content-Type-Options", "nosniff");
    res.set("X-Frame-Options", "DENY");

    next();
  };
}

/**
 * Middleware to add CDN URLs to response JSON
 */
function transformUrlsToCDN() {
  return (req, res, next) => {
    const originalJson = res.json.bind(res);

    res.json = function (data) {
      // Transform URLs in the response
      const transformed = transformObject(data);
      return originalJson(transformed);
    };

    next();
  };
}

/**
 * Recursively transform image URLs to CDN URLs
 */
function transformObject(obj) {
  if (!obj || typeof obj !== "object") {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(transformObject);
  }

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    // Transform fields that typically contain image URLs
    if (
      [
        "image",
        "image_url",
        "imageUrl",
        "thumbnail",
        "avatar",
        "photo",
      ].includes(key)
    ) {
      result[key] = getCDNUrl(value);
    } else if (typeof value === "object") {
      result[key] = transformObject(value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Cloudflare specific optimizations
 */
function cloudflareOptimizations() {
  return (req, res, next) => {
    // Enable Cloudflare Polish (automatic image optimization)
    res.set("CF-Polish", "lossy");

    // Enable Cloudflare Mirage (lazy loading)
    res.set("CF-Mirage", "on");

    // Cache everything
    res.set("CF-Cache-Status", "HIT");

    next();
  };
}

/**
 * Get configuration info
 */
function getConfig() {
  return {
    provider: CDN_CONFIG.provider,
    enabled: CDN_CONFIG.domain !== "" || CDN_CONFIG.prefix !== "",
    domain: CDN_CONFIG.domain,
    prefix: CDN_CONFIG.prefix,
  };
}

/**
 * Middleware to serve images with optimization hints
 */
function imageOptimizationHints() {
  return (req, res, next) => {
    // Add image optimization headers
    res.set("Link", "<https://fonts.googleapis.com>; rel=preconnect");

    // Add responsive image hints
    if (req.query.width || req.query.height) {
      res.set("Content-DPR", "2"); // Support retina displays
      res.set("Viewport-Width", req.query.width || "1200");
    }

    next();
  };
}

module.exports = {
  setCacheHeaders,
  getCDNUrl,
  optimizeStaticServing,
  transformUrlsToCDN,
  cloudflareOptimizations,
  imageOptimizationHints,
  getConfig,
  CDN_CONFIG,
};
