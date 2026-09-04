# Fix: Firebase Cloud Messaging Permission Denied on Cloud Run

## 🚨 Problem

**Error:** `messaging/mismatched-credential - Permission 'cloudmessaging.messages.create' denied`

**When it happens:**
- Push notifications fail when app is deployed on Cloud Run
- Works fine locally with Firebase Admin SDK
- Occurs when trying to send notifications to device tokens

**Root Cause:** The Cloud Run service account doesn't have Firebase Cloud Messaging permissions

---

## ✅ Solution (3 Options)

### Option 1: Grant FCM Permissions to Service Account (Recommended) ⭐

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

**Then restart the service:**
```bash
gcloud run services update easy-backend \
  --region=asia-south1 \
  --no-traffic
```

---

### Option 2: Use the Correct Firebase Service Account

Your `GOOGLE_APPLICATION_CREDENTIALS` secret should contain the **Firebase Admin SDK** service account JSON.

**Steps:**

1. **Get the Firebase Admin SDK service account:**
   ```bash
   # Go to: Firebase Console → Project Settings → Service Accounts
   # Click "Generate new private key"
   # Download: easy-grocery-521d5-firebase-adminsdk-xxxxx.json
   ```

2. **Update the secret in GCP:**
   ```bash
   # Delete old secret
   gcloud secrets delete GOOGLE_APPLICATION_CREDENTIALS \
     --project=easy-grocery-521d5

   # Create new secret with Firebase Admin SDK JSON
   gcloud secrets create GOOGLE_APPLICATION_CREDENTIALS \
     --data-file=easy-grocery-521d5-firebase-adminsdk-xxxxx.json \
     --project=easy-grocery-521d5
   ```

3. **Redeploy Cloud Run:**
   ```bash
   gcloud run deploy easy-backend \
     --image gcr.io/easy-grocery-521d5/easy-backend:latest \
     --region asia-south1 \
     --allow-unauthenticated \
     --update-secrets GOOGLE_APPLICATION_CREDENTIALS=GOOGLE_APPLICATION_CREDENTIALS:latest
   ```

---

### Option 3: Update Environment Variable Binding

If the secret is correct but not being passed properly:

```bash
gcloud run services update easy-backend \
  --region=asia-south1 \
  --update-secrets=GOOGLE_APPLICATION_CREDENTIALS=GOOGLE_APPLICATION_CREDENTIALS:latest
```

---

## 🎯 Quick Fix (Copy-Paste These 2 Commands)

```bash
# 1. Grant FCM permissions
gcloud projects add-iam-policy-binding easy-grocery-521d5 \
  --member="serviceAccount:easy-backend@easy-grocery-521d5.iam.gserviceaccount.com" \
  --role="roles/firebasenotifications.admin"

# 2. Restart the service
gcloud run services update easy-backend --region=asia-south1
```

**Done!** Your push notifications should work now.

---

## 🔍 Verification

After applying the fix:

```bash
# Check the logs
gcloud run services logs read easy-backend \
  --region=asia-south1 \
  --limit=50
```

**Look for:**
- ✅ `🔐 Firebase Admin initialized with credentials`
- ✅ `✅ Push sent: X succeeded, 0 failed`
- ❌ NOT: `messaging/mismatched-credential`

---

## 📊 Test the Fix

### Via API (Place an Order)

1. **Create a test account and enable notifications** (via mobile app or API)
2. **Create/place an order** with that account
3. **Check Cloud Run logs** for push notification results:

```bash
gcloud run services logs read easy-backend --region=asia-south1 --limit=20 | grep -i "push\|notification"
```

### Expected Output

**Before Fix:**
```
❌ Token 1 failed: messaging/mismatched-credential
❌ Token 2 failed: messaging/mismatched-credential
```

**After Fix:**
```
✅ Push sent: 3 succeeded, 0 failed
📊 Push notification summary: 3 sent, 0 failed out of 3 tokens
```

---

## 🔐 Understanding the Service Accounts

Your app uses **2 different service accounts**:

| Account | Purpose | Permissions | Location |
|---------|---------|-------------|----------|
| **Cloud Run Service Account** | Runs your container | Storage, Secrets | `easy-backend@easy-grocery-521d5.iam.gserviceaccount.com` |
| **Firebase Admin SDK** | Used by Firebase SDK | FCM, Auth, Firestore | `firebase-adminsdk-xxxxx@easy-grocery-521d5.iam.gserviceaccount.com` |

**The Problem:** Cloud Run service account needs to have FCM permissions OR you need to pass Firebase Admin SDK credentials via `GOOGLE_APPLICATION_CREDENTIALS`.

---

## 📝 Why This Works Locally But Not on Cloud Run

| Environment | How Firebase Auth Works | Status |
|-------------|-------------------------|--------|
| **Local** | Uses `.env` → `easy-grocery-521d5-firebase-adminsdk-xxxxx.json` file directly | ✅ Works |
| **Cloud Run** | Uses `GOOGLE_APPLICATION_CREDENTIALS` secret | ⚠️ Depends on permissions |
| **Issue** | Cloud Run service account doesn't have FCM permissions by default | ❌ Fails |

---

## 🛠️ Troubleshooting

### Still getting permission denied?

1. **Verify the role was actually granted:**
   ```bash
   gcloud projects get-iam-policy easy-grocery-521d5 \
     --flatten="bindings[].members" \
     --format="table(bindings.role)" \
     --filter="bindings.members:easy-backend@easy-grocery-521d5.iam.gserviceaccount.com"
   ```

2. **Force a new Cloud Run revision:**
   ```bash
   gcloud run deploy easy-backend \
     --image gcr.io/easy-grocery-521d5/easy-backend:latest \
     --region asia-south1 \
     --force-unlock
   ```

3. **Check if Firebase is properly initialized:**
   ```bash
   gcloud run services logs read easy-backend \
     --region=asia-south1 \
     --limit=30 | grep -i "firebase\|initialized"
   ```

### Permission denied on GCS backups too?

Grant Storage Admin permissions:
```bash
gcloud projects add-iam-policy-binding easy-grocery-521d5 \
  --member="serviceAccount:easy-backend@easy-grocery-521d5.iam.gserviceaccount.com" \
  --role="roles/storage.admin"
```

---

## ✅ Complete Fix Checklist

- [ ] Run the 2 quick-fix commands above
- [ ] Wait 1-2 minutes for permissions to propagate
- [ ] Restart Cloud Run service
- [ ] Place a test order
- [ ] Check logs for `✅ Push sent`
- [ ] Confirm push notifications arrive on device
- [ ] Monitor production for 24 hours

---

## 📞 Support

**Still having issues?**

1. Check the full error: `gcloud run services logs read easy-backend --region=asia-south1 --limit=100`
2. Verify Firebase is initialized: Look for `🔐 Firebase Admin initialized`
3. Confirm service account has FCM role: Check IAM console
4. Review [Firebase Admin SDK docs](https://firebase.google.com/docs/admin/setup)
