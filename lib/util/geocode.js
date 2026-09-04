const https = require("https");

const API_KEY = process.env.GOOGLE_MAPS_API_KEY || "";
const ENABLED = String(process.env.GEOCODE_SERVER_FALLBACK || "0") === "1";

// Simple in-memory caches
const reverseCache = new Map(); // key: "lat,lng" -> { addr, exp }
const placeCache = new Map(); // key: placeId -> { addr, exp }

const TTL_MS = 24 * 60 * 60 * 1000; // 24h

function _getJSON(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
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

async function reverseGeocode(lat, lng) {
  if (!ENABLED || !API_KEY) return null;
  const key = `${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`;
  const hit = reverseCache.get(key);
  const now = Date.now();
  if (hit && hit.exp > now) return hit.addr;
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${API_KEY}`;
    const json = await _getJSON(url);
    if (
      json &&
      json.status === "OK" &&
      Array.isArray(json.results) &&
      json.results.length
    ) {
      const addr = json.results[0].formatted_address;
      reverseCache.set(key, { addr, exp: now + TTL_MS });
      return addr;
    }
  } catch (_) {}
  return null;
}

async function placeDetails(placeId) {
  if (!ENABLED || !API_KEY || !placeId) return null;
  const key = String(placeId);
  const hit = placeCache.get(key);
  const now = Date.now();
  if (hit && hit.exp > now) return hit.addr;
  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(
      key
    )}&fields=formatted_address&key=${API_KEY}`;
    const json = await _getJSON(url);
    const addr = json?.result?.formatted_address;
    if (addr) {
      placeCache.set(key, { addr, exp: now + TTL_MS });
      return addr;
    }
  } catch (_) {}
  return null;
}

module.exports = { reverseGeocode, placeDetails, ENABLED };
