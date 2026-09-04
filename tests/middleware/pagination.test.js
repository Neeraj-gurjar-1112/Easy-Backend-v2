/**
 * Pagination Middleware Tests
 * Testing: middleware/pagination.js
 * Coverage Target: 77.77% → 90%+
 *
 * Test Categories:
 * 1. Middleware - paginationMiddleware() (6 tests)
 * 2. Helper - paginate() (6 tests)
 * 3. Helper - getPaginationMeta() (5 tests)
 */

const {
  paginationMiddleware,
  paginate,
  getPaginationMeta,
} = require("../../lib/middleware/pagination");

describe("Pagination Middleware - Complete Coverage", () => {
  // =============================================================================
  // Category 1: paginationMiddleware() - Request Parsing & Validation
  // =============================================================================

  describe("paginationMiddleware - Request Parsing", () => {
    let req, res, next;

    beforeEach(() => {
      req = { query: {} };
      res = {};
      next = jest.fn();
    });

    test("should apply default pagination (page=1, limit=20) when no query params", () => {
      const middleware = paginationMiddleware();
      middleware(req, res, next);

      expect(req.pagination).toEqual({
        page: 1,
        limit: 20,
        skip: 0,
      });
      expect(next).toHaveBeenCalledTimes(1);
    });

    test("should parse page and limit from query string", () => {
      req.query = { page: "3", limit: "15" };
      const middleware = paginationMiddleware();
      middleware(req, res, next);

      expect(req.pagination).toEqual({
        page: 3,
        limit: 15,
        skip: 30, // (3-1) * 15
      });
      expect(next).toHaveBeenCalledTimes(1);
    });

    test("should enforce custom defaultLimit and maxLimit options", () => {
      req.query = { limit: "200" }; // Exceeds maxLimit
      const middleware = paginationMiddleware({
        defaultLimit: 50,
        maxLimit: 100,
      });
      middleware(req, res, next);

      expect(req.pagination).toEqual({
        page: 1,
        limit: 100, // Clamped to maxLimit
        skip: 0,
      });
    });

    test("should treat page=0 as page=1 (minimum enforcement)", () => {
      req.query = { page: "0" };
      const middleware = paginationMiddleware();
      middleware(req, res, next);

      expect(req.pagination.page).toBe(1);
      expect(req.pagination.skip).toBe(0);
    });

    test("should treat negative page numbers as page=1", () => {
      req.query = { page: "-5" };
      const middleware = paginationMiddleware();
      middleware(req, res, next);

      expect(req.pagination.page).toBe(1);
      expect(req.pagination.skip).toBe(0);
    });

    test("should handle non-numeric page/limit gracefully (use defaults)", () => {
      req.query = { page: "abc", limit: "xyz" };
      const middleware = paginationMiddleware();
      middleware(req, res, next);

      expect(req.pagination).toEqual({
        page: 1,
        limit: 20,
        skip: 0,
      });
    });
  });

  // =============================================================================
  // Category 2: paginate() - Response Formatting with Metadata
  // =============================================================================

  describe("paginate - Response Formatting", () => {
    test("should format paginated response with metadata (page 1 of 3)", () => {
      const data = [{ id: 1 }, { id: 2 }];
      const total = 50;
      const page = 1;
      const limit = 20;

      const result = paginate(data, total, page, limit);

      expect(result).toEqual({
        data: [{ id: 1 }, { id: 2 }],
        pagination: {
          total: 50,
          page: 1,
          limit: 20,
          totalPages: 3, // Math.ceil(50/20)
          hasNextPage: true,
          hasPrevPage: false,
          nextPage: 2,
          prevPage: null,
        },
      });
    });

    test("should format middle page correctly (page 2 of 5)", () => {
      const data = [{ id: 21 }, { id: 22 }];
      const result = paginate(data, 100, 2, 20);

      expect(result.pagination).toMatchObject({
        page: 2,
        totalPages: 5,
        hasNextPage: true,
        hasPrevPage: true,
        nextPage: 3,
        prevPage: 1,
      });
    });

    test("should format last page correctly (no next page)", () => {
      const data = [{ id: 81 }];
      const result = paginate(data, 81, 5, 20);

      expect(result.pagination).toMatchObject({
        page: 5,
        totalPages: 5, // Math.ceil(81/20) = 5
        hasNextPage: false,
        hasPrevPage: true,
        nextPage: null,
        prevPage: 4,
      });
    });

    test("should handle single page result (total < limit)", () => {
      const data = [{ id: 1 }, { id: 2 }, { id: 3 }];
      const result = paginate(data, 3, 1, 20);

      expect(result.pagination).toMatchObject({
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
        nextPage: null,
        prevPage: null,
      });
    });

    test("should handle empty result set (total=0)", () => {
      const data = [];
      const result = paginate(data, 0, 1, 20);

      expect(result.pagination).toMatchObject({
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPrevPage: false,
      });
    });

    test("should calculate totalPages correctly with exact division", () => {
      // 100 items, 20 per page = exactly 5 pages
      const data = [];
      const result = paginate(data, 100, 1, 20);

      expect(result.pagination.totalPages).toBe(5);
    });
  });

  // =============================================================================
  // Category 3: getPaginationMeta() - Metadata Only (Uncovered Lines 78-82)
  // =============================================================================

  describe("getPaginationMeta - Metadata Generation", () => {
    test("should generate metadata for first page (hasNextPage=true, hasPrevPage=false)", () => {
      const meta = getPaginationMeta(50, 1, 20);

      expect(meta).toEqual({
        total: 50,
        page: 1,
        limit: 20,
        totalPages: 3,
        hasNextPage: true,
        hasPrevPage: false,
        nextPage: 2,
        prevPage: null,
      });
    });

    test("should generate metadata for middle page (both next and prev)", () => {
      const meta = getPaginationMeta(100, 3, 20);

      expect(meta).toEqual({
        total: 100,
        page: 3,
        limit: 20,
        totalPages: 5,
        hasNextPage: true,
        hasPrevPage: true,
        nextPage: 4,
        prevPage: 2,
      });
    });

    test("should generate metadata for last page (hasNextPage=false)", () => {
      const meta = getPaginationMeta(81, 5, 20);

      expect(meta).toEqual({
        total: 81,
        page: 5,
        limit: 20,
        totalPages: 5,
        hasNextPage: false,
        hasPrevPage: true,
        nextPage: null,
        prevPage: 4,
      });
    });

    test("should handle single page (no next or prev)", () => {
      const meta = getPaginationMeta(15, 1, 20);

      expect(meta).toMatchObject({
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
        nextPage: null,
        prevPage: null,
      });
    });

    test("should handle edge case with very large page numbers", () => {
      // Requesting page 1000 when only 5 pages exist
      const meta = getPaginationMeta(100, 1000, 20);

      expect(meta).toMatchObject({
        page: 1000,
        totalPages: 5,
        hasNextPage: false, // Beyond last page
        hasPrevPage: true,
        nextPage: null,
        prevPage: 999,
      });
    });
  });

  // =============================================================================
  // Edge Cases & Integration
  // =============================================================================

  describe("Edge Cases & Integration", () => {
    test("should handle very small limits (limit=1)", () => {
      const req = { query: { page: "5", limit: "1" } };
      const res = {};
      const next = jest.fn();

      const middleware = paginationMiddleware();
      middleware(req, res, next);

      expect(req.pagination).toEqual({
        page: 5,
        limit: 1,
        skip: 4, // (5-1) * 1
      });
    });

    test("should handle very large page numbers without overflow", () => {
      const req = { query: { page: "999999", limit: "50" } };
      const res = {};
      const next = jest.fn();

      const middleware = paginationMiddleware();
      middleware(req, res, next);

      expect(req.pagination.page).toBe(999999);
      expect(req.pagination.skip).toBe(49999900); // (999999-1) * 50 = 999998 * 50
      expect(typeof req.pagination.skip).toBe("number");
    });
  });
});
