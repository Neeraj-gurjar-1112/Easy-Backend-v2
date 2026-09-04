# 📋 GCP Cloud Run Deployment Checklist

Use this checklist to ensure a smooth deployment to Google Cloud Run.

---

## Pre-Deployment Preparation

### Local Changes (On Your Windows PC)

- [ ] Backend code is up to date with all recent changes
- [ ] `.env` file exists in Backend/ with all required values
- [ ] Firebase service account JSON file exists in Backend/
- [ ] All recent features tested locally:
  - [ ] Admin password change works
  - [ ] New authentication endpoints work
  - [ ] App runs without Redis (check logs)

### Upload to Codespace

- [ ] Upload entire Backend/ folder to GitHub Codespace
- [ ] Verify all files transferred correctly
- [ ] `.env` file present in Codespace
- [ ] Firebase JSON file present in Codespace

---

## In Your GitHub Codespace (Linux)

### 1. Environment Setup

- [ ] gcloud CLI installed (`gcloud --version`)
- [ ] Docker installed (`docker --version`)
- [ ] Authenticated with gcloud (`gcloud auth list`)
- [ ] Correct GCP project set (`gcloud config get-value project`)

### 2. Install Dependencies

```bash
cd Backend
npm install redis
```

- [ ] Redis package added to package.json
- [ ] package-lock.json updated
- [ ] No npm errors

### 3. Secret Manager Setup

**Option A: Automated (Recommended)**

```bash
chmod +x setup-secrets.sh
./setup-secrets.sh
```

**Option B: Manual**
Create each secret individually (see DEPLOY_QUICK_START.md)

**Verify all secrets created:**

```bash
gcloud secrets list
```

Required secrets checklist:

- [ ] DB_CONNECTION_STRING
- [ ] DB_NAME
- [ ] FCM_SERVER_KEY
- [ ] FCM_SENDER_ID
- [ ] GOOGLE_MAPS_API_KEY
- [ ] UPI_VPA
- [ ] UPI_PAYER_NAME
- [ ] UPI_NOTE_PREFIX
- [ ] AUTO_VERIFY_CLAIMS
- [ ] JWT_SECRET (NEW)
- [ ] ADMIN_API_KEY (NEW)
- [ ] REDIS_URL (NEW - Upstash configured! ✅)
- [ ] CDN_PROVIDER (NEW)
- [ ] CDN_DOMAIN (NEW)
- [ ] CDN_PREFIX (NEW)
- [ ] GEOCODE_SERVER_FALLBACK (NEW)
- [ ] ALLOWED_ORIGINS (NEW)

### 4. Deploy to Cloud Run

**Option A: Automated (Recommended)**

```bash
chmod +x deploy.sh
./deploy.sh
```

**Option B: Manual**
Follow commands in DEPLOY_QUICK_START.md

Deployment checklist:

- [ ] Docker image built successfully
- [ ] Image pushed to registry
- [ ] Cloud Run service deployed
- [ ] No errors in deployment output
- [ ] Service URL received

---

## Post-Deployment Verification

### 1. Basic Health Check

```bash
# Get service URL
gcloud run services describe easy-backend --region=asia-south1 --format="value(status.url)"

# Test health endpoint
curl YOUR_CLOUD_RUN_URL/health
```

- [ ] Health endpoint returns 200 OK
- [ ] Response includes status: "OK"
- [ ] Database status: "connected"
- [ ] Firebase status: true

### 2. Check Logs

```bash
gcloud run logs tail easy-backend --region=asia-south1 --limit=100
```

Expected log messages:

- [ ] "MongoDB: Connected successfully"
- [ ] "Firebase Admin SDK initialized"
- [ ] "Server running on port 8080"
- [ ] "Redis: Connecting..."
- [ ] "Redis: Connected and ready"
- [ ] "✅ Redis caching enabled"

**NO errors about:**

- [ ] Missing secrets
- [ ] Database connection failures
- [ ] Firebase initialization errors

### 3. Test API Endpoints

**Test admin login:**

```bash
curl -X POST https://YOUR_CLOUD_RUN_URL/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"your-admin@email.com","password":"your-password"}'
```

- [ ] Returns JWT token
- [ ] Status 200 OK
- [ ] No authentication errors

**Test password change (with token from above):**

```bash
curl -X PUT https://YOUR_CLOUD_RUN_URL/api/admin/change-password \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{"currentPassword":"old","newPassword":"new123"}'
```

- [ ] Password change works (or returns appropriate error)

### 4. Update CORS Configuration

```bash
# Update ALLOWED_ORIGINS to include your Cloud Run URL
echo -n "https://YOUR_CLOUD_RUN_URL,http://localhost:3000" | \
  gcloud secrets versions add ALLOWED_ORIGINS --data-file=-

# Redeploy to pick up new secret
gcloud run services update easy-backend --region=asia-south1
```

- [ ] ALLOWED_ORIGINS secret updated
- [ ] Service redeployed
- [ ] CORS working from Flutter app

---

## Flutter App Configuration

### Update API URL

**In your Flutter app:**

1. Update API_BASE_URL constant or environment variable
2. Rebuild the app

```dart
// Update this in your Flutter code:
const String apiBaseUrl = 'https://YOUR_CLOUD_RUN_URL';
```

Or use environment variable:

```bash
flutter build apk --dart-define=API_BASE_URL=https://YOUR_CLOUD_RUN_URL
```

- [ ] API_BASE_URL updated in Flutter code or build command
- [ ] Flutter app rebuilt
- [ ] New APK generated

### Test from Mobile App

- [ ] App connects to Cloud Run backend
- [ ] Login works
- [ ] Admin panel accessible
- [ ] Password change feature works
- [ ] No CORS errors
- [ ] All features working as expected

---

## ✅ Redis Already Configured!

**Your Upstash Redis is set up and working!**

### Current Setup Verification

- [x] Upstash account created
- [x] Redis database created
- [x] REDIS_URL configured in .env: `rediss://...@advanced-bulldog-34907.upstash.io:6379`
- [x] Local testing successful - logs show "Redis: Connected and ready"
- [x] TLS encryption enabled (rediss:// protocol)
- [x] Free tier: 10,000 requests/day

### Deployment Checklist

- [ ] `.env` file has Upstash REDIS_URL (already done locally)
- [ ] `setup-secrets.sh` will create REDIS_URL secret in GCP
- [ ] Deploy with `deploy.sh`
- [ ] Verify logs show:
  - "Redis: Connecting..."
  - "Redis: Connected and ready"
  - "✅ Redis caching enabled"
- [ ] Test API performance (should be faster with caching)

**Benefits:**

- ✅ Faster API responses (cached data)
- ✅ Reduced database load
- ✅ Better scalability
- ✅ Global edge network (Upstash)
- ✅ No additional cost (free tier)

---

## Monitoring & Maintenance

### Regular Checks

Daily:

- [ ] Check error logs: `gcloud run logs read easy-backend --region=asia-south1 --filter="severity>=ERROR"`
- [ ] Monitor Cloud Run metrics in GCP Console

Weekly:

- [ ] Review Cloud Run costs
- [ ] Check request count and latency
- [ ] Review MongoDB Atlas usage

Monthly:

- [ ] Rotate JWT_SECRET and ADMIN_API_KEY
- [ ] Review and update dependencies
- [ ] Check for Cloud Run updates/recommendations

### Useful Commands

```bash
# View real-time logs
gcloud run logs tail easy-backend --region=asia-south1 --follow

# Check service status
gcloud run services describe easy-backend --region=asia-south1

# List all revisions
gcloud run revisions list --service=easy-backend --region=asia-south1

# Rollback to previous revision (if needed)
gcloud run services update-traffic easy-backend --region=asia-south1 --to-revisions=REVISION_NAME=100

# View metrics
gcloud run services describe easy-backend --region=asia-south1 --format=yaml
```

---

## Troubleshooting Checklist

If deployment fails:

- [ ] Check build logs: Look for npm install errors
- [ ] Verify all secrets exist: `gcloud secrets list`
- [ ] Check secret values: `gcloud secrets versions access latest --secret=SECRET_NAME`
- [ ] Verify Docker build: Build locally first to test
- [ ] Check MongoDB Atlas whitelist: Must allow 0.0.0.0/0
- [ ] Verify Firebase JSON file: Must be in Backend/ folder

If health check fails:

- [ ] Check logs for errors: `gcloud run logs read easy-backend --region=asia-south1 --limit=100`
- [ ] Test database connection: Check MongoDB Atlas status
- [ ] Verify secrets are mounted: Check environment in Cloud Run console
- [ ] Test locally first: `npm start` in Backend/

If CORS errors occur:

- [ ] Verify ALLOWED_ORIGINS includes Cloud Run URL
- [ ] Check frontend is using correct API URL
- [ ] Verify secret was updated: `gcloud secrets versions access latest --secret=ALLOWED_ORIGINS`
- [ ] Ensure service was redeployed after secret update

---

## Cost Tracking

Keep track of your GCP costs:

Current configuration costs (estimate):

- Cloud Run: $5-10/month (low traffic)
- Secret Manager: ~$0.30/month
- Container Registry/Artifact Registry: ~$1-2/month
- MongoDB Atlas: $0-9/month (depending on tier)

**Total: ~$6-21/month** (without Redis)

With Redis (Memorystore Basic): Add ~$30-40/month

- [ ] Set up billing alerts in GCP Console
- [ ] Monitor costs weekly
- [ ] Review usage monthly

---

## Deployment Complete! ✅

### Final Verification

- [ ] Backend deployed to Cloud Run
- [ ] Health endpoint responding
- [ ] All secrets configured
- [ ] Logs show no errors
- [ ] Flutter app updated with new URL
- [ ] Mobile app tested end-to-end
- [ ] CORS configured correctly
- [ ] Admin features working
- [ ] Password change working
- [ ] Monitoring set up

### Documentation

- [ ] Service URL documented
- [ ] Deployment date recorded
- [ ] Any issues/resolutions noted
- [ ] Team notified of update

### Next Steps

1. Monitor logs for first 24 hours
2. Test all features thoroughly
3. Consider enabling Redis if needed
4. Set up automated backups (if desired)
5. Review and optimize performance

---

**Congratulations! Your backend is live on Google Cloud Run! 🎉**

**Service URL:** **************\_\_\_**************

**Deployment Date:** **************\_\_\_**************

**Deployed By:** **************\_\_\_**************

**Notes:** **************\_\_\_**************
