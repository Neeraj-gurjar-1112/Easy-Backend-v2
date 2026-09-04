require("module-alias/register");
#!/usr/bin/env node

/**
 * MongoDB Backup Script
 *
 * This script creates automated backups of the MongoDB database using mongodump.
 * Backups are stored with timestamps and old backups are automatically cleaned up.
 *
 * Usage:
 *   node backup-db.js               # Create backup now
 *   node backup-db.js --restore     # List available backups for restoration
 *   node backup-db.js --restore <backup-name>  # Restore specific backup
 *
 * Requirements:
 *   - MongoDB tools (mongodump/mongorestore) must be installed
 *   - DB_CONNECTION_STRING in .env file
 */

const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const logger = require("../lib/util/logger");

// Configuration
const BACKUP_DIR = path.join(__dirname, "..", "backups");
const DB_URI =
  process.env.DB_CONNECTION_STRING || "mongodb://127.0.0.1:27017/easy_app";
const RETENTION_DAYS = 7; // Keep backups for 7 days
const MAX_BACKUPS = 14; // Maximum number of backups to keep

// Parse database name from connection string
function getDatabaseName(uri) {
  const match = uri.match(/\/([^\/\?]+)(\?|$)/);
  return match ? match[1] : "easy_app";
}

const DB_NAME = getDatabaseName(DB_URI);

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
  return `backup_${DB_NAME}_${timestamp}`;
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

// Execute shell command with promise
function execCommand(command) {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

// Create database backup
async function createBackup() {
  try {
    // Check if mongodump is installed
    const isInstalled = await checkMongoDumpInstalled();
    if (!isInstalled) {
      const errorMsg = `
⚠️ MongoDB Database Tools not installed - Backups disabled

To enable automatic backups, install mongodump:

Windows:
1. Download from: https://www.mongodb.com/try/download/database-tools
2. Extract the zip file
3. Add the bin folder to your PATH environment variable
4. Restart terminal and verify: mongodump --version

Alternative (MongoDB Compass):
If you have MongoDB Compass installed, mongodump might be at:
C:\\Program Files\\MongoDB\\Tools\\100\\bin\\mongodump.exe
Add this path to your system PATH.

Linux/Mac:
brew install mongodb-database-tools
OR
sudo apt-get install mongodb-database-tools

Backups are optional for development. Production servers should have this configured.
`;
      logger.warn(errorMsg);
      // Return null instead of throwing - makes backups optional
      return { success: false, reason: "mongodump not installed" };
    }

    ensureBackupDir();

    const backupName = generateBackupName();
    const backupPath = path.join(BACKUP_DIR, backupName);

    logger.info(`Starting database backup: ${backupName}`);
    logger.info(`Database: ${DB_NAME}`);
    logger.info(`Backup location: ${backupPath}`);

    // Build mongodump command
    const command = `mongodump --uri="${DB_URI}" --out="${backupPath}"`;

    // Execute backup
    const result = await execCommand(command);

    // Check if backup was successful
    if (fs.existsSync(backupPath)) {
      const backupSize = getDirectorySize(backupPath);
      logger.info(`✅ Backup completed successfully`);
      logger.info(`   Backup name: ${backupName}`);
      logger.info(`   Size: ${formatBytes(backupSize)}`);

      // Cleanup old backups
      await cleanupOldBackups();

      return backupName;
    } else {
      throw new Error("Backup directory was not created");
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

// Clean up old backups
async function cleanupOldBackups() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return;

    const backups = fs
      .readdirSync(BACKUP_DIR)
      .filter((name) => name.startsWith("backup_"))
      .map((name) => {
        const backupPath = path.join(BACKUP_DIR, name);
        const stats = fs.statSync(backupPath);
        return {
          name,
          path: backupPath,
          created: stats.birthtime,
          size: getDirectorySize(backupPath),
        };
      })
      .sort((a, b) => b.created - a.created); // Sort newest first

    const now = new Date();
    let deleted = 0;

    // Delete backups older than retention days or exceeding max count
    for (let i = 0; i < backups.length; i++) {
      const backup = backups[i];
      const age = (now - backup.created) / (1000 * 60 * 60 * 24); // days

      if (age > RETENTION_DAYS || i >= MAX_BACKUPS) {
        logger.info(
          `Deleting old backup: ${backup.name} (${age.toFixed(1)} days old)`
        );
        fs.rmSync(backup.path, { recursive: true, force: true });
        deleted++;
      }
    }

    if (deleted > 0) {
      logger.info(`🗑️  Cleaned up ${deleted} old backup(s)`);
    }

    logger.info(`📊 Total backups: ${backups.length - deleted}`);
  } catch (error) {
    logger.error(`Cleanup error: ${error.message}`);
  }
}

// List all available backups
function listBackups() {
  ensureBackupDir();

  const backups = fs
    .readdirSync(BACKUP_DIR)
    .filter((name) => name.startsWith("backup_"))
    .map((name) => {
      const backupPath = path.join(BACKUP_DIR, name);
      const stats = fs.statSync(backupPath);
      return {
        name,
        created: stats.birthtime,
        size: getDirectorySize(backupPath),
      };
    })
    .sort((a, b) => b.created - a.created);

  if (backups.length === 0) {
    console.log("No backups found.");
    return [];
  }

  console.log("\n📦 Available Backups:\n");
  backups.forEach((backup, i) => {
    console.log(`${i + 1}. ${backup.name}`);
    console.log(`   Created: ${backup.created.toLocaleString()}`);
    console.log(`   Size: ${formatBytes(backup.size)}\n`);
  });

  return backups;
}

// Restore database from backup
async function restoreBackup(backupName) {
  try {
    const backupPath = path.join(BACKUP_DIR, backupName, DB_NAME);

    if (!fs.existsSync(backupPath)) {
      throw new Error(`Backup not found: ${backupName}`);
    }

    logger.warn(`⚠️  CAUTION: This will replace the current database!`);
    logger.info(`Restoring from backup: ${backupName}`);

    // Build mongorestore command (drop existing collections)
    const command = `mongorestore --uri="${DB_URI}" --drop "${backupPath}"`;

    // Execute restore
    await execCommand(command);

    logger.info(`✅ Database restored successfully from ${backupName}`);
  } catch (error) {
    logger.error(`❌ Restore failed: ${error.message}`);
    throw error;
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);

  try {
    if (args.includes("--restore")) {
      // Restore mode
      const backupIndex = args.indexOf("--restore");
      const backupName = args[backupIndex + 1];

      if (!backupName) {
        // List backups for selection
        listBackups();
        console.log("Usage: node backup-db.js --restore <backup-name>");
      } else {
        await restoreBackup(backupName);
      }
    } else if (args.includes("--list")) {
      // List mode
      listBackups();
    } else {
      // Default: Create backup
      await createBackup();
    }
  } catch (error) {
    logger.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

// Export for use as module
module.exports = {
  createBackup,
  restoreBackup,
  listBackups,
  cleanupOldBackups,
};
