require("module-alias/register");
#!/usr/bin/env node
/*
Usage (PowerShell):
  $env:GOOGLE_APPLICATION_CREDENTIALS="C:\\path\\to\\service-account.json"
  node scripts/send_test_push.js --token=<DEVICE_TOKEN> [--title="Test"] [--body="Hello"] [--route="/loading"]
*/

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function initAdmin() {
  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    const saPathEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const localName = process.env.FIREBASE_SERVICE_ACCOUNT;
    try {
      if (saPathEnv) {
        admin.initializeApp({ credential: admin.credential.cert(require(saPathEnv)) });
      } else if (localName) {
        const candidate = path.join(__dirname, '..', localName);
        admin.initializeApp({ credential: admin.credential.cert(require(candidate)) });
      } else {
        // Application Default Credentials (GCP env)
        admin.initializeApp();
      }
    } catch (e) {
      console.error('Failed to initialize Firebase Admin SDK:', e.message);
      process.exit(1);
    }
  }
  return require('firebase-admin');
}

function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

(async () => {
  const args = parseArgs(process.argv);
  const token = args.token || args.t;
  if (!token) {
    console.error('Missing --token=<DEVICE_TOKEN>');
    process.exit(1);
  }
  const title = args.title || 'Easy App Test';
  const body = args.body || 'Hello from FCM v1 (Admin SDK)';
  const route = args.route || '/loading';

  const admin = await initAdmin();

  const message = {
    token,
    notification: { title, body },
    data: {
      route,
      type: 'test',
      android_channel_id: 'orders_updates',
      click_action: 'FLUTTER_NOTIFICATION_CLICK',
    },
    android: {
      priority: 'high',
      notification: {
        channelId: 'orders_updates',
        clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        sound: 'default',
      },
    },
  };

  try {
    const resp = await admin.messaging().send(message);
    console.log('✅ Sent, messageId:', resp);
    process.exit(0);
  } catch (e) {
    console.error('❌ Send failed:', e.message || e);
    process.exit(2);
  }
})();
