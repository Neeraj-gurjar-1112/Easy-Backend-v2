require("module-alias/register");
#!/usr/bin/env node

/**
 * Migration Script: Add Coordinates to Existing Sellers
 *
 * Purpose: Find all sellers without location coordinates and geocode their addresses
 * to ensure all sellers have valid lat/lng for delivery agent navigation.
 *
 * Usage: node Backend/scripts/migrate_seller_locations.js
 *
 * Prerequisites:
 * 1. MONGODB_URI environment variable set
 * 2. GOOGLE_MAPS_API_KEY environment variable set (for geocoding)
 *
 * Safety:
 * - Dry run mode by default (set DRY_RUN=false to apply changes)
 * - Logs all changes to migration-log.txt
 * - Does not modify sellers that already have coordinates
 */

require("dotenv").config();
const mongoose = require("mongoose");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// Import models
const { Seller } = require("../lib/models");

// Configuration
const DRY_RUN = process.env.DRY_RUN !== "false"; // Default: true (no changes)
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const LOG_FILE = path.join(__dirname, "migration-log.txt");

// Geocoding function with retry logic
async function geocodeAddress(address, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(
        "https://maps.googleapis.com/maps/api/geocode/json",
        {
          params: {
            address: address,
            key: GOOGLE_MAPS_API_KEY,
          },
          timeout: 10000, // 10 second timeout
        },
      );

      if (response.data.status === "OK" && response.data.results[0]) {
        const result = response.data.results[0];
        return {
          lat: result.geometry.location.lat,
          lng: result.geometry.location.lng,
          formattedAddress: result.formatted_address,
          placeId: result.place_id,
          status: "OK",
        };
      } else if (response.data.status === "ZERO_RESULTS") {
        return {
          status: "ZERO_RESULTS",
          error: "No geocoding results found for this address",
        };
      } else {
        return {
          status: response.data.status,
          error: response.data.error_message || "Geocoding failed",
        };
      }
    } catch (error) {
      console.error(`Geocoding attempt ${attempt} failed:`, error.message);
      if (attempt === retries) {
        return {
          status: "ERROR",
          error: error.message,
        };
      }
      // Wait before retry (exponential backoff)
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
}

// Log function
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  console.log(logMessage.trim());
  fs.appendFileSync(LOG_FILE, logMessage);
}

// Main migration function
async function migrateSellers() {
  log("=".repeat(80));
  log("SELLER LOCATION MIGRATION STARTED");
  log("=".repeat(80));
  log(
    `DRY RUN MODE: ${DRY_RUN ? "ENABLED (no changes will be saved)" : "DISABLED (changes will be saved)"}`,
  );
  log("");

  if (!GOOGLE_MAPS_API_KEY) {
    log("ERROR: GOOGLE_MAPS_API_KEY not set in environment variables");
    log("Set it using: export GOOGLE_MAPS_API_KEY=your_api_key");
    process.exit(1);
  }

  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    log("✅ Connected to MongoDB");
    log("");

    // Find sellers without location coordinates
    const sellersWithoutLocation = await Seller.find({
      $or: [
        { "location.lat": { $exists: false } },
        { "location.lng": { $exists: false } },
        { "location.lat": null },
        { "location.lng": null },
      ],
    });

    log(`Found ${sellersWithoutLocation.length} sellers without coordinates`);
    log("");

    if (sellersWithoutLocation.length === 0) {
      log("✅ All sellers already have coordinates. Nothing to migrate.");
      return;
    }

    const results = {
      total: sellersWithoutLocation.length,
      success: 0,
      failed: 0,
      noResults: 0,
      errors: [],
    };

    // Process each seller
    for (let i = 0; i < sellersWithoutLocation.length; i++) {
      const seller = sellersWithoutLocation[i];
      log(
        `[${i + 1}/${sellersWithoutLocation.length}] Processing: ${seller.business_name}`,
      );
      log(`  Address: ${seller.address || "NO ADDRESS"}`);

      if (!seller.address || seller.address.trim() === "") {
        log(`  ⚠️  SKIP: No address provided for ${seller.business_name}`);
        results.failed++;
        results.errors.push({
          seller: seller.business_name,
          email: seller.email,
          reason: "No address provided",
        });
        log("");
        continue;
      }

      // Geocode the address
      log(`  🔍 Geocoding address...`);
      const geocodeResult = await geocodeAddress(seller.address);

      if (geocodeResult.status === "OK") {
        log(`  ✅ Geocoding successful`);
        log(`     Coordinates: ${geocodeResult.lat}, ${geocodeResult.lng}`);
        log(`     Formatted: ${geocodeResult.formattedAddress}`);

        if (!DRY_RUN) {
          try {
            seller.location = {
              lat: geocodeResult.lat,
              lng: geocodeResult.lng,
            };
            // Update place_id if not already set
            if (!seller.place_id && geocodeResult.placeId) {
              seller.place_id = geocodeResult.placeId;
            }
            // Optionally update address to formatted version
            // seller.address = geocodeResult.formattedAddress;

            await seller.save();
            log(`  💾 Saved to database`);
            results.success++;
          } catch (error) {
            log(`  ❌ Database save failed: ${error.message}`);
            results.failed++;
            results.errors.push({
              seller: seller.business_name,
              email: seller.email,
              reason: `Database save failed: ${error.message}`,
            });
          }
        } else {
          log(`  🔒 DRY RUN: Would save coordinates`);
          results.success++; // Count as success in dry run
        }
      } else if (geocodeResult.status === "ZERO_RESULTS") {
        log(`  ⚠️  No results found for this address`);
        results.noResults++;
        results.errors.push({
          seller: seller.business_name,
          email: seller.email,
          address: seller.address,
          reason: "Geocoding returned zero results",
        });
      } else {
        log(`  ❌ Geocoding failed: ${geocodeResult.error}`);
        results.failed++;
        results.errors.push({
          seller: seller.business_name,
          email: seller.email,
          address: seller.address,
          reason: geocodeResult.error,
        });
      }

      log("");

      // Rate limiting: wait 200ms between requests (max 5 requests/second)
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    // Summary
    log("=".repeat(80));
    log("MIGRATION SUMMARY");
    log("=".repeat(80));
    log(`Total sellers processed: ${results.total}`);
    log(`Successfully geocoded: ${results.success}`);
    log(`No results found: ${results.noResults}`);
    log(`Failed: ${results.failed}`);
    log("");

    if (results.errors.length > 0) {
      log("SELLERS REQUIRING MANUAL ATTENTION:");
      log("-".repeat(80));
      results.errors.forEach((error, index) => {
        log(`${index + 1}. ${error.seller} (${error.email})`);
        log(`   Reason: ${error.reason}`);
        if (error.address) {
          log(`   Address: ${error.address}`);
        }
        log("");
      });
    }

    if (DRY_RUN) {
      log("⚠️  DRY RUN MODE: No changes were saved to database");
      log(
        "To apply changes, run: DRY_RUN=false node Backend/scripts/migrate_seller_locations.js",
      );
    } else {
      log("✅ Migration complete. Changes saved to database.");
    }
    log("=".repeat(80));
  } catch (error) {
    log(`FATAL ERROR: ${error.message}`);
    log(error.stack);
    throw error;
  } finally {
    // Disconnect from MongoDB
    await mongoose.disconnect();
    log("Disconnected from MongoDB");
  }
}

// Run migration
if (require.main === module) {
  migrateSellers()
    .then(() => {
      log("Migration script completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      log(`Migration script failed: ${error.message}`);
      process.exit(1);
    });
}

module.exports = { migrateSellers, geocodeAddress };
