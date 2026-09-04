require("module-alias/register");
// Backfill script: populate applied_discount_amount for legacy orders that have coupon_code but 0 applied_discount_amount
// Usage: node scripts/backfill_discounts.js [DRY]
// Set MONGODB_URI in .env or environment

require("dotenv").config();
const mongoose = require("mongoose");
const { Order, Product, PlatformSettings } = require("../lib/models");

async function main() {
  const uri =
    process.env.MONGODB_URI ||
    process.env.MONGO_URI ||
    "mongodb://127.0.0.1:27017/easy";
  await mongoose.connect(uri, { dbName: undefined });
  console.log("[backfill] Connected.");

  const settings = await PlatformSettings.findOne({}, { coupons: 1 }).lean();
  const allCoupons = settings?.coupons || [];
  const now = new Date();
  let processed = 0,
    updated = 0,
    skipped = 0;

  const cursor = Order.find({
    coupon_code: { $exists: true, $ne: null, $ne: "" },
    $or: [
      { applied_discount_amount: { $exists: false } },
      { applied_discount_amount: 0 },
    ],
  }).cursor();
  for await (const order of cursor) {
    processed++;
    try {
      const code = (order.coupon_code || "").toString().trim().toUpperCase();
      if (!code) {
        skipped++;
        continue;
      }
      let coupon = allCoupons.find(
        (c) => (c.code || "").toString().trim().toUpperCase() === code
      );
      if (!coupon) {
        skipped++;
        continue;
      }
      // validate coupon basic rules
      if (coupon.enabled === false) {
        skipped++;
        continue;
      }
      if (coupon.valid_from && new Date(coupon.valid_from) > now) {
        skipped++;
        continue;
      }
      if (coupon.valid_to && new Date(coupon.valid_to) < now) {
        skipped++;
        continue;
      }

      // collect categories present
      const pids = (order.order_items || [])
        .map((oi) => oi.product_id)
        .filter(Boolean);
      const prods = pids.length
        ? await Product.find({ _id: { $in: pids } }, { category: 1 }).lean()
        : [];
      const presentCats = new Set();
      for (const p of prods) {
        const c = (p.category || "").toString().toLowerCase();
        if (c.includes("grocery")) presentCats.add("grocery");
        if (c.includes("vegetable")) presentCats.add("vegetable");
        if (c.includes("restaurant") || c.includes("food"))
          presentCats.add("food");
      }
      if (
        Array.isArray(coupon.allowed_categories) &&
        coupon.allowed_categories.length
      ) {
        const ok = coupon.allowed_categories.some((cat) =>
          presentCats.has((cat || "").toString().toLowerCase())
        );
        if (!ok) {
          skipped++;
          continue;
        }
      }

      const subtotal = (order.order_items || []).reduce(
        (s, it) => s + Number(it.price_snapshot || 0) * Number(it.qty || 0),
        0
      );
      if (subtotal <= 0) {
        skipped++;
        continue;
      }

      const percent = Number(coupon.percent || 0);
      if (percent <= 0) {
        skipped++;
        continue;
      }
      let discount = Math.round(((subtotal * percent) / 100) * 100) / 100; // 2 decimals
      if (coupon.max_amount) {
        discount = Math.min(discount, Number(coupon.max_amount));
      }
      if (discount <= 0) {
        skipped++;
        continue;
      }

      order.applied_discount_amount = discount;
      await order.save();
      updated++;
      console.log(
        `[backfill] Order ${order._id} set applied_discount_amount=${discount}`
      );
    } catch (err) {
      console.error("[backfill] Error order", order._id, err.message);
      skipped++;
    }
  }

  console.log(
    `[backfill] Done. processed=${processed} updated=${updated} skipped=${skipped}`
  );
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
