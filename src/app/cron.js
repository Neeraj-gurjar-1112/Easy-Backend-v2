/**
 * Scheduled jobs owned by the app service:
 *   - every 5 min : delivery timeout check + retry of unassigned pending orders
 *   - daily 02:00 : MongoDB dump uploaded to GCS
 * The delivery jobs call this process's own HTTP endpoints (same approach as the legacy app.js).
 */
const cron = require("node-cron");
const axios = require("axios");
const logger = require("@util/logger");

let started = false;

function startCron({ port }) {
  if (started) return;
  started = true;

  let cronJobRunning = false;
  cron.schedule(
    "*/5 * * * *",
    async () => {
      if (cronJobRunning) {
        logger.warn("Skipping cron job - previous execution still in progress");
        return;
      }
      cronJobRunning = true;
      const startTime = Date.now();
      try {
        const base = `http://localhost:${port}/api/delivery`;
        const { data: timeoutData } = await axios.post(`${base}/check-timeouts`, {}, { timeout: 25000 });
        if (timeoutData.timedOutOrders > 0) {
          logger.info(`Timeout Check: ${timeoutData.timedOutOrders} orders found, ${timeoutData.reassignedCount} reassigned`);
        }
        const { data: retryData } = await axios.post(`${base}/retry-pending-orders`, {}, { timeout: 25000 });
        if (retryData.assigned > 0 || retryData.escalated > 0) {
          logger.info(`Pending Retry: ${retryData.assigned} assigned, ${retryData.escalated} escalated (${retryData.total_pending} total pending)`);
        }
        const duration = Date.now() - startTime;
        if (duration > 120000) logger.warn(`Cron job took ${(duration / 1000).toFixed(1)}s`);
      } catch (error) {
        if (error.code !== "ECONNREFUSED") logger.error(`Cron job failed: ${error.message}`);
      } finally {
        cronJobRunning = false;
      }
    },
    { scheduled: true, timezone: "UTC" }
  );
  logger.info("Cron job scheduled: checking order timeouts & retrying pending orders every 5 minutes");

  cron.schedule("0 2 * * *", async () => {
    try {
      logger.info("Starting automated daily database backup to GCS...");
      const { createBackup } = require("@root/scripts/backup-db-gcs");
      const result = await createBackup();
      if (result && result.success === false) {
        logger.warn(`Backup skipped: ${result.reason}`);
        return;
      }
      logger.info(`Automated backup completed: ${result.backupName}`);
      if (result.gcs) logger.info(`Backup uploaded to GCS: ${result.gcs.uploadCount} files`);
    } catch (error) {
      logger.error(`Automated backup failed: ${error.message}`);
    }
  });
  logger.info("Automated backup scheduled: daily at 2:00 AM UTC (uploads to GCS)");
}

module.exports = { startCron };
