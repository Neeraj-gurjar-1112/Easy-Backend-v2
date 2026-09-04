const logger = require("@util/logger");

// The backup script is required lazily inside each handler (as in legacy):
// scripts/backup-db-gcs.js runs main() at load time, so it must never be
// required at module scope.

class BackupController {
  // Manual backup trigger (admin only)
  async triggerBackup(req, res) {
    try {
      const { createBackup } = require("@root/scripts/backup-db-gcs");
      const result = await createBackup();
      res.json({
        success: true,
        message: "Backup completed successfully",
        backupName: result.backupName,
        gcs: result.gcs,
      });
    } catch (error) {
      console.error("Manual backup failed:", error);
      res.status(500).json({
        success: false,
        error: "Backup failed",
        message: error.message,
      });
    }
  }

  // ========================================
  // MANUAL BACKUP TRIGGER (Admin only - for testing)
  // ========================================
  // NOTE: unauthenticated in legacy app.js - tighten later
  async backupNow(req, res) {
    try {
      logger.info("📦 Manual backup triggered via API");
      // Use GCS-enabled backup script so daily backups are uploaded to Cloud Storage
      const { createBackup } = require("@root/scripts/backup-db-gcs");
      const result = await createBackup();

      // Check if backup was successful
      if (result && result.success === false) {
        return res.status(400).json({
          success: false,
          error: result.reason || "Backup tools not available",
          message: "Install mongodump to enable backups",
        });
      }

      res.json({
        success: true,
        message: "Backup completed successfully",
        backupName: result.backupName,
        gcs: result.gcs || null,
      });
    } catch (error) {
      logger.error(`Manual backup failed: ${error.message}`);
      res.status(500).json({
        success: false,
        error: "Backup failed: " + error.message,
      });
    }
  }
}

module.exports = new BackupController();
