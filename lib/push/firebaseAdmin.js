/**
 * Firebase Admin initialisation - used ONLY for FCM push notifications.
 * Authentication is custom JWT (see src/app/routes/auth), not Firebase Auth.
 *
 * Credential lookup order:
 *   1. GOOGLE_APPLICATION_CREDENTIALS  (raw JSON string, or a path to a JSON file)
 *   2. <root>/<FIREBASE_SERVICE_ACCOUNT || serviceAccount.json>
 *   3. any <root>/*firebase-adminsdk*.json
 *   4. Application Default Credentials (Cloud Run workload identity)
 */
const fs = require("fs");
const path = require("path");
const logger = require("@util/logger");
const { ROOT } = require("@lib/config/env");

let initialized = false;

function loadCredentials() {
  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!raw) return null;
  try {
    if (raw.trim().startsWith("{")) {
      logger.debug("Parsed GOOGLE_APPLICATION_CREDENTIALS from JSON string");
      return JSON.parse(raw);
    }
    const p = path.isAbsolute(raw) ? raw : path.join(ROOT, raw);
    return require(p);
  } catch (err) {
    logger.warn(`Failed to parse GOOGLE_APPLICATION_CREDENTIALS: ${err.message}`);
    return null;
  }
}

function initFirebaseAdmin() {
  if (initialized) return true;
  try {
    const admin = require("firebase-admin");
    if (!admin.apps.length) {
      const credentials = loadCredentials();
      if (credentials) {
        admin.initializeApp({ credential: admin.credential.cert(credentials) });
        logger.info("Firebase Admin initialized (FCM only)");
      } else {
        const candidate = path.join(ROOT, process.env.FIREBASE_SERVICE_ACCOUNT || "serviceAccount.json");
        if (fs.existsSync(candidate)) {
          admin.initializeApp({ credential: admin.credential.cert(require(candidate)) });
          logger.info("Firebase Admin initialized from local file (FCM only)");
        } else {
          const files = fs
            .readdirSync(ROOT)
            .filter((f) => f.toLowerCase().endsWith(".json") && f.toLowerCase().includes("firebase-adminsdk"));
          if (files.length > 0) {
            admin.initializeApp({ credential: admin.credential.cert(require(path.join(ROOT, files[0]))) });
            logger.info(`Firebase Admin initialized from: ${files[0]} (FCM only)`);
          } else {
            admin.initializeApp();
            logger.warn("Firebase Admin using Application Default Credentials (FCM only)");
          }
        }
      }
    }
    global.firebaseAdmin = admin;
    initialized = true;
  } catch (err) {
    logger.warn(`Firebase Admin not initialized (FCM push notifications disabled): ${err.message}`);
    initialized = false;
  }
  return initialized;
}

function isFirebaseInitialized() {
  return initialized;
}

module.exports = { initFirebaseAdmin, isFirebaseInitialized };
