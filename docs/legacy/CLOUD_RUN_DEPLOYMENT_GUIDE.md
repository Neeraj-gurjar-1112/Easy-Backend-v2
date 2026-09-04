# Google Cloud Run Deployment Guide - Complete Edition

## Overview

This guide explains how to deploy the **Easy-Backend** service to Google Cloud Run with all integrated features including:
- ✅ MongoDB automated backups to Google Cloud Storage
- ✅ Cron jobs for order management
- ✅ Error monitoring with Sentry
- ✅ Redis caching
- ✅ Health checks and auto-scaling
- ✅ MongoDB Database Tools (mongodump/mongorestore)
- ✅ Google Cloud CLI for backup operations

---

## Prerequisites

### Required Software
```bash
# Install gcloud CLI
curl https://sdk.cloud.google.com | bash

# Install Docker
# Download from: https://www.docker.com/products/docker-desktop

# Verify installations
gcloud --version
docker --version
```

### GCP Project Setup
1. **Create a GCP Project** (or use existing)
   ```bash
   PROJECT_ID="easy-grocery-521d5"
   gcloud config set project $PROJECT_ID
   ```

2. **Enable Required APIs**
   ```bash
   gcloud services enable \
     run.googleapis.com \
     artifactregistry.googleapis.com \
     cloudbuild.googleapis.com \
     storage.googleapis.com \
     cloudkms.googleapis.com \
     secretmanager.googleapis.com
   ```

3. **Create Artifact Registry Repository** (if not exists)
   ```bash
   gcloud artifacts repositories create easy-backend \
     --repository-format=docker \
     --location=asia-south1
   ```

4. **Configure Docker Authentication**
   ```bash
   gcloud auth configure-docker asia-south1-docker.pkg.dev
   ```

### GCS Bucket for Backups
```bash
# Create GCS bucket for MongoDB backups
gsutil mb -p easy-grocery-521d5 -l asia-south1 gs://easy-grocery-backups

# Set bucket lifecycle (auto-delete old backups after 30 days)
cat > /tmp/lifecycle.json << 'EOF'
{
  "lifecycle": {
    "rule": [
      {
        "action": {"type": "Delete"},
        "condition": {"age": 30}
      }
    ]
  }
}
EOF

gsutil lifecycle set /tmp/lifecycle.json gs://easy-grocery-backups
```

### Google Secret Manager Setup

Store all sensitive environment variables as secrets:

```bash
# MongoDB Connection String
echo -n "mongodb+srv://user:pass@cluster.mongodb.net/easy_app" | \
  gcloud secrets create DB_CONNECTION_STRING --data-file=-

# Firebase/FCM
echo -n "your-fcm-server-key" | \
  gcloud secrets create FCM_SERVER_KEY --data-file=-

# Database Name
echo -n "easy_app" | \
  gcloud secrets create DB_NAME --data-file=-

# UPI Configuration
echo -n "your-upi-vpa@bank" | \
  gcloud secrets create UPI_VPA --data-file=-

echo -n "Merchant Name" | \
  gcloud secrets create UPI_PAYER_NAME --data-file=-

echo -n "Order from Easy" | \
  gcloud secrets create UPI_NOTE_PREFIX --data-file=-

# Firebase Claim Verification
echo -n "true" | \
  gcloud secrets create AUTO_VERIFY_CLAIMS --data-file=-

# Firebase Sender ID
echo -n "your-sender-id" | \
  gcloud secrets create FCM_SENDER_ID --data-file=-

# Google Maps API Key
echo -n "your-maps-api-key" | \
  gcloud secrets create GOOGLE_MAPS_API_KEY --data-file=-

# Sentry DSN (Error Monitoring)
echo -n "https://your-key@sentry.io/project-id" | \
  gcloud secrets create SENTRY_DSN --data-file=-

# Firebase Admin SDK JSON
cat service-account-key.json | \
  gcloud secrets create FIREBASE_ADMIN_SDK --data-file=-
```

### Service Account Setup

Create a service account for Cloud Run with necessary permissions:

```bash
# Create service account
gcloud iam service-accounts create easy-backend \
  --display-name="Easy Backend Service"

# Grant Cloud Run permissions
gcloud projects add-iam-policy-binding easy-grocery-521d5 \
  --member="serviceAccount:easy-backend@easy-grocery-521d5.iam.gserviceaccount.com" \
  --role="roles/run.invoker"

# Grant Secret Manager access
gcloud projects add-iam-policy-binding easy-grocery-521d5 \
  --member="serviceAccount:easy-backend@easy-grocery-521d5.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

# Grant GCS access for backups
gcloud projects add-iam-policy-binding easy-grocery-521d5 \
  --member="serviceAccount:easy-backend@easy-grocery-521d5.iam.gserviceaccount.com" \
  --role="roles/storage.admin"
```

---

## Deployment Methods

### Method 1: Using the Automated Script (Recommended)

```bash
cd /workspaces/Easy-Backend

# Make script executable
chmod +x Backend/deploy-to-cloud-run.sh

# Deploy to production
./Backend/deploy-to-cloud-run.sh --production

# Or deploy to staging with debug logging
./Backend/deploy-to-cloud-run.sh --test

# View help
./Backend/deploy-to-cloud-run.sh --help
```

**What the script does:**
1. Validates all prerequisites
2. Configures gcloud credentials
3. Builds the Docker image with all dependencies
4. Pushes image to Artifact Registry
5. Creates/verifies GCS bucket
6. Deploys to Cloud Run with all secrets and environment variables
7. Displays deployment information

### Method 2: Manual Deployment

If you prefer to deploy manually or need custom configuration:

```bash
cd Backend

# Step 1: Build the image
IMAGE="asia-south1-docker.pkg.dev/easy-grocery-521d5/easy-backend/api:$(date +%Y%m%d-%H%M%S)"
docker build -t "$IMAGE" .

# Step 2: Push to Artifact Registry
docker push "$IMAGE"

# Step 3: Deploy to Cloud Run
gcloud run deploy easy-backend \
  --image "$IMAGE" \
  --region asia-south1 \
  --allow-unauthenticated \
  --timeout 3600 \
  --max-instances 100 \
  --memory 1Gi \
  --cpu 1 \
  --set-secrets "DB_CONNECTION_STRING=DB_CONNECTION_STRING:latest,FCM_SERVER_KEY=FCM_SERVER_KEY:latest,DB_NAME=DB_NAME:latest,UPI_VPA=UPI_VPA:latest,UPI_PAYER_NAME=UPI_PAYER_NAME:latest,UPI_NOTE_PREFIX=UPI_NOTE_PREFIX:latest,AUTO_VERIFY_CLAIMS=AUTO_VERIFY_CLAIMS:latest,FCM_SENDER_ID=FCM_SENDER_ID:latest,GOOGLE_MAPS_API_KEY=GOOGLE_MAPS_API_KEY:latest,SENTRY_DSN=SENTRY_DSN:latest,FIREBASE_ADMIN_SDK=FIREBASE_ADMIN_SDK:latest" \
  --set-env-vars "NODE_ENV=production,GCS_BACKUP_BUCKET=gs://easy-grocery-backups" \
  --service-account="easy-backend@easy-grocery-521d5.iam.gserviceaccount.com" \
  --quiet
```

---

## Integrated Features Overview

### 1. MongoDB Automated Backups

**What happens:**
- Automatic backup runs **daily at 2:00 AM UTC**
- Uses `mongodump` to create consistent backups
- Uploads to Google Cloud Storage bucket
- Old backups auto-deleted after 30 days

**How it works:**
```javascript
// In app.js (lines 428-439)
cron.schedule("0 2 * * *", async () => {
  const { createBackup } = require("./scripts/backup-db");
  const backupName = await createBackup();
  // Backup uploaded to GCS automatically
});
```

**Manual backup options:**

```bash
# Method 1: Using Node.js script
node Backend/scripts/backup-db.js

# Method 2: Using bash script with GCS upload
chmod +x Backend/scripts/backup-to-cloud.sh
./Backend/scripts/backup-to-cloud.sh backup    # Create & upload
./Backend/scripts/backup-to-cloud.sh list      # List backups in GCS
./Backend/scripts/backup-to-cloud.sh cleanup   # Remove old backups

# Method 3: API endpoint (Admin only)
curl -X POST https://your-service-url/api/admin/backup-now \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 2. Order Management Cron Jobs

**What happens:**
- Runs **every 5 minutes**
- Checks for timed-out order assignments
- Retries abandoned pending orders
- Automatically reassigns orders to nearest available agents

**Details:**
```javascript
// In app.js (lines 365-428)
cron.schedule("*/5 * * * *", async () => {
  // Check timeouts for assigned orders
  // Retry pending orders
  // Escalate if needed
});
```

### 3. Health Checks

**Cloud Run monitors:**
```
GET /health         # Basic health check
GET /api/health     # Detailed health check
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2024-12-19T10:30:00Z",
  "uptime": 3600
}
```

### 4. MongoDB Tools in Docker

**Installed tools:**
- `mongodump` - Database backup
- `mongorestore` - Database restore
- `bsondump` - BSON file inspection
- `gcloud` - Google Cloud operations

**Available in Cloud Run:**
```bash
# Check installation
mongodump --version
mongorestore --version
gcloud --version
```

---

## Monitoring & Logs

### View Real-time Logs
```bash
# Stream logs
gcloud run services logs read easy-backend --region asia-south1 --limit 100

# Follow logs (tail -f style)
gcloud run services logs read easy-backend --region asia-south1 --tail
```

### Check Service Status
```bash
# Get service details
gcloud run services describe easy-backend --region asia-south1

# Get revisions
gcloud run revisions list --service easy-backend --region asia-south1

# Get metrics
gcloud monitoring time-series list \
  --filter='resource.type="cloud_run_revision"'
```

### View Backup Operations
```bash
# List all backups
gsutil ls -r gs://easy-grocery-backups/mongodb-backups/

# Check backup sizes
gsutil du -sh gs://easy-grocery-backups/mongodb-backups/

# View recent uploads
gsutil ls -l gs://easy-grocery-backups/mongodb-backups/ | tail -20
```

### Sentry Error Monitoring
```
Dashboard: https://sentry.io/organizations/your-org/issues/
```

---

## Troubleshooting

### Issue: "mongodump not found"
**Solution:** Already fixed in Dockerfile. Ensure you're using the latest image.

```bash
# Verify Docker image has mongodump
docker run --rm asia-south1-docker.pkg.dev/.../api:latest \
  mongodump --version
```

### Issue: Backup fails with permission denied

**Solution:** Ensure service account has Storage Admin role:
```bash
gcloud projects add-iam-policy-binding easy-grocery-521d5 \
  --member="serviceAccount:easy-backend@easy-grocery-521d5.iam.gserviceaccount.com" \
  --role="roles/storage.admin"
```

### Issue: Cron jobs not running

**Check logs:**
```bash
gcloud run services logs read easy-backend --limit 500 | grep -i cron
```

**Common causes:**
- Service not healthy (check /health endpoint)
- Internal request timeout
- Database connection issues

### Issue: GCS bucket not found

**Solution:**
```bash
# List buckets
gsutil ls

# Create if missing
gsutil mb -p easy-grocery-521d5 -l asia-south1 gs://easy-grocery-backups
```

---

## Performance Configuration

### Cloud Run Settings (Current)
```
Memory: 1Gi
CPU: 1
Timeout: 3600 seconds (1 hour)
Max Instances: 100
Concurrency: 80
```

### Optimization for High Load
```bash
# Increase resources if needed
gcloud run deploy easy-backend \
  --memory 2Gi \
  --cpu 2 \
  --max-instances 200 \
  --concurrency 100
```

### Database Optimization
- MongoDB Atlas auto-scaling enabled
- Connection pooling configured
- Indexes verified (run: `node Backend/scripts/create-indexes.js`)

---

## Rollback Procedures

### Rollback to Previous Version
```bash
# List previous revisions
gcloud run revisions list --service easy-backend --region asia-south1

# Deploy specific revision
gcloud run deploy easy-backend \
  --revision easy-backend-00001-abc \
  --region asia-south1

# Or deploy previous image
gcloud run deploy easy-backend \
  --image asia-south1-docker.pkg.dev/.../api:PREVIOUS_TAG \
  --region asia-south1
```

---

## Security Best Practices

### Implemented ✅
- All secrets in Secret Manager (not in environment files)
- Service account with minimal permissions
- GCS bucket with lifecycle policies
- Helmet security headers configured
- Rate limiting enabled
- CORS configured securely
- MongoDB connection validation
- Input validation with express-validator

### Additional Recommendations
1. **Enable Cloud Armor** for DDoS protection
2. **Set up audit logging** for compliance
3. **Use VPC connector** for private database connections
4. **Enable binary authorization** to verify container images
5. **Regular security audits** and dependency updates

---

## Cost Considerations

**Estimated monthly costs:**
- Cloud Run (1Gi, 100 max): ~$20-50 (depends on traffic)
- MongoDB backups in GCS: ~$1-5 (depends on database size)
- Cloud Build (builds): ~$0.10 per build
- Secret Manager: Free (5 secrets) / ~$0.06 each additional

**Cost optimization:**
- Use Cloud Storage Coldline for backups older than 90 days
- Reduce max instances during off-peak hours
- Implement request rate limiting
- Monitor and optimize database queries

---

## FAQ

**Q: How often are backups created?**
A: Daily at 2:00 AM UTC. Can also trigger manually via API.

**Q: Where are backups stored?**
A: Google Cloud Storage bucket `gs://easy-grocery-backups/mongodb-backups/`

**Q: Can I restore from backups?**
A: Yes, use `mongorestore` or the Node.js script:
```bash
node Backend/scripts/backup-db.js --restore backup_name
```

**Q: What if the cron job fails?**
A: Errors are logged to Cloud Logging. Check with:
```bash
gcloud run services logs read easy-backend --limit 100 | grep -i error
```

**Q: Can I SSH into the container?**
A: No, Cloud Run doesn't allow SSH. Use Cloud Logging for debugging.

**Q: How do I scale the service?**
A: Cloud Run auto-scales based on load. Configure limits:
```bash
gcloud run deploy easy-backend --max-instances 500
```

---

## Support & Resources

- **Cloud Run Documentation:** https://cloud.google.com/run/docs
- **MongoDB Backup Guide:** https://docs.mongodb.com/manual/reference/program/mongodump/
- **GCS Documentation:** https://cloud.google.com/storage/docs
- **Sentry Integration:** https://docs.sentry.io/platforms/node/
- **MongoDB Atlas Connection:** https://docs.atlas.mongodb.com/

---

**Last Updated:** December 19, 2024
**Version:** 2.0 (With Cloud Run Integration & MongoDB Backup Tools)
