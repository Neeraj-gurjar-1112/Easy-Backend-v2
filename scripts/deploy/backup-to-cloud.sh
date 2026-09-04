#!/bin/bash

###############################################################################
# MongoDB Backup to Google Cloud Storage Script
#
# This script performs automated backups of MongoDB and uploads them to GCS.
# It's designed to run as a cron job or one-time manual backup.
#
# Environment Variables Required:
#   - DB_CONNECTION_STRING: MongoDB connection URI
#   - GCS_BACKUP_BUCKET: GCS bucket name (e.g., gs://my-backup-bucket)
#   - Optional: RETENTION_DAYS (default: 30 days)
#
# Usage:
#   chmod +x backup-to-cloud.sh
#   ./backup-to-cloud.sh                 # Create and upload backup
#   ./backup-to-cloud.sh cleanup         # Remove old backups from GCS
#   ./backup-to-cloud.sh list            # List backups in GCS
#
# Notes:
#   - mongodump must be installed and in PATH
#   - gcloud CLI must be configured with proper GCS permissions
#   - Service account must have Storage Admin role for the bucket
#
###############################################################################

set -e  # Exit on error

# Color output for better readability
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
BACKUP_DIR="${BACKUP_DIR:-.}/backups/backup_easy_app_${TIMESTAMP}"
GCS_BUCKET="${GCS_BACKUP_BUCKET:=gs://easy-grocery-backups}"  # Change this to your bucket
RETENTION_DAYS="${RETENTION_DAYS:=30}"
LOG_FILE="${LOG_FILE:=./logs/backup-$(date +%Y%m%d).log}"

# Ensure log directory exists
mkdir -p "$(dirname "$LOG_FILE")"

# Logging function
log() {
  local level=$1
  shift
  local message="$@"
  local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
  echo -e "${timestamp} [${level}] ${message}" | tee -a "$LOG_FILE"
}

# Error handler
on_error() {
  local line_number=$1
  log "ERROR" "${RED}Error occurred at line ${line_number}${NC}"
  exit 1
}

trap 'on_error ${LINENO}' ERR

# Main backup function
create_backup() {
  log "INFO" "${BLUE}Starting MongoDB backup to Google Cloud Storage...${NC}"
  
  # Validate environment variables
  if [ -z "$DB_CONNECTION_STRING" ]; then
    log "ERROR" "${RED}DB_CONNECTION_STRING not set!${NC}"
    exit 1
  fi
  
  # Check if mongodump is installed
  if ! command -v mongodump &> /dev/null; then
    log "ERROR" "${RED}mongodump not found in PATH!${NC}"
    log "ERROR" "Install MongoDB Database Tools:"
    log "ERROR" "  Ubuntu/Debian: sudo apt-get install -y mongodb-database-tools"
    log "ERROR" "  macOS: brew install mongodb-database-tools"
    log "ERROR" "  Alpine: See Dockerfile for installation"
    exit 1
  fi
  
  # Check if gcloud is installed
  if ! command -v gcloud &> /dev/null; then
    log "ERROR" "${RED}gcloud CLI not found in PATH!${NC}"
    log "ERROR" "Install Google Cloud SDK: https://cloud.google.com/sdk/docs/install"
    exit 1
  fi
  
  # Create backup directory
  mkdir -p "$BACKUP_DIR"
  log "INFO" "Backup directory: $BACKUP_DIR"
  
  # Run mongodump
  log "INFO" "Running mongodump..."
  if mongodump --uri="$DB_CONNECTION_STRING" --out="$BACKUP_DIR" 2>&1 | tee -a "$LOG_FILE"; then
    log "INFO" "${GREEN}✅ mongodump completed successfully${NC}"
  else
    log "ERROR" "${RED}❌ mongodump failed!${NC}"
    exit 1
  fi
  
  # Calculate backup size
  BACKUP_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)
  log "INFO" "Backup size: $BACKUP_SIZE"
  
  # Upload to GCS
  log "INFO" "Uploading backup to GCS: $GCS_BUCKET"
  if gcloud storage cp -r "$BACKUP_DIR" "$GCS_BUCKET/mongodb-backups/" 2>&1 | tee -a "$LOG_FILE"; then
    log "INFO" "${GREEN}✅ Backup uploaded to GCS successfully${NC}"
    
    # Clean up local backup directory after successful upload
    log "INFO" "Cleaning up local backup directory..."
    rm -rf "$BACKUP_DIR"
    log "INFO" "${GREEN}✅ Local backup directory cleaned up${NC}"
    
    return 0
  else
    log "ERROR" "${RED}❌ Failed to upload backup to GCS!${NC}"
    log "ERROR" "Local backup preserved at: $BACKUP_DIR"
    exit 1
  fi
}

# List backups in GCS
list_backups() {
  log "INFO" "${BLUE}Listing backups in GCS...${NC}"
  
  if gcloud storage ls "$GCS_BUCKET/mongodb-backups/" 2>&1 | tee -a "$LOG_FILE"; then
    log "INFO" "${GREEN}✅ Backup list retrieved${NC}"
  else
    log "ERROR" "${RED}❌ Failed to list backups!${NC}"
    exit 1
  fi
}

# Clean up old backups from GCS
cleanup_old_backups() {
  log "INFO" "${BLUE}Cleaning up backups older than ${RETENTION_DAYS} days...${NC}"
  
  local cutoff_date=$(date -d "$RETENTION_DAYS days ago" +%Y-%m-%d)
  log "INFO" "Cutoff date: $cutoff_date"
  
  # List all backups and filter by date
  gcloud storage ls --recursive "$GCS_BUCKET/mongodb-backups/" | while read backup; do
    # Extract date from backup path (format: backup_easy_app_YYYY-MM-DD_...)
    local backup_date=$(echo "$backup" | grep -oP '\d{4}-\d{2}-\d{2}' | head -1)
    
    if [[ ! -z "$backup_date" ]] && [[ "$backup_date" < "$cutoff_date" ]]; then
      log "INFO" "Deleting old backup: $backup"
      if gcloud storage rm "$backup" 2>&1 | tee -a "$LOG_FILE"; then
        log "INFO" "${GREEN}✅ Deleted: $backup${NC}"
      else
        log "WARN" "${YELLOW}⚠️  Failed to delete: $backup${NC}"
      fi
    fi
  done
  
  log "INFO" "${GREEN}✅ Cleanup completed${NC}"
}

# Main script logic
main() {
  case "${1:-backup}" in
    backup)
      create_backup
      ;;
    list)
      list_backups
      ;;
    cleanup)
      cleanup_old_backups
      ;;
    *)
      log "ERROR" "Unknown command: $1"
      log "INFO" "Usage: $0 [backup|list|cleanup]"
      exit 1
      ;;
  esac
}

# Run main function
main "$@"

log "INFO" "${GREEN}✅ Backup script completed successfully${NC}"
