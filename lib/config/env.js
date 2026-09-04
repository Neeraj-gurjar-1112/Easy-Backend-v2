/**
 * Environment loader.
 *
 * Load order (later wins):
 *   1. <root>/.env              shared by every service
 *   2. <root>/.env.<service>    per-service overrides (app | admin | socket)
 *
 * load("all") (used by server.js and the test harness) reads only the shared file.
 */
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

const ROOT = path.resolve(__dirname, "..", "..");
let loadedFor = null;

function load(service = "all") {
  if (loadedFor) return ROOT;
  const shared = path.join(ROOT, ".env");
  if (fs.existsSync(shared)) dotenv.config({ path: shared });
  if (service && service !== "all") {
    const specific = path.join(ROOT, `.env.${service}`);
    if (fs.existsSync(specific)) dotenv.config({ path: specific, override: true });
  }
  process.env.SERVICE_NAME = process.env.SERVICE_NAME || service;
  loadedFor = service;
  return ROOT;
}

module.exports = { load, ROOT };
