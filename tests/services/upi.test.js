const { buildUpiLink, getUpiEnv } = require("../../lib/util/upi");

describe("UPI Service - Stub Tests", () => {
  describe("buildUpiLink()", () => {
    test("should throw error when called (UPI removed)", () => {
      expect(() => buildUpiLink()).toThrow(
        "UPI has been removed. Use COD only."
      );
    });

    test("should throw error with any arguments", () => {
      expect(() => buildUpiLink({ amount: 100 })).toThrow(
        "UPI has been removed. Use COD only."
      );
    });

    test("should throw error with multiple arguments", () => {
      expect(() => buildUpiLink("upi123", 500, "order456")).toThrow(
        "UPI has been removed. Use COD only."
      );
    });
  });

  describe("getUpiEnv()", () => {
    test("should throw error when called (UPI removed)", () => {
      expect(() => getUpiEnv()).toThrow("UPI has been removed. Use COD only.");
    });

    test("should throw error with any arguments", () => {
      expect(() => getUpiEnv("production")).toThrow(
        "UPI has been removed. Use COD only."
      );
    });
  });

  describe("Module Exports", () => {
    test("should export buildUpiLink function", () => {
      expect(typeof buildUpiLink).toBe("function");
    });

    test("should export getUpiEnv function", () => {
      expect(typeof getUpiEnv).toBe("function");
    });
  });
});
