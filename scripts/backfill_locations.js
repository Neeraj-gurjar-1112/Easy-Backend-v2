require("module-alias/register");
/*
 Backfill missing coordinates for Sellers and UserAddresses.
 - Uses Google Geocoding API. Set GOOGLE_MAPS_API_KEY in env (.env supported).
 - Respects a simple rate limit with delay between requests.
 - Idempotent: only updates documents where location.lat/lng are missing.

 Usage:
   node scripts/backfill_locations.js
   DB_CONNECTION_STRING=mongodb://127.0.0.1:27017/easy_app GOOGLE_MAPS_API_KEY=XXXX node scripts/backfill_locations.js
*/

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const https = require("https");
const { Seller, UserAddress, Order } = require("../lib/models");

const MONGO_URI =
  process.env.DB_CONNECTION_STRING || "mongodb://127.0.0.1:27017/easy_app";
const GOOGLE_KEY =
  process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY || "";
const DELAY_MS = parseInt(process.env.GEOCODE_DELAY_MS || "300", 10);
const LIMIT = parseInt(process.env.BACKFILL_LIMIT || "0", 10); // 0 = no limit
const PREFER_PLACE_DETAILS =
  String(process.env.PREFER_PLACE_DETAILS || "1") !== "0"; // default true

if (!GOOGLE_KEY) {
  console.warn(
    "⚠️  GOOGLE_MAPS_API_KEY is not set. Exiting (no geocoding available)."
  );
  process.exit(2);
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (resp) => {
        let data = "";
        resp.on("data", (chunk) => (data += chunk));
        resp.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
}

async function placeDetailsLocation(placeId) {
  if (!placeId) return null;
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(
    placeId
  )}&key=${GOOGLE_KEY}`;
  const data = await httpGetJson(url);
  if (data.status === "OVER_QUERY_LIMIT") {
    await sleep(1000);
    const data2 = await httpGetJson(url);
    if (data2.status !== "OK") return null;
    const loc2 = data2.result?.geometry?.location;
    return loc2 ? { lat: loc2.lat, lng: loc2.lng } : null;
  }
  if (data.status !== "OK") return null;
  const loc = data.result?.geometry?.location;
  return loc ? { lat: loc.lat, lng: loc.lng } : null;
}

async function geocodeAddress(address) {
  if (!address || !address.trim()) return null;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
    address
  )}&key=${GOOGLE_KEY}`;
  const data = await httpGetJson(url);
  if (data.status === "OVER_QUERY_LIMIT") {
    // Backoff and retry once
    await sleep(1000);
    const data2 = await httpGetJson(url);
    if (data2.status !== "OK") return null;
    const loc2 = data2.results?.[0]?.geometry?.location;
    return loc2 ? { lat: loc2.lat, lng: loc2.lng } : null;
  }
  if (data.status !== "OK") return null;
  const loc = data.results?.[0]?.geometry?.location;
  return loc ? { lat: loc.lat, lng: loc.lng } : null;
}

async function backfillSellers() {
  const query = {
    $or: [
      { "location.lat": { $exists: false } },
      { "location.lng": { $exists: false } },
      { "location.lat": null },
      { "location.lng": null },
      { "location.lat": { $not: { $type: "number" } } },
      { "location.lng": { $not: { $type: "number" } } },
    ],
  };
  const sellers = await Seller.find(query)
    .select("business_name address location place_id address_place_id")
    .limit(LIMIT || 0);
  let updated = 0;
  for (const s of sellers) {
    const addr = s.address || s.business_name;
    try {
      let loc = null;
      if (PREFER_PLACE_DETAILS) {
        const pid = s.place_id || s.address_place_id || null;
        if (pid) {
          loc = await placeDetailsLocation(pid);
        }
      }
      if (!loc) {
        loc = await geocodeAddress(addr);
      }
      if (loc) {
        s.location = { lat: loc.lat, lng: loc.lng };
        await s.save();
        updated++;
        console.log(`✅ Seller ${s.business_name}: ${loc.lat}, ${loc.lng}`);
      } else {
        console.log(`⚠️  Failed to geocode seller ${s.business_name}`);
      }
    } catch (e) {
      console.log(`❌ Error geocoding seller ${s.business_name}:`, e.message);
    }
    await sleep(DELAY_MS);
  }
  return { scanned: sellers.length, updated };
}

async function backfillUserAddresses() {
  const query = {
    $or: [
      { "location.lat": { $exists: false } },
      { "location.lng": { $exists: false } },
      { "location.lat": null },
      { "location.lng": null },
      { "location.lat": { $not: { $type: "number" } } },
      { "location.lng": { $not: { $type: "number" } } },
    ],
  };
  const addrs = await UserAddress.find(query)
    .select(
      "user_id full_address street city state pincode location place_id address_place_id"
    )
    .limit(LIMIT || 0);
  let updated = 0;
  for (const a of addrs) {
    const parts = [a.full_address, a.street, a.city, a.state, a.pincode].filter(
      (x) => x && String(x).trim().length > 0
    );
    const addr = parts.join(", ");
    try {
      let loc = null;
      if (PREFER_PLACE_DETAILS) {
        const pid = a.place_id || a.address_place_id || null;
        if (pid) loc = await placeDetailsLocation(pid);
      }
      if (!loc) loc = await geocodeAddress(addr);
      if (loc) {
        a.location = { lat: loc.lat, lng: loc.lng };
        await a.save();
        updated++;
        console.log(`✅ Address for user ${a.user_id}: ${loc.lat}, ${loc.lng}`);
      } else {
        console.log(`⚠️  Failed to geocode address for user ${a.user_id}`);
      }
    } catch (e) {
      console.log(
        `❌ Error geocoding address for user ${a.user_id}:`,
        e.message
      );
    }
    await sleep(DELAY_MS);
  }
  return { scanned: addrs.length, updated };
}

// Also backfill embedded delivery_address on Orders so UIs can use order.delivery.delivery_address.location directly
async function backfillOrderDeliveryAddresses() {
  const query = {
    $or: [
      { "delivery.delivery_address.location.lat": { $exists: false } },
      { "delivery.delivery_address.location.lng": { $exists: false } },
      { "delivery.delivery_address.location.lat": null },
      { "delivery.delivery_address.location.lng": null },
      {
        "delivery.delivery_address.location.lat": { $not: { $type: "number" } },
      },
      {
        "delivery.delivery_address.location.lng": { $not: { $type: "number" } },
      },
    ],
  };
  const orders = await Order.find(query)
    .select("delivery.delivery_address")
    .limit(LIMIT || 0);
  let updated = 0;
  for (const o of orders) {
    try {
      const da = (o.delivery && o.delivery.delivery_address) || {};
      let loc = null;
      // 1) Try linked UserAddress by address_id
      let ua = null;
      if (da.address_id) {
        ua = await UserAddress.findById(da.address_id).lean();
        if (
          ua &&
          ua.location &&
          typeof ua.location.lat === "number" &&
          typeof ua.location.lng === "number"
        ) {
          loc = { lat: ua.location.lat, lng: ua.location.lng };
        }
      }
      // 1a) Legacy: full_address may be an ObjectId string
      if (
        !ua &&
        typeof da.full_address === "string" &&
        /^[0-9a-fA-F]{24}$/.test(da.full_address)
      ) {
        ua = await UserAddress.findById(da.full_address).lean();
        if (
          ua &&
          ua.location &&
          typeof ua.location.lat === "number" &&
          typeof ua.location.lng === "number"
        ) {
          loc = { lat: ua.location.lat, lng: ua.location.lng };
        }
      }
      if (!loc) {
        // 2) If we have a UA but no coords, geocode UA parts and persist back to UA
        if (ua) {
          const parts = [
            ua.full_address,
            ua.street,
            ua.city,
            ua.state,
            ua.pincode,
          ].filter((x) => x && String(x).trim().length > 0);
          const addr = parts.join(", ");
          if (addr) {
            loc = await geocodeAddress(addr);
            if (loc)
              await UserAddress.updateOne(
                { _id: ua._id },
                { $set: { location: { lat: loc.lat, lng: loc.lng } } }
              );
          }
        } else {
          // 3) Geocode embedded full_address if present and not an ObjectId
          const addr =
            typeof da.full_address === "string" &&
            !/^[0-9a-fA-F]{24}$/.test(da.full_address)
              ? da.full_address
              : "";
          if (addr && addr.trim()) loc = await geocodeAddress(addr);
        }
      }
      if (loc) {
        o.delivery = o.delivery || {};
        o.delivery.delivery_address = o.delivery.delivery_address || {};
        o.delivery.delivery_address.location = { lat: loc.lat, lng: loc.lng };
        await o.save();
        updated++;
        console.log(
          `✅ Order ${o._id} delivery_address: ${loc.lat}, ${loc.lng}`
        );
      } else {
        console.log(
          `⚠️  Failed to resolve order ${o._id} delivery_address (no UA match/geocode)`
        );
      }
    } catch (e) {
      console.log(`❌ Error processing order ${o._id}:`, e.message);
    }
    await sleep(DELAY_MS);
  }
  return { scanned: orders.length, updated };
}

async function main() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ Connected to MongoDB for backfill");

    const s = await backfillSellers();
    const u = await backfillUserAddresses();
    const o = await backfillOrderDeliveryAddresses();

    console.log("📊 Backfill Summary:", {
      sellers: s,
      userAddresses: u,
      orders: o,
    });
  } catch (e) {
    console.error("❌ Backfill failed:", e);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
}

main();
