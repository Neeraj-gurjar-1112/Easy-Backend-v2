/**
 * Phase 25.13: Validation Middleware Coverage
 * Target: middleware/validation.js line 225
 *
 * Focus: MongoDB operator filtering in sanitizeObject()
 */

const { sanitizeObject, sanitize } = require("../lib/middleware/validation");

describe("Phase 25.13: Validation Middleware - MongoDB Operator Filtering", () => {
  describe("Section 1: MongoDB Operator Key Filtering (line 225)", () => {
    it("1.1: should filter MongoDB operators from object keys", () => {
      // Line 225: if (key.startsWith("$")) continue;
      const input = {
        name: "Test",
        $where: "malicious",
        $gt: { nested: "attack" },
        normalKey: "normal value",
        $ne: "filtered",
      };

      const result = sanitizeObject(input);

      // MongoDB operators should be filtered
      expect(result.$where).toBeUndefined();
      expect(result.$gt).toBeUndefined();
      expect(result.$ne).toBeUndefined();

      // Normal keys should be preserved
      expect(result.name).toBe("Test");
      expect(result.normalKey).toBe("normal value");
    });

    it("1.2: should handle nested MongoDB operators", () => {
      const input = {
        query: {
          $or: [{ field1: "value1" }],
          nested: {
            $exists: true,
            normalField: "value",
          },
        },
        name: "Test",
      };

      const result = sanitizeObject(input);

      // Nested operators filtered
      expect(result.query.$or).toBeUndefined();
      expect(result.query.nested.$exists).toBeUndefined();

      // Normal nested fields preserved
      expect(result.query.nested.normalField).toBe("value");
      expect(result.name).toBe("Test");
    });

    it("1.3: should preserve normal keys while filtering operators", () => {
      const input = {
        name: "Normal",
        $set: "filtered",
        description: "Description",
        $push: { items: "attack" },
        category: "Category",
        $unset: "filtered",
      };

      const result = sanitizeObject(input);

      // Operators filtered
      expect(result.$set).toBeUndefined();
      expect(result.$push).toBeUndefined();
      expect(result.$unset).toBeUndefined();

      // Normal keys preserved
      expect(result.name).toBe("Normal");
      expect(result.description).toBe("Description");
      expect(result.category).toBe("Category");
    });

    it("1.4: should handle array of objects with MongoDB operators", () => {
      // This ensures line 225 is hit when sanitizing array elements
      const input = [
        { name: "Item1", $where: "malicious" },
        { name: "Item2", $gt: 100 },
      ];

      const result = sanitizeObject(input);

      // Array should be sanitized
      expect(Array.isArray(result)).toBe(true);
      expect(result[0].$where).toBeUndefined();
      expect(result[1].$gt).toBeUndefined();
      expect(result[0].name).toBe("Item1");
      expect(result[1].name).toBe("Item2");
    });

    it("1.5: should skip keys starting with $ and continue to next key", () => {
      // Directly test the continue behavior on line 225
      const input = {
        $first: "should skip",
        regularKey1: "should keep",
        $second: "should skip",
        regularKey2: "should keep",
        $third: "should skip",
      };

      const result = sanitizeObject(input);

      // All $ keys should be skipped (line 225: if (key.startsWith("$")) continue;)
      expect(result.$first).toBeUndefined();
      expect(result.$second).toBeUndefined();
      expect(result.$third).toBeUndefined();

      // Regular keys should be present
      expect(result.regularKey1).toBe("should keep");
      expect(result.regularKey2).toBe("should keep");
    });

    it("1.6: should call sanitize middleware with MongoDB operators in req.body", () => {
      // Test the middleware function directly to ensure line 225 is covered
      const req = {
        body: {
          name: "Test",
          $where: "malicious",
          $ne: { attack: "payload" },
          normalField: "value",
        },
      };
      const res = {};
      const next = jest.fn();

      sanitize(req, res, next);

      // Middleware should sanitize req.body
      expect(req.body.$where).toBeUndefined();
      expect(req.body.$ne).toBeUndefined();
      expect(req.body.name).toBe("Test");
      expect(req.body.normalField).toBe("value");
      expect(next).toHaveBeenCalled();
    });
  });
});
