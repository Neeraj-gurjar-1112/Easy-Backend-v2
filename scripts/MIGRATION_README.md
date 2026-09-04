# Seller Location Migration Script

## Purpose

This script finds all sellers in the database that are missing location coordinates (lat/lng) and uses Google Maps Geocoding API to convert their addresses into coordinates.

## Why This Is Needed

After implementing the fix for null seller addresses in the delivery agent dashboard, we made seller location coordinates **required**. However, existing sellers in the database may not have coordinates. This script fills in the missing data.

## Prerequisites

1. **MongoDB Connection**: `MONGODB_URI` environment variable must be set
2. **Google Maps API Key**: `GOOGLE_MAPS_API_KEY` environment variable must be set
   - Enable Geocoding API in your Google Cloud Console
   - Generate an API key
   - Set billing (free tier usually sufficient for small-scale migrations)

## Usage

### Dry Run (Preview Changes - Safe)

```bash
# Preview what changes would be made WITHOUT saving to database
node Backend/scripts/migrate_seller_locations.js

# OR explicitly set dry run mode
DRY_RUN=true node Backend/scripts/migrate_seller_locations.js
```

### Apply Changes (Save to Database)

```bash
# ACTUALLY save changes to database
DRY_RUN=false node Backend/scripts/migrate_seller_locations.js
```

## What It Does

1. **Finds Sellers** without coordinates:
   - `location.lat` is null, undefined, or missing
   - `location.lng` is null, undefined, or missing

2. **Geocodes Addresses**:
   - Uses Google Maps Geocoding API
   - Converts text address to lat/lng coordinates
   - Retrieves formatted address and place_id

3. **Updates Database**:
   - Saves coordinates to `seller.location.lat/lng`
   - Optionally updates `place_id` if not already set
   - Logs all changes to `migration-log.txt`

4. **Handles Errors**:
   - Retries failed geocoding requests (up to 3 attempts)
   - Logs sellers that couldn't be geocoded
   - Reports sellers with missing addresses

## Output

### Console Output

```
================================================================================
SELLER LOCATION MIGRATION STARTED
================================================================================
DRY RUN MODE: ENABLED (no changes will be saved)

✅ Connected to MongoDB

Found 15 sellers without coordinates

[1/15] Processing: Joe's Restaurant
  Address: 123 Main St, New York, NY
  🔍 Geocoding address...
  ✅ Geocoding successful
     Coordinates: 40.7128, -74.0060
     Formatted: 123 Main Street, New York, NY 10001, USA
  🔒 DRY RUN: Would save coordinates

[2/15] Processing: Maria's Grocery
  Address: Invalid address
  🔍 Geocoding address...
  ⚠️  No results found for this address

================================================================================
MIGRATION SUMMARY
================================================================================
Total sellers processed: 15
Successfully geocoded: 12
No results found: 2
Failed: 1

SELLERS REQUIRING MANUAL ATTENTION:
--------------------------------------------------------------------------------
1. Maria's Grocery (maria@example.com)
   Reason: Geocoding returned zero results
   Address: Invalid address

2. Bob's Store (bob@example.com)
   Reason: No address provided
```

### Log File

All output is also written to `Backend/scripts/migration-log.txt` with timestamps:

```
[2024-01-20T10:30:00.000Z] SELLER LOCATION MIGRATION STARTED
[2024-01-20T10:30:01.234Z] ✅ Connected to MongoDB
[2024-01-20T10:30:02.567Z] Found 15 sellers without coordinates
...
```

## Error Handling

### No Geocoding Results

- **Cause**: Invalid or incomplete address
- **Action**: Contact seller to provide correct address, then update manually or re-run script

### Geocoding API Errors

- **Cause**: API quota exceeded, network error, invalid API key
- **Action**: Check API key, billing, and quotas in Google Cloud Console

### Missing Address

- **Cause**: Seller registered without providing address (old data)
- **Action**: Contact seller to provide address, update manually

### Database Save Errors

- **Cause**: Validation errors, connection issues
- **Action**: Check error message, verify schema, retry

## Safety Features

1. **Dry Run by Default**: No changes saved unless explicitly disabled
2. **Comprehensive Logging**: All actions logged to file
3. **Retry Logic**: 3 attempts with exponential backoff for failed requests
4. **Rate Limiting**: 200ms delay between requests (5 requests/second)
5. **No Overwrites**: Only updates sellers WITHOUT coordinates (preserves existing data)

## Cost Estimation

Google Maps Geocoding API pricing (as of 2024):

- First 40,000 requests/month: $5 per 1,000 requests
- $0.005 per request after free tier

Example:

- 100 sellers to migrate = 100 requests = $0.50
- 500 sellers to migrate = 500 requests = $2.50

## Manual Fixes Required

After running the script, some sellers may require manual attention:

### Sellers with Invalid Addresses

```sql
-- Find sellers that still don't have coordinates after migration
db.sellers.find({
  $or: [
    { 'location.lat': null },
    { 'location.lng': null },
    { 'location.lat': { $exists: false } },
    { 'location.lng': { $exists: false } }
  ]
})
```

### Manual Update Process

1. **Contact Seller**: Ask for correct address or coordinates
2. **Update via Admin Panel** or MongoDB:

```javascript
// Update seller with coordinates
db.sellers.updateOne(
  { _id: ObjectId("seller_id_here") },
  {
    $set: {
      address: "123 Main St, City, State, ZIP",
      location: {
        lat: 40.7128,
        lng: -74.006,
      },
      place_id: "ChIJOwg_06VPwokRYv534QaPC8g",
    },
  },
);
```

## Testing

### Test with One Seller

```javascript
// In MongoDB shell or Compass
// Create a test seller without coordinates
db.sellers.insertOne({
  business_name: "Test Store",
  email: "test@example.com",
  phone: "1234567890",
  business_type: "grocery",
  approved: false,
  address: "1600 Amphitheatre Parkway, Mountain View, CA"
  // Note: no location field
})

// Run migration in dry run mode
DRY_RUN=true node Backend/scripts/migrate_seller_locations.js

// Check log output - should show:
// ✅ Geocoding successful
// Coordinates: 37.4220, -122.0841

// Apply changes
DRY_RUN=false node Backend/scripts/migrate_seller_locations.js

// Verify in database
db.sellers.findOne({ email: "test@example.com" })
// Should now have location: { lat: 37.4220, lng: -122.0841 }
```

## Troubleshooting

### "GOOGLE_MAPS_API_KEY not set"

```bash
export GOOGLE_MAPS_API_KEY=your_api_key_here
# Or add to .env file:
echo "GOOGLE_MAPS_API_KEY=your_api_key_here" >> .env
```

### "MongoDB connection failed"

```bash
export MONGODB_URI=mongodb://localhost:27017/your_database
# Or check .env file
```

### "Request failed with status code 403"

- Check API key is valid
- Verify Geocoding API is enabled in Google Cloud Console
- Check API key restrictions (IP, domain, API restrictions)

### "OVER_QUERY_LIMIT"

- API quota exceeded
- Wait for quota reset (daily)
- Enable billing in Google Cloud Console
- Increase quota limits

### High API Costs

- Run dry run first to estimate number of requests
- Process sellers in batches
- Manually fix obvious address errors before running script

## Alternative: Manual Geocoding

If you prefer not to use Google Maps API:

1. **Export sellers without coordinates**:

```javascript
db.sellers
  .find(
    { $or: [{ "location.lat": null }, { "location.lng": null }] },
    { business_name: 1, email: 1, address: 1 },
  )
  .toArray();
```

2. **Use online geocoding tool**:
   - https://www.latlong.net/convert-address-to-lat-long.html
   - Copy/paste addresses one by one

3. **Update manually**:

```javascript
db.sellers.updateOne(
  { email: "seller@example.com" },
  { $set: { location: { lat: 40.7128, lng: -74.006 } } },
);
```

## Post-Migration Verification

```javascript
// Check all sellers now have coordinates
db.sellers.countDocuments({
  "location.lat": { $exists: true, $ne: null },
  "location.lng": { $exists: true, $ne: null },
});

// Should match total seller count
db.sellers.countDocuments({});

// Find any remaining sellers without coordinates
db.sellers.find({
  $or: [
    { "location.lat": { $exists: false } },
    { "location.lng": { $exists: false } },
    { "location.lat": null },
    { "location.lng": null },
  ],
});
```

## Summary

- ✅ **Safe**: Dry run by default, comprehensive logging
- ✅ **Automated**: Batch geocoding with retry logic
- ✅ **Cost-effective**: ~$0.005 per seller
- ✅ **Verifiable**: Detailed logs and error reporting
- ✅ **Idempotent**: Can re-run safely, won't overwrite existing coordinates

## Next Steps

1. Run dry run to preview changes
2. Review log output for any issues
3. Apply changes with `DRY_RUN=false`
4. Manually fix sellers that couldn't be geocoded
5. Verify all sellers have coordinates
6. Test delivery agent dashboard shows seller locations

---

**Status**: Ready to use
**Last Updated**: 2024-01-20
