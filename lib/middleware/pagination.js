/**
 * Pagination middleware for MongoDB queries
 * Adds pagination parameters to req.pagination
 *
 * Usage in routes:
 * router.get('/products', paginationMiddleware, async (req, res) => {
 *   const { skip, limit, page } = req.pagination;
 *   const products = await Product.find().skip(skip).limit(limit);
 *   res.json(paginate(products, total, page, limit));
 * });
 */

/**
 * Middleware to parse and validate pagination parameters
 * @param {object} options - Configuration options
 * @param {number} options.defaultLimit - Default items per page (default: 20)
 * @param {number} options.maxLimit - Maximum items per page (default: 100)
 */
function paginationMiddleware(options = {}) {
  const { defaultLimit = 20, maxLimit = 100 } = options;

  return (req, res, next) => {
    // Parse page number (1-indexed)
    let page = parseInt(req.query.page) || 1;
    page = Math.max(1, page); // Ensure page is at least 1

    // Parse limit
    let limit = parseInt(req.query.limit) || defaultLimit;
    limit = Math.max(1, Math.min(limit, maxLimit)); // Clamp between 1 and maxLimit

    // Calculate skip
    const skip = (page - 1) * limit;

    // Attach to request
    req.pagination = {
      page,
      limit,
      skip,
    };

    next();
  };
}

/**
 * Helper function to format paginated response
 * @param {Array} data - Array of items for current page
 * @param {number} total - Total count of items
 * @param {number} page - Current page number
 * @param {number} limit - Items per page
 * @returns {object} Formatted pagination response
 */
function paginate(data, total, page, limit) {
  const totalPages = Math.ceil(total / limit);
  const hasNextPage = page < totalPages;
  const hasPrevPage = page > 1;

  return {
    data,
    pagination: {
      total,
      page,
      limit,
      totalPages,
      hasNextPage,
      hasPrevPage,
      nextPage: hasNextPage ? page + 1 : null,
      prevPage: hasPrevPage ? page - 1 : null,
    },
  };
}

/**
 * Helper function to create pagination metadata only
 * Useful when you need to construct response manually
 */
function getPaginationMeta(total, page, limit) {
  const totalPages = Math.ceil(total / limit);
  const hasNextPage = page < totalPages;
  const hasPrevPage = page > 1;

  return {
    total,
    page,
    limit,
    totalPages,
    hasNextPage,
    hasPrevPage,
    nextPage: hasNextPage ? page + 1 : null,
    prevPage: hasPrevPage ? page - 1 : null,
  };
}

module.exports = {
  paginationMiddleware,
  paginate,
  getPaginationMeta,
};
