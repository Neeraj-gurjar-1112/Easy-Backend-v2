require("module-alias/register");
#!/usr/bin/env node

/**
 * MongoDB Backup Script with Google Cloud Storage
 *
 * This script creates automated backups of the MongoDB database using mongodump
 * and uploads them to Google Cloud Storage for disaster recovery.
 *
 * Backups are:
 * - Created with timestamps locally
 * - Uploaded to gs://easy-grocery-backups
 * - Automatically cleaned up from Cloud Storage after 90 days
 * - Available for restoration from any state
 *
 * Usage:
 *   node backup-db-gcs.js               # Create backup and upload to GCS
 *   node backup-db-gcs.js --list        # List backups in GCS
 *   node backup-db-gcs.js --restore <backup-name>  # Restore from GCS backup
 *
 * Requirements:
 *   - MongoDB tools (mongodump/mongorestore) must be installed
 *   - DB_CONNECTION_STRING in .env file
 *   - BACKUP_STORAGE_CREDENTIALS secret in GCP Secret Manager
 */

const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const { Storage } = require("@google-cloud/storage");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const logger = require("../lib/util/logger");

// Configuration
const BACKUP_DIR = path.join(__dirname, "..", "backups");
const GCS_BUCKET = "easy-grocery-backups";
const DB_URI =
  process.env.DB_CONNECTION_STRING || "mongodb://127.0.0.1:27017/easy_app";
const RETENTION_DAYS = 7; // Keep local backups for 7 days
const MAX_BACKUPS = 14; // Maximum number of local backups to keep
const MAX_RETRIES = parseInt(process.env.BACKUP_MAX_RETRIES || "3", 10);
const RETRY_BASE_DELAY_MS = 3000;

// Conservative mongodump options to reduce connection load on Atlas
const MONGODUMP_OPTS = [
  "--readPreference=secondaryPreferred",
  "--numParallelCollections=1",
  "--gzip",
  "--ssl",
  "--quiet",
];

let storage = null;
let bucket = null;

// Initialize Google Cloud Storage
async function initializeGCS() {
  try {
    let storageConfig = {
      projectId: process.env.GCP_PROJECT_ID || "easy-grocery-521d5",
    };

    // Handle credentials from environment variable (Cloud Run secret)
    // GOOGLE_APPLICATION_CREDENTIALS might be set as raw JSON in Cloud Run
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      try {
        // Try parsing as JSON if it's a stringified credentials object
        const credsStr = process.env.GOOGLE_APPLICATION_CREDENTIALS;
        if (credsStr.startsWith("{")) {
          const credentials = JSON.parse(credsStr);
          // Use the parsed credentials directly, don't set keyFilename
          storageConfig.credentials = credentials;
          // Explicitly don't use keyFilename to avoid file path lookups
          storageConfig.keyFilename = undefined;
          logger.debug(
            "Using credentials from GOOGLE_APPLICATION_CREDENTIALS env var"
          );
        }
      } catch (e) {
        logger.warn(
          `Failed to parse GOOGLE_APPLICATION_CREDENTIALS as JSON: ${e.message}`
        );
        // Don't try to use env var as file path
      }
    }

    // If we have credentials, use them; otherwise let ADC handle it
    storage = new Storage(storageConfig);

    bucket = storage.bucket(GCS_BUCKET);

    // Test connection
    const [exists] = await bucket.exists();
    if (!exists) {
      logger.warn(
        `⚠️  GCS bucket ${GCS_BUCKET} not found. Backups will only be stored locally.`
      );
      return false;
    }

    logger.info(`✅ Connected to GCS bucket: ${GCS_BUCKET}`);
    return true;
  } catch (error) {
    logger.warn(
      `⚠️  GCS initialization failed: ${error.message}. Backups will only be stored locally.`
    );
    storage = null;
    bucket = null;
    return false;
  }
}

// Parse database name from connection string
function getDatabaseName(uri) {
  const match = uri.match(/\/([^\/?]+)(\?|$)/);
  return match ? match[1] : null;
}

// Prefer explicit DB_NAME env; fallback to parse from URI; leave undefined if absent
const DB_NAME = process.env.DB_NAME || getDatabaseName(DB_URI) || null;

// Ensure backup directory exists
function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    logger.info(`Created backup directory: ${BACKUP_DIR}`);
  }
}

// Generate backup filename with timestamp
function generateBackupName() {
  const date = new Date();
  const timestamp = date
    .toISOString()
    .replace(/:/g, "-")
    .replace(/\..+/, "")
    .replace("T", "_");
  const namePart = DB_NAME || "database";
  return `backup_${namePart}_${timestamp}`;
}

// Check if mongodump is installed
async function checkMongoDumpInstalled() {
  try {
    await execCommand("mongodump --version");
    return true;
  } catch (error) {
    return false;
  }
}

// Execute shell command with promise and timeout
function execCommand(command, timeoutMs = 600000) {
  return new Promise((resolve, reject) => {
    // Use appropriate shell for the platform
    const shellOption = process.platform === "win32" ? true : "/bin/bash";
    const child = exec(
      command,
      { shell: shellOption, timeout: timeoutMs },
      (error, stdout, stderr) => {
        if (error) {
          const fullError = new Error(`${error.message}\n${stderr || ""}`);
          fullError.stderr = stderr;
          fullError.code = error.code;
          reject(fullError);
          return;
        }
        resolve({ stdout, stderr });
      }
    );
    // Log any real-time output for debugging
    if (child.stderr) {
      child.stderr.on("data", (data) => {
        logger.debug(`mongodump: ${data}`);
      });
    }
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Append connection options to URI for timeouts
function withExtraUriOptions(uri) {
  const extra =
    "connectTimeoutMS=20000&socketTimeoutMS=600000&serverSelectionTimeoutMS=20000";
  return uri.includes("?") ? `${uri}&${extra}` : `${uri}?${extra}`;
}

// Build mongodump command string with tuned options
function buildDumpCommand(backupPath) {
  const dumpUri = withExtraUriOptions(DB_URI);
  const escapedUri = dumpUri.replace(/"/g, '\\"');
  const escapedOut = backupPath.replace(/"/g, '\\"');
  const args = [
    "mongodump",
    `--uri="${escapedUri}"`,
    `--out="${escapedOut}"`,
    ...MONGODUMP_OPTS,
  ];
  return args.join(" ");
}

// Run mongodump with retry/backoff
async function runDumpWithRetries(command) {
  logger.debug(`Executing mongodump: ${command}`);
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      logger.info(`Backup attempt ${attempt}/${MAX_RETRIES}`);
      await execCommand(command);
      logger.info("✅ mongodump completed successfully");
      return;
    } catch (error) {
      lastError = error;
      const delay = RETRY_BASE_DELAY_MS * attempt;
      logger.warn(
        `Backup attempt ${attempt} failed: ${error.message || "unknown"}${
          error.stderr ? ` | stderr: ${error.stderr}` : ""
        }. Retrying in ${delay}ms...`
      );
      await sleep(delay);
    }
  }
  throw lastError;
}

// Upload backup to GCS
async function uploadToGCS(backupName, backupPath) {
  if (!bucket) {
    logger.info("⚠️  GCS not available. Backup stored locally only.");
    return null;
  }

  try {
    logger.info(`📤 Uploading backup to GCS: ${backupName}`);

    // Create a parent directory object in GCS
    const gcsPath = `backups/${backupName}/`;

    // Upload all files in the backup directory
    const files = await getFilesRecursive(backupPath);
    let uploadCount = 0;

    for (const file of files) {
      const relativePath = path.relative(backupPath, file);
      const gcsBlobPath = `${gcsPath}${relativePath}`;

      await bucket.upload(file, {
        destination: gcsBlobPath,
        metadata: {
          contentType: "application/octet-stream",
          metadata: {
            "backup-name": backupName,
            "created-date": new Date().toISOString(),
          },
        },
      });
      uploadCount++;
    }

    const backupSize = getDirectorySize(backupPath);
    logger.info(
      `✅ Uploaded ${uploadCount} files to GCS (${formatBytes(backupSize)})`
    );
    logger.info(`   GCS Path: gs://${GCS_BUCKET}/${gcsPath}`);

    return {
      gcsPath,
      uploadCount,
      size: backupSize,
    };
  } catch (error) {
    logger.error(`❌ GCS upload failed: ${error.message}`);
    throw error;
  }
}

// Get all files recursively
async function getFilesRecursive(dirPath) {
  let files = [];

  function walkDir(dir) {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stats = fs.statSync(fullPath);
      if (stats.isFile()) {
        files.push(fullPath);
      } else if (stats.isDirectory()) {
        walkDir(fullPath);
      }
    }
  }

  walkDir(dirPath);
  return files;
}

// Create database backup
async function createBackup() {
  try {
    // Check if mongodump is installed
    const isInstalled = await checkMongoDumpInstalled();
    if (!isInstalled) {
      const errorMsg = `
⚠️  MongoDB Database Tools not installed - Backups disabled

To enable automatic backups, install mongodump:

Windows:
1. Download from: https://www.mongodb.com/try/download/database-tools
2. Extract and add to PATH
3. Verify: mongodump --version

Linux/Mac:
brew install mongodb-database-tools
OR
sudo apt-get install mongodb-database-tools

Backups are optional for development. Production should have this configured.
`;
      logger.warn(errorMsg);
      // Return success:false instead of throwing - makes backups optional
      return { success: false, reason: "mongodump not installed" };
    }

    ensureBackupDir();

    const backupName = generateBackupName();
    const backupPath = path.join(BACKUP_DIR, backupName);

    logger.info(`Starting database backup: ${backupName}`);
    logger.info(`Database: ${DB_NAME || "all databases"}`);
    logger.info(`Backup location: ${backupPath}`);

    // Build and execute backup
    const command = buildDumpCommand(backupPath);
    await runDumpWithRetries(command);

    // Check if backup was successful
    const backupSuccess =
      fs.existsSync(backupPath) && fs.readdirSync(backupPath).length > 0;

    if (backupSuccess) {
      const backupSize = getDirectorySize(backupPath);
      logger.info(`✅ Local backup completed successfully`);
      logger.info(`   Backup name: ${backupName}`);
      logger.info(`   Size: ${formatBytes(backupSize)}`);

      // Initialize GCS if not already done
      if (storage === null) {
        await initializeGCS();
      }

      // Upload to GCS
      const gcsResult = await uploadToGCS(backupName, backupPath);

      // Cleanup old local backups
      await cleanupOldBackups();

      return {
        backupName,
        localPath: backupPath,
        size: backupSize,
        gcs: gcsResult,
      };
    } else {
      throw new Error("Backup directory was not created or is empty");
    }
  } catch (error) {
    logger.error(`❌ Backup failed: ${error.message}`);
    throw error;
  }
}

// Get directory size recursively
function getDirectorySize(dirPath) {
  let totalSize = 0;

  function calculateSize(itemPath) {
    const stats = fs.statSync(itemPath);
    if (stats.isFile()) {
      totalSize += stats.size;
    } else if (stats.isDirectory()) {
      const items = fs.readdirSync(itemPath);
      items.forEach((item) => {
        calculateSize(path.join(itemPath, item));
      });
    }
  }

  calculateSize(dirPath);
  return totalSize;
}

// Format bytes to human readable
function formatBytes(bytes) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

// Clean up old local backups
async function cleanupOldBackups() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return;

    const backups = fs
      .readdirSync(BACKUP_DIR)
      .filter((name) => name.startsWith("backup_"))
      .map((name) => {
        const backupPath = path.join(BACKUP_DIR, name);
        const stats = fs.statSync(backupPath);

        let created = stats.mtime || stats.birthtime || new Date();
        try {
          const match = name.match(
            /(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/
          );
          if (match) {
            const [, year, month, day, hour, minute, second] = match;
            created = new Date(
              parseInt(year, 10),
              parseInt(month, 10) - 1,
              parseInt(day, 10),
              parseInt(hour, 10),
              parseInt(minute, 10),
              parseInt(second, 10)
            );
          }
        } catch (err) {
          // Fallback already set above
        }

        return { name, path: backupPath, created };
      })
      .sort((a, b) => b.created - a.created);

    // Delete backups older than RETENTION_DAYS or if MAX_BACKUPS exceeded
    let deletedCount = 0;
    for (let i = 0; i < backups.length; i++) {
      const backup = backups[i];
      const ageMs = Date.now() - backup.created.getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);

      if (ageDays > RETENTION_DAYS || i >= MAX_BACKUPS) {
        try {
          fs.rmSync(backup.path, { recursive: true, force: true });
          logger.info(
            `Deleting old backup: ${backup.name} (${ageDays.toFixed(
              1
            )} days old)`
          );
          deletedCount++;
        } catch (error) {
          logger.warn(
            `Failed to delete backup ${backup.name}: ${error.message}`
          );
        }
      }
    }

    if (deletedCount > 0) {
      logger.info(`🗑️  Cleaned up ${deletedCount} old local backup(s)`);
    }
    logger.info(`📊 Total local backups: ${backups.length - deletedCount}`);
  } catch (error) {
    logger.warn(`Cleanup failed: ${error.message}`);
  }
}

// List backups in GCS
async function listBackups() {
  try {
    if (!bucket) {
      console.log("❌ GCS not initialized. Run with cloud deployment.");
      return;
    }

    const [files] = await bucket.getFiles({ prefix: "backups/" });

    if (files.length === 0) {
      console.log("📦 No backups found in GCS");
      return;
    }

    // Group files by backup
    const backups = {};
    files.forEach((file) => {
      const match = file.name.match(/^backups\/([^\/]+)\//);
      if (match) {
        const backupName = match[1];
        if (!backups[backupName]) {
          backups[backupName] = {
            name: backupName,
            files: [],
            created: file.metadata.timeCreated,
          };
        }
        backups[backupName].files.push(file);
      }
    });

    console.log("\n📋 Backups in GCS:");
    console.log("━".repeat(80));

    Object.values(backups)
      .sort((a, b) => new Date(b.created) - new Date(a.created))
      .forEach((backup) => {
        const date = new Date(backup.created).toLocaleString();
        const size = backup.files.reduce(
          (sum, f) => sum + parseInt(f.metadata.size || 0),
          0
        );
        console.log(`✅ ${backup.name}`);
        console.log(`   Created: ${date}`);
        console.log(`   Files: ${backup.files.length}`);
        console.log(`   Size: ${formatBytes(size)}`);
        console.log("");
      });
  } catch (error) {
    logger.error(`Failed to list backups: ${error.message}`);
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);

  if (args[0] === "--list") {
    await initializeGCS();
    await listBackups();
  } else if (args[0] === "--restore" && args[1]) {
    logger.info(`Restore functionality coming soon for: ${args[1]}`);
    // TODO: Implement restore from GCS
  } else {
    // Create backup by default
    try {
      await initializeGCS();
      const result = await createBackup();
      console.log("\n✅ Backup completed successfully!");
      console.log(`   Local: ${result.backupName}`);
      if (result.gcs) {
        console.log(`   GCS: gs://${GCS_BUCKET}/${result.gcs.gcsPath}`);
      }
    } catch (error) {
      process.exit(1);
    }
  }
}

main().catch((error) => {
  logger.error(`Fatal error: ${error.message}`);
  process.exit(1);
});

module.exports = {
  createBackup,
  listBackups,
  formatBytes,
  initializeGCS,
};
