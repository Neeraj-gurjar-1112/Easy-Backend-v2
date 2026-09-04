const { Product } = require("@models");

// Compute total and snapshot items to ensure consistency
// Enhancement: If a product is not found in DB (e.g., demo/static IDs),
// fall back to client-submitted name/price to allow COD orders to proceed.
async function buildOrderItemsAndTotal(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("No items provided");
  }

  const productIds = items.map((i) => i.product_id).filter(Boolean);
  let products = [];
  try {
    products = await Product.find({
      _id: { $in: productIds },
      status: "active",
    }).lean();
  } catch (_) {
    // DB might be unavailable; proceed with fallback where possible.
    products = [];
  }
  const productMap = new Map(products.map((p) => [String(p._id), p]));

  let total = 0;
  const orderItems = items.map((i) => {
    const qty = Math.max(1, Number(i.qty || 1));
    const prod = productMap.get(String(i.product_id));
    if (prod) {
      const price = Number(prod.price || 0);
      total += price * qty;
      return {
        product_id: prod._id,
        qty,
        price_snapshot: price,
        name_snapshot: prod.name,
      };
    }
    // Fallback: accept client snapshot if provided
    const priceSnapshot = Number(i.price);
    const nameSnapshot = i.name ? String(i.name) : undefined;
    if (!Number.isFinite(priceSnapshot) || priceSnapshot < 0) {
      throw new Error(`Invalid product or price for: ${i.product_id}`);
    }
    total += priceSnapshot * qty;
    return {
      // product_id omitted when unknown in DB
      qty,
      price_snapshot: priceSnapshot,
      name_snapshot: nameSnapshot,
    };
  });

  // Round to 2 decimals for INR; store as Number
  total = Math.round(total * 100) / 100;

  return { orderItems, total };
}

// New: Group items into logical orders by category group.
// Group A: Grocery + Vegetables (non-restaurant)
// Group B: Restaurant / Food
// Returns an array: [{ key: 'grocery', orderItems, total }, { key: 'food', orderItems, total }]
async function buildGroupedOrders(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("No items provided");
  }

  const productIds = items.map((i) => i.product_id).filter(Boolean);
  let products = [];
  try {
    products = await Product.find({
      _id: { $in: productIds },
      status: "active",
    }).lean();
  } catch (_) {
    products = [];
  }
  const productMap = new Map(products.map((p) => [String(p._id), p]));

  const groups = {
    grocery: { key: "grocery", orderItems: [], total: 0 },
    food: { key: "food", orderItems: [], total: 0 },
  };

  // Helper: decide group key
  function resolveGroup(prodOrItem) {
    const cat = (prodOrItem?.category || prodOrItem?.category_snapshot || "")
      .toString()
      .toLowerCase();
    if (
      cat.includes("restaurant") ||
      cat.includes("food") ||
      cat.includes("eat")
    )
      return "food";
    // default to grocery bucket (covers vegetables)
    return "grocery";
  }

  for (const i of items) {
    const qty = Math.max(1, Number(i.qty || i.quantity || 1));
    const prod = productMap.get(String(i.product_id));
    let price = 0;
    let name = undefined;
    let groupKey = "grocery";
    if (prod) {
      price = Number(prod.price || 0);
      name = prod.name;
      groupKey = resolveGroup(prod);
      groups[groupKey].orderItems.push({
        product_id: prod._id,
        qty,
        price_snapshot: price,
        name_snapshot: name,
      });
      groups[groupKey].total += price * qty;
    } else {
      // Fallback: use provided snapshot
      const priceSnapshot = Number(i.price);
      if (!Number.isFinite(priceSnapshot) || priceSnapshot < 0) {
        throw new Error(`Invalid product or price for: ${i.product_id}`);
      }
      price = priceSnapshot;
      name = i.name ? String(i.name) : undefined;
      // try to group using any provided category
      groupKey = resolveGroup(i);
      groups[groupKey].orderItems.push({
        qty,
        price_snapshot: price,
        name_snapshot: name,
      });
      groups[groupKey].total += price * qty;
    }
  }

  // Round totals
  for (const k of Object.keys(groups)) {
    groups[k].total = Math.round(groups[k].total * 100) / 100;
  }

  // Only return non-empty groups, in a stable order [grocery, food]
  return [groups.grocery, groups.food].filter((g) => g.orderItems.length > 0);
}

module.exports = { buildOrderItemsAndTotal, buildGroupedOrders };
