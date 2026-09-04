# Deploy Backend to GCP Cloud Run - Complete Guide

## 🚀 Quick Overview

This guide covers deploying your upgraded Easy App backend to Google Cloud Run with all the new features:

- ✅ Redis caching (optional - recommended via Memorystore)
- ✅ MongoDB backups (optional - requires mongodb-database-tools)
- ✅ New environment variables and secrets
- ✅ Updated dependencies

---

## 📋 Prerequisites

1. **GCP Project Setup**

   - Active GCP project with billing enabled
   - Cloud Run API enabled
   - Secret Manager API enabled
   - Artifact Registry or Container Registry enabled

2. **Local Tools** (for your Codespace)

   - Google Cloud SDK (`gcloud`) installed
   - Docker installed
   - Git

3. **Existing Resources**
   - MongoDB Atlas database (already configured)
   - Firebase project for FCM (already configured)

---

## 🔐 Step 1: Update GCP Secret Manager

Your `.env` file has new secrets that need to be added to Secret Manager.

### New Secrets to Add:

```bash
# 1. JWT_SECRET (NEW - required for admin authentication)
echo -n "BCpc+hirr01edyXIdOaFML/fegOeUMEApUppxmLkOqI=" | gcloud secrets create JWT_SECRET --data-file=-

# 2. ADMIN_API_KEY (NEW - required for admin operations)
echo -n "XL9LxQMQY0ImiZvtWWBlcnJW8Sg16Neghu/pHhTI1wI=" | gcloud secrets create ADMIN_API_KEY --data-file=-

# 3. REDIS_URL (NEW - Upstash Redis configured)
echo -n "rediss://default:AYhbAAIncDIzODI4ZmE4NzQ5OGU0ZjQ0OTQzMDMwZWRhNDE2NWU2ZXAyMzQ5MDc@advanced-bulldog-34907.upstash.io:6379" | gcloud secrets create REDIS_URL --data-file=-

# 4. CDN_PROVIDER (NEW - optional for image optimization)
echo -n "cloudflare" | gcloud secrets create CDN_PROVIDER --data-file=-

# 5. CDN_DOMAIN (NEW - optional)
echo -n "https://cdn.eforeasy.in" | gcloud secrets create CDN_DOMAIN --data-file=-

# 6. CDN_PREFIX (NEW - optional, can be empty)
echo -n "" | gcloud secrets create CDN_PREFIX --data-file=-

# 7. GEOCODE_SERVER_FALLBACK (NEW - for Google Maps)
echo -n "1" | gcloud secrets create GEOCODE_SERVER_FALLBACK --data-file=-

# 8. ALLOWED_ORIGINS (NEW - IMPORTANT for CORS)
echo -n "http://localhost:3000,http://192.168.1.76:3000,https://easy-backend-785621869568.asia-south1.run.app" | gcloud secrets create ALLOWED_ORIGINS --data-file=-
```

### Update Existing Secrets (if values changed):

```bash
# If you need to update an existing secret:
echo -n "NEW_VALUE" | gcloud secrets versions add SECRET_NAME --data-file=-

# Example:
echo -n "NEW_FCM_KEY" | gcloud secrets versions add FCM_SERVER_KEY --data-file=-
```

### Verify All Secrets:

```bash
# List all secrets
gcloud secrets list

# Should show:
# - DB_CONNECTION_STRING ✓
# - DB_NAME ✓
# - FCM_SERVER_KEY ✓
# - FCM_SENDER_ID ✓
# - GOOGLE_MAPS_API_KEY ✓
# - UPI_VPA ✓
# - UPI_PAYER_NAME ✓
# - UPI_NOTE_PREFIX ✓
# - AUTO_VERIFY_CLAIMS ✓
# - JWT_SECRET (NEW) ✓
# - ADMIN_API_KEY (NEW) ✓
# - REDIS_URL (NEW - optional) ✓
# - CDN_PROVIDER (NEW) ✓
# - CDN_DOMAIN (NEW) ✓
# - CDN_PREFIX (NEW) ✓
# - GEOCODE_SERVER_FALLBACK (NEW) ✓
# - ALLOWED_ORIGINS (NEW) ✓
```

---

## 🐳 Step 2: Update Dockerfile (Already Done!)

Your existing Dockerfile is good! It's already optimized for Cloud Run.

**Current Dockerfile features:**

- ✅ Node.js 20 Alpine (lightweight)
- ✅ Production dependencies only
- ✅ PORT=8080 for Cloud Run
- ✅ npm ci for reproducible builds

**No changes needed!**

---

## 📦 Step 3: Update package.json Dependencies

Your package.json already has all required dependencies:

- ✅ `redis` package (not listed, needs to be added!)
- ✅ `bcryptjs` for password hashing ✓
- ✅ `jsonwebtoken` for JWT auth ✓
- ✅ All other deps are current ✓

### ⚠️ IMPORTANT: Add Redis Dependency

```bash
# In your Codespace, run:
cd Backend
npm install redis
```

This will update your `package.json` and `package-lock.json`.

---

## 🔴 Step 4: Redis Setup Options

You have **3 options** for Redis:

### Option 1: Upstash Redis (Already Configured!) ⭐

**Best for most deployments - You're using this!**

✅ **Already set up and working!** Your local logs show:

```
Redis: Connected and ready
✅ Redis caching enabled
```

**What you have:**

- ✅ Upstash Redis database created
- ✅ Connection string: `rediss://default:...@advanced-bulldog-34907.upstash.io:6379`
- ✅ Free tier: 10,000 requests/day
- ✅ Global edge network
- ✅ TLS encryption enabled

**For deployment:**

- Use your Upstash connection string in `REDIS_URL` secret
- No VPC setup needed
- Works immediately on Cloud Run

### Option 2: GCP Memorystore (Production - Recommended Later) 🚀

**Best for production with high traffic**

```bash
# Create Memorystore Redis instance
gcloud redis instances create easy-redis \
  --size=1 \
  --region=asia-south1 \
  --tier=basic \
  --redis-version=redis_7_0

# Get the Redis host IP
gcloud redis instances describe easy-redis --region=asia-south1 --format="get(host)"

# Update REDIS_URL secret
echo -n "redis://REDIS_HOST_IP:6379" | gcloud secrets versions add REDIS_URL --data-file=-
```

**⚠️ Important Notes:**

- Memorystore requires VPC Connector (additional setup)
- Costs ~$30-40/month for basic tier
- Best for production with 1000+ daily users

**VPC Setup (if using Memorystore):**

```bash
# Create VPC Connector
gcloud compute networks vpc-access connectors create easy-connector \
  --region=asia-south1 \
  --range=10.8.0.0/28

# Add to Cloud Run deployment:
--vpc-connector=easy-connector
```

### Option 3: Skip Redis (Not Recommended - You Have It Already!)

**You can skip this - you already have Upstash configured!**

If you ever need to disable Redis:

- Set `REDIS_URL` to a dummy value or remove it
- App will log: "⚠️ Redis not available - caching disabled"
- Everything else works, but API calls will be slower

---

## 🗄️ Step 5: MongoDB Backup Tools (Optional)

Your backup script (`scripts/backup-db.js`) requires `mongodump` to be installed.

### Option 1: Skip Automated Backups (Recommended) ⭐

**MongoDB Atlas already has automatic backups!**

- ✅ Atlas provides point-in-time recovery
- ✅ Daily snapshots
- ✅ No extra setup needed

**To disable the backup script:**
Your app already handles this gracefully - if `mongodump` isn't found, backups are disabled automatically.

### Option 2: Install in Docker (Advanced)

If you want backups from Cloud Run, update your Dockerfile:

```dockerfile
FROM node:20-alpine

# Install MongoDB Database Tools
RUN apk add --no-cache mongodb-tools

# ... rest of Dockerfile stays the same
```

**Note:** This increases image size by ~50MB.

---

## 🚢 Step 6: Build and Deploy

### From Your Codespace (Recommended):

```bash
# 1. Navigate to Backend directory
cd Backend

# 2. Set your GCP project
gcloud config set project YOUR_PROJECT_ID

# 3. Build and push Docker image to Artifact Registry
# (Replace REGION and PROJECT_ID)
gcloud builds submit --tag asia-south1-docker.pkg.dev/YOUR_PROJECT_ID/cloud-run-source-deploy/easy-backend

# 4. Deploy to Cloud Run with ALL secrets
gcloud run deploy easy-backend \
  --image asia-south1-docker.pkg.dev/YOUR_PROJECT_ID/cloud-run-source-deploy/easy-backend \
  --region asia-south1 \
  --allow-unauthenticated \
  --platform managed \
  --memory 512Mi \
  --cpu 1 \
  --timeout 300 \
  --max-instances 10 \
  --set-secrets "\
DB_CONNECTION_STRING=DB_CONNECTION_STRING:latest,\
DB_NAME=DB_NAME:latest,\
FCM_SERVER_KEY=FCM_SERVER_KEY:latest,\
FCM_SENDER_ID=FCM_SENDER_ID:latest,\
GOOGLE_MAPS_API_KEY=GOOGLE_MAPS_API_KEY:latest,\
UPI_VPA=UPI_VPA:latest,\
UPI_PAYER_NAME=UPI_PAYER_NAME:latest,\
UPI_NOTE_PREFIX=UPI_NOTE_PREFIX:latest,\
AUTO_VERIFY_CLAIMS=AUTO_VERIFY_CLAIMS:latest,\
JWT_SECRET=JWT_SECRET:latest,\
ADMIN_API_KEY=ADMIN_API_KEY:latest,\
REDIS_URL=REDIS_URL:latest,\
CDN_PROVIDER=CDN_PROVIDER:latest,\
CDN_DOMAIN=CDN_DOMAIN:latest,\
CDN_PREFIX=CDN_PREFIX:latest,\
GEOCODE_SERVER_FALLBACK=GEOCODE_SERVER_FALLBACK:latest,\
ALLOWED_ORIGINS=ALLOWED_ORIGINS:latest" \
  --set-env-vars "\
NODE_ENV=production,\
PORT=8080"
```

### Alternative: Using Container Registry (Your Old Method):

```bash
# 1. Build and tag image
docker build -t gcr.io/YOUR_PROJECT_ID/easy-backend:latest .

# 2. Push to Container Registry
docker push gcr.io/YOUR_PROJECT_ID/easy-backend:latest

# 3. Deploy (same command as above, but with different image path)
gcloud run deploy easy-backend \
  --image gcr.io/YOUR_PROJECT_ID/easy-backend:latest \
  # ... rest same as above
```

---

## ✅ Step 7: Post-Deployment Verification

### 1. Check Deployment Status

```bash
# Get service URL
gcloud run services describe easy-backend --region=asia-south1 --format="value(status.url)"

# Check logs
gcloud run logs tail easy-backend --region=asia-south1
```

### 2. Test Health Endpoint

```bash
# Replace with your actual Cloud Run URL
curl https://easy-backend-XXXXX.asia-south1.run.app/health

# Expected response:
# {
#   "status": "OK",
#   "version": "1.0.0",
#   "timestamp": "2024-11-09T...",
#   "services": {
#     "database": "connected",
#     "redis": true/false,
#     "firebase": true
#   }
# }
```

### 3. Check Redis Status

Look in logs for:

- ✅ "Redis: Connecting..."
- ✅ "Redis: Connected and ready"
- ✅ "✅ Redis caching enabled"

This confirms Upstash Redis is working on Cloud Run!

### 4. Test Admin Login

```bash
# Test admin authentication
curl -X POST https://YOUR_CLOUD_RUN_URL/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"your_password"}'

# Should return JWT token
```

### 5. Check Environment Variables

```bash
# List all environment variables for the service
gcloud run services describe easy-backend --region=asia-south1 --format=yaml | grep -A 20 env
```

---

## 🔧 Step 8: Update Frontend Configuration

After deployment, update your Flutter app's API URL:

### Option 1: Environment Variable (Recommended)

```dart
// In your Flutter app's build command:
flutter build apk --dart-define=API_BASE_URL=https://your-cloud-run-url.run.app
```

### Option 2: Update in Code

```dart
// Find in your Flutter code and update:
const String apiBaseUrl = 'https://easy-backend-XXXXX.asia-south1.run.app';
```

### Update CORS Origins

Don't forget to update the `ALLOWED_ORIGINS` secret to include your Cloud Run URL:

```bash
echo -n "https://your-cloud-run-url.run.app,http://localhost:3000" | gcloud secrets versions add ALLOWED_ORIGINS --data-file=-

# Then redeploy to pick up the new secret
gcloud run services update easy-backend --region=asia-south1
```

---

## 📊 Step 9: Monitoring and Debugging

### View Logs

```bash
# Real-time logs
gcloud run logs tail easy-backend --region=asia-south1 --follow

# Last 100 lines
gcloud run logs read easy-backend --region=asia-south1 --limit=100

# Filter for errors
gcloud run logs read easy-backend --region=asia-south1 --filter="severity>=ERROR"
```

### Check Metrics

```bash
# Open Cloud Console
gcloud run services describe easy-backend --region=asia-south1

# Or visit:
# https://console.cloud.google.com/run/detail/asia-south1/easy-backend
```

### Common Issues

#### Issue: "SECRET_NAME not found"

```bash
# Verify secret exists
gcloud secrets describe SECRET_NAME

# If missing, create it (see Step 1)
```

#### Issue: "Redis connection error"

```bash
# Check logs - if Redis is optional, this is OK
# Look for: "⚠️ Redis not available - caching disabled"

# If you want Redis, follow Step 4
```

#### Issue: "Database connection failed"

```bash
# Verify DB_CONNECTION_STRING secret
gcloud secrets versions access latest --secret=DB_CONNECTION_STRING

# Check MongoDB Atlas firewall:
# - Allow all IPs: 0.0.0.0/0 (for Cloud Run)
```

#### Issue: "CORS error from frontend"

```bash
# Update ALLOWED_ORIGINS secret with your Cloud Run URL
echo -n "https://your-cloud-run-url.run.app" | gcloud secrets versions add ALLOWED_ORIGINS --data-file=-

# Redeploy
gcloud run services update easy-backend --region=asia-south1
```

---

## 💰 Cost Optimization

### Current Setup (Minimal Cost):

- Cloud Run: ~$5-10/month (for small traffic)
- Secret Manager: ~$0.30/month
- MongoDB Atlas: Free tier (512MB) or $0-9/month
- **Total: ~$5-20/month**

### With Redis (Memorystore):

- Add ~$30-40/month for basic tier
- **Total: ~$35-60/month**

### Tips:

1. Use Cloud Run's free tier: 2 million requests/month
2. Minimize container size (already optimized)
3. Use `--max-instances=10` to prevent unexpected scaling
4. Monitor with Cloud Monitoring (free tier)

---

## 🔄 Update Workflow (For Future Deployments)

### Quick Update Script:

Save this as `deploy.sh` in your Backend folder:

```bash
#!/bin/bash
set -e

PROJECT_ID="your-project-id"
REGION="asia-south1"
SERVICE_NAME="easy-backend"

echo "🏗️  Building and deploying to Cloud Run..."

# Build and submit
gcloud builds submit --tag ${REGION}-docker.pkg.dev/${PROJECT_ID}/cloud-run-source-deploy/${SERVICE_NAME}

# Deploy
gcloud run deploy ${SERVICE_NAME} \
  --image ${REGION}-docker.pkg.dev/${PROJECT_ID}/cloud-run-source-deploy/${SERVICE_NAME} \
  --region ${REGION} \
  --allow-unauthenticated \
  --platform managed \
  --memory 512Mi \
  --cpu 1 \
  --timeout 300 \
  --max-instances 10 \
  --set-secrets "\
DB_CONNECTION_STRING=DB_CONNECTION_STRING:latest,\
DB_NAME=DB_NAME:latest,\
FCM_SERVER_KEY=FCM_SERVER_KEY:latest,\
FCM_SENDER_ID=FCM_SENDER_ID:latest,\
GOOGLE_MAPS_API_KEY=GOOGLE_MAPS_API_KEY:latest,\
UPI_VPA=UPI_VPA:latest,\
UPI_PAYER_NAME=UPI_PAYER_NAME:latest,\
UPI_NOTE_PREFIX=UPI_NOTE_PREFIX:latest,\
AUTO_VERIFY_CLAIMS=AUTO_VERIFY_CLAIMS:latest,\
JWT_SECRET=JWT_SECRET:latest,\
ADMIN_API_KEY=ADMIN_API_KEY:latest,\
REDIS_URL=REDIS_URL:latest,\
CDN_PROVIDER=CDN_PROVIDER:latest,\
CDN_DOMAIN=CDN_DOMAIN:latest,\
CDN_PREFIX=CDN_PREFIX:latest,\
GEOCODE_SERVER_FALLBACK=GEOCODE_SERVER_FALLBACK:latest,\
ALLOWED_ORIGINS=ALLOWED_ORIGINS:latest" \
  --set-env-vars "NODE_ENV=production,PORT=8080"

echo "✅ Deployment complete!"
echo "🌐 URL: $(gcloud run services describe ${SERVICE_NAME} --region=${REGION} --format='value(status.url)')"
```

Usage:

```bash
chmod +x deploy.sh
./deploy.sh
```

---

## 📋 Pre-Deployment Checklist

Before deploying, verify:

- [ ] All secrets created in Secret Manager (Step 1)
- [ ] `redis` npm package added to package.json
- [ ] MongoDB Atlas allows connections from 0.0.0.0/0
- [ ] Firebase service account key file included in Backend folder
- [ ] Decided on Redis option (or skipping it)
- [ ] gcloud CLI authenticated and project set
- [ ] Backend code pushed to Codespace
- [ ] Docker available in Codespace

---

## 🎯 Recommended Deployment Strategy

### For Your First Deployment:

1. ✅ **Redis already configured** - Upstash connection working locally!
2. ✅ **Skip MongoDB backup tools** - Atlas already backs up
3. ✅ **Add all new secrets** to Secret Manager (including Upstash REDIS_URL)
4. ✅ **Deploy with updated command** (all secrets included)
5. ✅ **Test thoroughly** before updating mobile app
6. ✅ **Enjoy Redis caching** on Cloud Run!

### Command Summary:

```bash
# 1. Add redis package
npm install redis

# 2. Create new secrets (see Step 1)
gcloud secrets create JWT_SECRET --data-file=-
gcloud secrets create ADMIN_API_KEY --data-file=-
# ... etc

# 3. Build and deploy
gcloud builds submit --tag asia-south1-docker.pkg.dev/PROJECT_ID/cloud-run-source-deploy/easy-backend

gcloud run deploy easy-backend \
  --image asia-south1-docker.pkg.dev/PROJECT_ID/cloud-run-source-deploy/easy-backend \
  --region asia-south1 \
  --allow-unauthenticated \
  --set-secrets "DB_CONNECTION_STRING=DB_CONNECTION_STRING:latest,DB_NAME=DB_NAME:latest,FCM_SERVER_KEY=FCM_SERVER_KEY:latest,FCM_SENDER_ID=FCM_SENDER_ID:latest,GOOGLE_MAPS_API_KEY=GOOGLE_MAPS_API_KEY:latest,UPI_VPA=UPI_VPA:latest,UPI_PAYER_NAME=UPI_PAYER_NAME:latest,UPI_NOTE_PREFIX=UPI_NOTE_PREFIX:latest,AUTO_VERIFY_CLAIMS=AUTO_VERIFY_CLAIMS:latest,JWT_SECRET=JWT_SECRET:latest,ADMIN_API_KEY=ADMIN_API_KEY:latest,REDIS_URL=REDIS_URL:latest,CDN_PROVIDER=CDN_PROVIDER:latest,CDN_DOMAIN=CDN_DOMAIN:latest,CDN_PREFIX=CDN_PREFIX:latest,GEOCODE_SERVER_FALLBACK=GEOCODE_SERVER_FALLBACK:latest,ALLOWED_ORIGINS=ALLOWED_ORIGINS:latest" \
  --set-env-vars "NODE_ENV=production,PORT=8080"

# 4. Verify deployment
curl https://YOUR_CLOUD_RUN_URL/health
```

---

## 🆘 Need Help?

### Documentation:

- Cloud Run: https://cloud.google.com/run/docs
- Secret Manager: https://cloud.google.com/secret-manager/docs
- Memorystore: https://cloud.google.com/memorystore/docs/redis

### Common Commands:

```bash
# List services
gcloud run services list

# Describe service
gcloud run services describe easy-backend --region=asia-south1

# Delete service (if needed)
gcloud run services delete easy-backend --region=asia-south1

# List secrets
gcloud secrets list

# View secret value
gcloud secrets versions access latest --secret=SECRET_NAME
```

---

## ✨ Summary

**What Changed:**

- 🔐 New secrets: JWT_SECRET, ADMIN_API_KEY, CDN config, ALLOWED_ORIGINS
- 🔴 Redis support (optional, gracefully degraded)
- 📦 New npm dependency: `redis`
- 🗄️ MongoDB backup tools (optional, not needed for Cloud Run)

**What to Do:**

1. Add `redis` to package.json: `npm install redis`
2. Create new secrets in Secret Manager
3. Deploy with updated `gcloud run deploy` command
4. Skip Redis for now (or use Upstash for easy setup)
5. Skip MongoDB backup tools (Atlas already backs up)

**Result:**

- ✅ Backend with admin password change feature
- ✅ Graceful Redis fallback (no caching if unavailable)
- ✅ All new authentication features working
- ✅ CDN support enabled
- ✅ Production-ready deployment

**Deployment Time:** ~10-15 minutes (first time), ~3-5 minutes (updates)

---

**Ready to deploy! 🚀**
