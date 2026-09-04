#!/bin/bash

###############################################################################
# Google Cloud Run Deployment Script for Easy-Backend
#
# This script automates the deployment of the Easy-Backend service to Google
# Cloud Run with all necessary environment variables, secrets, and features.
#
# Prerequisites:
#   - Google Cloud SDK (gcloud CLI) installed and configured
#   - Docker installed locally
#   - Artifact Registry created (asia-south1-docker.pkg.dev/...)
#   - MongoDB Atlas connection string
#   - GCS bucket for backups (gs://easy-grocery-backups)
#   - All required secrets configured in Google Secret Manager
#
# Features integrated:
#   - MongoDB automated backups (daily at 2 AM UTC)
#   - Cron jobs for order timeout checks and pending order retries
#   - Sentry error monitoring
#   - Redis caching
#   - Cloud Storage integration for backups
#
# Usage:
#   chmod +x deploy-to-cloud-run.sh
#   ./deploy-to-cloud-run.sh [--test|--production]
#   ./deploy-to-cloud-run.sh --help
#
###############################################################################

set -e

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
PROJECT_ID="easy-grocery-521d5"
REGION="asia-south1"
SERVICE_NAME="easy-backend"
DOCKER_REGISTRY="${REGION}-docker.pkg.dev"
REPOSITORY="easy-backend"
IMAGE_NAME="api"
ARTIFACT_REGISTRY="${DOCKER_REGISTRY}/${PROJECT_ID}/${REPOSITORY}/${IMAGE_NAME}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
IMAGE_TAG="${ARTIFACT_REGISTRY}:${TIMESTAMP}"
GCS_BUCKET="easy-grocery-backups"  # Change to your actual bucket
ENVIRONMENT="${1:--production}"

# Logging
log() {
  local level=$1
  shift
  echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} ${level}: $@"
}

error() {
  echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $@${NC}" >&2
  exit 1
}

success() {
  echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')] ✅ $@${NC}"
}

warning() {
  echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] ⚠️  $@${NC}"
}

# Helper function to display usage
usage() {
  echo "Usage: $0 [--test|--production|--help]"
  echo ""
  echo "Options:"
  echo "  --test          Deploy to test/staging environment (with debug logging)"
  echo "  --production    Deploy to production environment (default)"
  echo "  --help          Display this help message"
  echo ""
  echo "Before running this script:"
  echo "  1. Configure gcloud: gcloud config set project $PROJECT_ID"
  echo "  2. Ensure Docker is running and authenticated: gcloud auth configure-docker"
  echo "  3. Verify Artifact Registry exists: gcloud artifacts repositories list"
  echo "  4. Create GCS bucket: gsutil mb gs://${GCS_BUCKET}"
  echo "  5. Configure secrets in Secret Manager"
  exit 0
}

# Validate prerequisites
validate_prerequisites() {
  log "INFO" "Validating prerequisites..."
  
  # Check gcloud
  if ! command -v gcloud &> /dev/null; then
    error "gcloud CLI not found. Install from: https://cloud.google.com/sdk/docs/install"
  fi
  
  # Check Docker
  if ! command -v docker &> /dev/null; then
    error "Docker not found. Install from: https://www.docker.com"
  fi
  
  # Check if Docker daemon is running
  if ! docker info &> /dev/null; then
    error "Docker daemon is not running. Please start Docker."
  fi
  
  # Verify gcloud authentication
  if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" &> /dev/null; then
    error "gcloud not authenticated. Run: gcloud auth login"
  fi
  
  success "All prerequisites validated"
}

# Configure gcloud
configure_gcloud() {
  log "INFO" "Configuring gcloud..."
  
  gcloud config set project "$PROJECT_ID"
  gcloud auth configure-docker "$DOCKER_REGISTRY" --quiet
  
  success "gcloud configured"
}

# Build Docker image
build_image() {
  log "INFO" "Building Docker image..."
  log "INFO" "Tag: $IMAGE_TAG"
  
  cd Backend
  
  if docker build -t "$IMAGE_TAG" .; then
    success "Docker image built successfully"
  else
    error "Docker build failed"
  fi
  
  cd ..
}

# Push image to Artifact Registry
push_image() {
  log "INFO" "Pushing image to Artifact Registry..."
  
  if docker push "$IMAGE_TAG"; then
    success "Image pushed successfully: $IMAGE_TAG"
  else
    error "Failed to push image"
  fi
}

# Create GCS bucket if it doesn't exist
ensure_gcs_bucket() {
  log "INFO" "Checking GCS bucket..."
  
  if gsutil ls -b "gs://${GCS_BUCKET}" &> /dev/null; then
    success "GCS bucket exists: gs://${GCS_BUCKET}"
  else
    log "INFO" "Creating GCS bucket..."
    if gsutil mb -p "$PROJECT_ID" -l "$REGION" "gs://${GCS_BUCKET}"; then
      success "GCS bucket created: gs://${GCS_BUCKET}"
    else
      warning "Could not create GCS bucket. Ensure you have proper permissions."
    fi
  fi
}

# Deploy to Cloud Run
deploy_to_cloud_run() {
  log "INFO" "Deploying to Cloud Run..."
  log "INFO" "Service: $SERVICE_NAME"
  log "INFO" "Region: $REGION"
  log "INFO" "Image: $IMAGE_TAG"
  
  # Prepare environment variables based on deployment type
  if [[ "$ENVIRONMENT" == "--test" ]]; then
    log "INFO" "Deploying to TEST environment with debug logging"
    ENV_VARS="NODE_ENV=staging,LOG_LEVEL=debug"
  else
    log "INFO" "Deploying to PRODUCTION environment"
    ENV_VARS="NODE_ENV=production"
  fi
  
  # Deploy with all secrets and environment variables
  gcloud run deploy "$SERVICE_NAME" \
    --image "$IMAGE_TAG" \
    --region "$REGION" \
    --allow-unauthenticated \
    --timeout 3600 \
    --max-instances 100 \
    --memory 1Gi \
    --cpu 1 \
    --set-secrets "\
DB_CONNECTION_STRING=DB_CONNECTION_STRING:latest,\
FCM_SERVER_KEY=FCM_SERVER_KEY:latest,\
DB_NAME=DB_NAME:latest,\
UPI_VPA=UPI_VPA:latest,\
UPI_PAYER_NAME=UPI_PAYER_NAME:latest,\
UPI_NOTE_PREFIX=UPI_NOTE_PREFIX:latest,\
AUTO_VERIFY_CLAIMS=AUTO_VERIFY_CLAIMS:latest,\
FCM_SENDER_ID=FCM_SENDER_ID:latest,\
GOOGLE_MAPS_API_KEY=GOOGLE_MAPS_API_KEY:latest,\
SENTRY_DSN=SENTRY_DSN:latest,\
FIREBASE_ADMIN_SDK=FIREBASE_ADMIN_SDK:latest" \
    --set-env-vars "$ENV_VARS,GCS_BACKUP_BUCKET=gs://${GCS_BUCKET}" \
    --service-account="${SERVICE_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
    --quiet
  
  if [ $? -eq 0 ]; then
    success "Deployed to Cloud Run successfully"
  else
    error "Cloud Run deployment failed"
  fi
}

# Display deployment information
display_deployment_info() {
  log "INFO" "Retrieving deployment information..."
  
  local service_url=$(gcloud run services describe "$SERVICE_NAME" \
    --region "$REGION" \
    --format='value(status.url)')
  
  echo ""
  echo "=========================================="
  success "Deployment Complete!"
  echo "=========================================="
  echo ""
  echo "Service URL: $service_url"
  echo "Service Name: $SERVICE_NAME"
  echo "Region: $REGION"
  echo "Image: $IMAGE_TAG"
  echo ""
  echo "📋 Important Features Deployed:"
  echo "  ✅ Automated MongoDB backups (Daily at 2 AM UTC)"
  echo "  ✅ GCS backup integration (gs://${GCS_BUCKET})"
  echo "  ✅ Order timeout checks (Every 5 minutes)"
  echo "  ✅ Pending order retry logic (Every 5 minutes)"
  echo "  ✅ Health checks enabled"
  echo "  ✅ Sentry error monitoring"
  echo "  ✅ Redis caching"
  echo ""
  echo "🔍 Monitor your service:"
  echo "  gcloud run services describe $SERVICE_NAME --region $REGION"
  echo "  gcloud logging read \"resource.type=cloud_run_revision AND resource.labels.service_name=$SERVICE_NAME\" --limit 50"
  echo ""
  echo "📊 View logs:"
  echo "  gcloud run services logs read $SERVICE_NAME --region $REGION"
  echo ""
  echo "🔧 View backup status:"
  echo "  gsutil ls gs://${GCS_BUCKET}/mongodb-backups/"
  echo ""
}

# Main deployment flow
main() {
  case "$1" in
    --help|-h)
      usage
      ;;
    --test|--production)
      ENVIRONMENT="$1"
      log "INFO" "Starting Easy-Backend deployment to Cloud Run..."
      log "INFO" "Environment: $ENVIRONMENT"
      echo ""
      
      validate_prerequisites
      configure_gcloud
      build_image
      push_image
      ensure_gcs_bucket
      deploy_to_cloud_run
      display_deployment_info
      
      success "All deployment steps completed!"
      ;;
    *)
      warning "Invalid option: $1"
      usage
      ;;
  esac
}

# Run main function
main "$@"
