# Fix: Firebase Cloud Messaging Permission Denied on Cloud Run

## 🚨 Problem

**Error:** `messaging/mismatched-credential - Permission 'cloudmessaging.messages.create' denied`

**Cause:** The service account used by Cloud Run doesn't have Firebase Cloud Messaging permissions.

## ✅ Solution (3 Options)

### Option 1: Grant FCM Permissions to Service Account (Recommended)

```bash
# Grant Firebase Cloud Messaging Admin role to the service account
gcloud projects add-iam-policy-binding easy-grocery-521d5 \
  --member="serviceAccount:easy-backend@easy-grocery-521d5.iam.gserviceaccount.com" \
  --role="roles/firebasenotifications.admin"

# Also grant Firebase Admin SDK roles
gcloud projects add-iam-policy-binding easy-grocery-521d5 \
  --member="serviceAccount:easy-backend@easy-grocery-521d5.iam.gserviceaccount.com" \
  --role="roles/firebase.admin"
```

### Option 2: Use the Correct Firebase Service Account

Your `GOOGLE_APPLICATION_CREDENTIALS` secret should contain the **Firebase Admin SDK** service account JSON, not a regular GCP service account.

**Steps:**

1. **Get the Firebase Admin SDK service account:**

   ```bash
   # Go to Firebase Console → Project Settings → Service Accounts
   # Click "Generate new private key"
   # Download: easy-grocery-521d5-firebase-adminsdk-xxxxx.json
   ```

2. **Update the secret in GCP:**

   ```bash
   # Delete old secret
   gcloud secrets delete GOOGLE_APPLICATION_CREDENTIALS --project=easy-grocery-521d5

   # Create new secret with Firebase Admin SDK JSON
   cat easy-grocery-521d5-firebase-adminsdk-xxxxx.json | \
   gcloud secrets create GOOGLE_APPLICATION_CREDENTIALS \
     --data-file=- \
     --project=easy-grocery-521d5
   ```

3. **Redeploy Cloud Run:**
   ```bash
   gcloud run deploy easy-backend \
     --image asia-south1-docker.pkg.dev/easy-grocery-521d5/easy-backend/api:latest \
     --region asia-south1 \
     --allow-unauthenticated \
     --update-secrets GOOGLE_APPLICATION_CREDENTIALS=GOOGLE_APPLICATION_CREDENTIALS:latest
   ```

### Option 3: Update Environment Variable Format

If the secret is already correct, you might need to tell Cloud Run to pass it as an environment variable:

```bash
gcloud run services update easy-backend \
  --region=asia-south1 \
  --update-secrets=GOOGLE_APPLICATION_CREDENTIALS=GOOGLE_APPLICATION_CREDENTIALS:latest
```

## 🔍 Verification

After applying the fix, check the logs:

```bash
gcloud run services logs read easy-backend --region=asia-south1 --limit=50
```

Look for:

- ✅ `🔐 Firebase Admin initialized with credentials`
- ✅ `✅ Push sent: X succeeded, 0 failed`

## 🎯 Quick Fix (Most Likely Solution)

Run these 2 commands:

```bash
# 1. Grant FCM permissions
gcloud projects add-iam-policy-binding easy-grocery-521d5 \
  --member="serviceAccount:easy-backend@easy-grocery-521d5.iam.gserviceaccount.com" \
  --role="roles/firebasenotifications.admin"

# 2. Restart the service
gcloud run services update easy-backend --region=asia-south1
```

## 📝 Why This Works Locally But Not on Cloud Run

| Environment   | How Firebase Auth Works                                              |
| ------------- | -------------------------------------------------------------------- |
| **Local**     | Uses `easy-grocery-521d5-firebase-adminsdk-xxxxx.json` file directly |
| **Cloud Run** | Uses `GOOGLE_APPLICATION_CREDENTIALS` secret OR service account      |
| **Issue**     | Cloud Run service account doesn't have FCM permissions               |

## 🔐 Service Accounts Explained

Your app needs 2 service accounts:

1. **Cloud Run Service Account** (`easy-backend@easy-grocery-521d5.iam.gserviceaccount.com`)

   - Runs your container
   - Needs: Storage Admin, Secret Manager Accessor
   - ❌ Doesn't have FCM permissions by default

2. **Firebase Admin SDK Service Account** (`firebase-adminsdk-xxxxx@easy-grocery-521d5.iam.gserviceaccount.com`)
   - Used by Firebase Admin SDK
   - Already has: FCM, Auth, Firestore permissions
   - ✅ This is what should be in `GOOGLE_APPLICATION_CREDENTIALS`

## ✅ Final Commands (Copy-Paste)

```bash
# Check current service account
gcloud run services describe easy-backend \
  --region=asia-south1 \
  --format="value(spec.template.spec.serviceAccountName)"

# Grant FCM permissions
gcloud projects add-iam-policy-binding easy-grocery-521d5 \
  --member="serviceAccount:easy-backend@easy-grocery-521d5.iam.gserviceaccount.com" \
  --role="roles/firebasenotifications.admin"

# Restart service to apply
gcloud run services update easy-backend \
  --region=asia-south1 \
  --no-traffic

# Test notification
# Place order and check logs
gcloud run services logs read easy-backend \
  --region=asia-south1 \
  --limit=50 | grep "Push sent"
```

## 🎉 Expected Result

**Before Fix:**

```
❌ Token 1 failed: messaging/mismatched-credential
❌ Token 2 failed: messaging/mismatched-credential
❌ Token 3 failed: messaging/mismatched-credential
```

**After Fix:**

```
✅ Push sent: 3 succeeded, 0 failed
📊 Push notification summary: 3 sent, 0 failed out of 3 tokens
```
