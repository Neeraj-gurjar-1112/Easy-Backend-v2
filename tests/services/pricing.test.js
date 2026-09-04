/**
 * Pricing Service Tests
 *
 * Tests for services/pricing.js
 * Target: 46.26% → 90% coverage
 *
 * Functions tested:
 * - buildOrderItemsAndTotal: Basic order total calculation
 * - buildGroupedOrders: Category-based order grouping
 */

// Mock the models module before requiring anything else
const mockProductFind = jest.fn();
jest.mock("../../lib/models", () => ({
  Product: {
    find: mockProductFind,
  },
  Seller: {},
  Client: {},
  DeliveryAgent: {},
  Admin: {},
  Order: {},
  Alert: {},
  DeviceToken: {},
  PlatformSettings: {},
  NotificationCampaign: {},
  Feedback: {},
}));

const {
  buildOrderItemsAndTotal,
  buildGroupedOrders,
} = require("../../lib/util/pricing");

// Helper function to mock Product.find with lean() support
function mockProductFindWithLean(products) {
  mockProductFind.mockReturnValue({
    lean: jest.fn().mockResolvedValue(products),
  });
}

describe("Pricing Service Tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProductFind.mockReset();
  });

  // ============================================================================
  // buildOrderItemsAndTotal Tests
  // ============================================================================

  describe("buildOrderItemsAndTotal - Basic Functionality", () => {
    test("should calculate total for valid products from database", async () => {
      const mockProducts = [
        {
          _id: "prod1",
          name: "Apple",
          price: 100,
          status: "active",
          category: "grocery",
        },
        {
          _id: "prod2",
          name: "Banana",
          price: 50,
          status: "active",
          category: "grocery",
        },
      ];

      // Mock Product.find to return query object with lean() method
      mockProductFind.mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockProducts),
      });

      const items = [
        { product_id: "prod1", qty: 2 },
        { product_id: "prod2", qty: 3 },
      ];

      const result = await buildOrderItemsAndTotal(items);

      expect(result).toHaveProperty("orderItems");
      expect(result).toHaveProperty("total");
      expect(result.total).toBe(350); // (100*2) + (50*3) = 350
      expect(result.orderItems).toHaveLength(2);
      expect(result.orderItems[0]).toMatchObject({
        product_id: "prod1",
        qty: 2,
        price_snapshot: 100,
        name_snapshot: "Apple",
      });
    });

    test("should handle single product order", async () => {
      const mockProducts = [
        {
          _id: "prod1",
          name: "Milk",
          price: 60,
          status: "active",
        },
      ];

      mockProductFindWithLean(mockProducts);

      const items = [{ product_id: "prod1", qty: 1 }];

      const result = await buildOrderItemsAndTotal(items);

      expect(result.total).toBe(60);
      expect(result.orderItems).toHaveLength(1);
    });

    test("should default quantity to 1 if missing", async () => {
      const mockProducts = [
        {
          _id: "prod1",
          name: "Bread",
          price: 40,
          status: "active",
        },
      ];

      mockProductFindWithLean(mockProducts);

      const items = [{ product_id: "prod1" }]; // No qty field

      const result = await buildOrderItemsAndTotal(items);

      expect(result.total).toBe(40); // 40 * 1
      expect(result.orderItems[0].qty).toBe(1);
    });

    test("should handle zero or negative quantity by defaulting to 1", async () => {
      const mockProducts = [
        {
          _id: "prod1",
          name: "Rice",
          price: 80,
          status: "active",
        },
      ];

      mockProductFindWithLean(mockProducts);

      const items = [
        { product_id: "prod1", qty: 0 },
        { product_id: "prod1", qty: -5 },
      ];

      const result = await buildOrderItemsAndTotal(items);

      // Both should default to qty: 1
      expect(result.orderItems[0].qty).toBe(1);
      expect(result.orderItems[1].qty).toBe(1);
      expect(result.total).toBe(160); // 80 * 2
    });

    test("should round total to 2 decimal places", async () => {
      const mockProducts = [
        {
          _id: "prod1",
          name: "Eggs",
          price: 5.333,
          status: "active",
        },
      ];

      mockProductFindWithLean(mockProducts);

      const items = [{ product_id: "prod1", qty: 3 }];

      const result = await buildOrderItemsAndTotal(items);

      expect(result.total).toBe(16); // 5.333 * 3 = 15.999 → rounded to 16
    });
  });

  describe("buildOrderItemsAndTotal - Fallback to Client Snapshot", () => {
    test("should use client snapshot when product not found in DB", async () => {
      mockProductFindWithLean([]); // No products in DB

      const items = [
        {
          product_id: "unknown_prod",
          qty: 2,
          price: 150,
          name: "Unknown Product",
        },
      ];

      const result = await buildOrderItemsAndTotal(items);

      expect(result.total).toBe(300); // 150 * 2
      expect(result.orderItems[0]).toMatchObject({
        qty: 2,
        price_snapshot: 150,
        name_snapshot: "Unknown Product",
      });
      expect(result.orderItems[0]).not.toHaveProperty("product_id");
    });

    test("should throw error if product not in DB and no valid price snapshot", async () => {
      mockProductFindWithLean([]);

      const items = [
        {
          product_id: "unknown_prod",
          qty: 1,
          // No price field
        },
      ];

      await expect(buildOrderItemsAndTotal(items)).rejects.toThrow(
        "Invalid product or price"
      );
    });

    test("should throw error if price snapshot is negative", async () => {
      mockProductFindWithLean([]);

      const items = [
        {
          product_id: "unknown_prod",
          qty: 1,
          price: -100, // Negative price
        },
      ];

      await expect(buildOrderItemsAndTotal(items)).rejects.toThrow(
        "Invalid product or price"
      );
    });

    test("should handle DB unavailability and use fallback", async () => {
      // Mock Product.find to return a query object whose lean() throws an error
      mockProductFind.mockReturnValue({
        lean: jest.fn().mockRejectedValue(new Error("DB connection failed")),
      });

      const items = [
        {
          product_id: "prod1",
          qty: 2,
          price: 100,
          name: "Fallback Product",
        },
      ];

      const result = await buildOrderItemsAndTotal(items);

      expect(result.total).toBe(200);
      expect(result.orderItems[0].name_snapshot).toBe("Fallback Product");
    });
  });

  describe("buildOrderItemsAndTotal - Error Handling", () => {
    test("should throw error for empty items array", async () => {
      await expect(buildOrderItemsAndTotal([])).rejects.toThrow(
        "No items provided"
      );
    });

    test("should throw error for null items", async () => {
      await expect(buildOrderItemsAndTotal(null)).rejects.toThrow(
        "No items provided"
      );
    });

    test("should throw error for undefined items", async () => {
      await expect(buildOrderItemsAndTotal(undefined)).rejects.toThrow(
        "No items provided"
      );
    });

    test("should throw error for non-array items", async () => {
      await expect(buildOrderItemsAndTotal("not an array")).rejects.toThrow(
        "No items provided"
      );
    });
  });

  // ============================================================================
  // buildGroupedOrders Tests
  // ============================================================================

  describe("buildGroupedOrders - Category Grouping", () => {
    test("should group grocery and food items separately", async () => {
      const mockProducts = [
        {
          _id: "prod1",
          name: "Milk",
          price: 60,
          status: "active",
          category: "grocery",
        },
        {
          _id: "prod2",
          name: "Pizza",
          price: 300,
          status: "active",
          category: "restaurant",
        },
        {
          _id: "prod3",
          name: "Tomatoes",
          price: 40,
          status: "active",
          category: "vegetable",
        },
      ];

      mockProductFindWithLean(mockProducts);

      const items = [
        { product_id: "prod1", qty: 2 }, // Grocery
        { product_id: "prod2", qty: 1 }, // Food (restaurant)
        { product_id: "prod3", qty: 3 }, // Grocery (vegetable)
      ];

      const result = await buildGroupedOrders(items);

      expect(result).toHaveLength(2);

      // Find grocery group
      const groceryGroup = result.find((g) => g.key === "grocery");
      expect(groceryGroup).toBeDefined();
      expect(groceryGroup.total).toBe(240); // (60*2) + (40*3) = 240
      expect(groceryGroup.orderItems).toHaveLength(2);

      // Find food group
      const foodGroup = result.find((g) => g.key === "food");
      expect(foodGroup).toBeDefined();
      expect(foodGroup.total).toBe(300);
      expect(foodGroup.orderItems).toHaveLength(1);
    });

    test("should classify 'restaurant' category as food", async () => {
      const mockProducts = [
        {
          _id: "prod1",
          name: "Burger",
          price: 150,
          status: "active",
          category: "restaurant",
        },
      ];

      mockProductFindWithLean(mockProducts);

      const items = [{ product_id: "prod1", qty: 1 }];

      const result = await buildGroupedOrders(items);

      expect(result).toHaveLength(1);
      expect(result[0].key).toBe("food");
    });

    test("should classify 'food' category as food", async () => {
      const mockProducts = [
        {
          _id: "prod1",
          name: "Pasta",
          price: 200,
          status: "active",
          category: "food",
        },
      ];

      mockProductFindWithLean(mockProducts);

      const items = [{ product_id: "prod1", qty: 1 }];

      const result = await buildGroupedOrders(items);

      expect(result).toHaveLength(1);
      expect(result[0].key).toBe("food");
    });

    test("should default unknown categories to grocery", async () => {
      const mockProducts = [
        {
          _id: "prod1",
          name: "Mystery Item",
          price: 100,
          status: "active",
          category: "unknown",
        },
      ];

      mockProductFindWithLean(mockProducts);

      const items = [{ product_id: "prod1", qty: 1 }];

      const result = await buildGroupedOrders(items);

      expect(result).toHaveLength(1);
      expect(result[0].key).toBe("grocery");
    });

    test("should return only non-empty groups", async () => {
      const mockProducts = [
        {
          _id: "prod1",
          name: "Rice",
          price: 80,
          status: "active",
          category: "grocery",
        },
      ];

      mockProductFindWithLean(mockProducts);

      const items = [{ product_id: "prod1", qty: 1 }];

      const result = await buildGroupedOrders(items);

      // Should only return grocery group, not food
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe("grocery");
    });

    test("should maintain stable order: grocery then food", async () => {
      const mockProducts = [
        {
          _id: "prod1",
          name: "Pizza",
          price: 300,
          status: "active",
          category: "restaurant",
        },
        {
          _id: "prod2",
          name: "Milk",
          price: 60,
          status: "active",
          category: "grocery",
        },
      ];

      mockProductFindWithLean(mockProducts);

      const items = [
        { product_id: "prod1", qty: 1 }, // Food first in input
        { product_id: "prod2", qty: 1 }, // Grocery second
      ];

      const result = await buildGroupedOrders(items);

      expect(result).toHaveLength(2);
      expect(result[0].key).toBe("grocery"); // Grocery always first
      expect(result[1].key).toBe("food");
    });
  });

  describe("buildGroupedOrders - Fallback Handling", () => {
    test("should use category_snapshot from client for grouping when product not in DB", async () => {
      mockProductFindWithLean([]);

      const items = [
        {
          product_id: "unknown1",
          qty: 1,
          price: 100,
          name: "Unknown Food",
          category_snapshot: "restaurant",
        },
        {
          product_id: "unknown2",
          qty: 1,
          price: 50,
          name: "Unknown Grocery",
          category_snapshot: "grocery",
        },
      ];

      const result = await buildGroupedOrders(items);

      expect(result).toHaveLength(2);

      const groceryGroup = result.find((g) => g.key === "grocery");
      expect(groceryGroup.total).toBe(50);

      const foodGroup = result.find((g) => g.key === "food");
      expect(foodGroup.total).toBe(100);
    });

    test("should handle DB errors and use fallback grouping", async () => {
      // Mock Product.find to return a query object whose lean() throws an error
      mockProductFind.mockReturnValue({
        lean: jest.fn().mockRejectedValue(new Error("DB down")),
      });

      const items = [
        {
          product_id: "prod1",
          qty: 1,
          price: 100,
          name: "Item 1",
          category_snapshot: "food",
        },
      ];

      const result = await buildGroupedOrders(items);

      expect(result).toHaveLength(1);
      expect(result[0].key).toBe("food");
      expect(result[0].total).toBe(100);
    });

    test("should throw error if product not in DB and no valid price", async () => {
      mockProductFindWithLean([]);

      const items = [
        {
          product_id: "unknown",
          qty: 1,
          // No price field
        },
      ];

      await expect(buildGroupedOrders(items)).rejects.toThrow(
        "Invalid product or price"
      );
    });
  });

  describe("buildGroupedOrders - Error Handling", () => {
    test("should throw error for empty items array", async () => {
      await expect(buildGroupedOrders([])).rejects.toThrow("No items provided");
    });

    test("should throw error for null items", async () => {
      await expect(buildGroupedOrders(null)).rejects.toThrow(
        "No items provided"
      );
    });

    test("should throw error for undefined items", async () => {
      await expect(buildGroupedOrders(undefined)).rejects.toThrow(
        "No items provided"
      );
    });
  });

  describe("buildGroupedOrders - Quantity & Price Handling", () => {
    test("should handle quantity field variations (qty vs quantity)", async () => {
      const mockProducts = [
        {
          _id: "prod1",
          name: "Apple",
          price: 50,
          status: "active",
          category: "grocery",
        },
      ];

      mockProductFindWithLean(mockProducts);

      const items = [
        { product_id: "prod1", quantity: 3 }, // Using 'quantity' instead of 'qty'
      ];

      const result = await buildGroupedOrders(items);

      expect(result[0].orderItems[0].qty).toBe(3);
      expect(result[0].total).toBe(150);
    });

    test("should round group totals to 2 decimal places", async () => {
      const mockProducts = [
        {
          _id: "prod1",
          name: "Item",
          price: 3.333,
          status: "active",
          category: "grocery",
        },
      ];

      mockProductFindWithLean(mockProducts);

      const items = [{ product_id: "prod1", qty: 3 }];

      const result = await buildGroupedOrders(items);

      expect(result[0].total).toBe(10); // 3.333 * 3 = 9.999 → rounded to 10
    });

    test("should handle mixed products and fallbacks in same group", async () => {
      const mockProducts = [
        {
          _id: "prod1",
          name: "DB Product",
          price: 100,
          status: "active",
          category: "grocery",
        },
      ];

      mockProductFindWithLean(mockProducts);

      const items = [
        { product_id: "prod1", qty: 1 }, // From DB
        {
          product_id: "unknown",
          qty: 1,
          price: 50,
          name: "Fallback Product",
        }, // Fallback
      ];

      const result = await buildGroupedOrders(items);

      expect(result).toHaveLength(1);
      expect(result[0].key).toBe("grocery");
      expect(result[0].total).toBe(150); // 100 + 50
      expect(result[0].orderItems).toHaveLength(2);
    });
  });
});
