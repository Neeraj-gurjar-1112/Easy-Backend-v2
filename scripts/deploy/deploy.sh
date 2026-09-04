#!/bin/bash

#################################################
# Easy App Backend - Cloud Run Deployment Script
#################################################
#
# This script automates deployment to Google Cloud Run
# Run this from your GitHub Codespace (Linux environment)
#
# Prerequisites:
# - gcloud CLI installed and authenticated
# - Docker installed
# - All secrets created in GCP Secret Manager
# - redis npm package installed (npm install redis)
#
# Usage: ./deploy.sh
#

set -e  # Exit on any error

# ============================================
# CONFIGURATION - UPDATE THESE VALUES
# ============================================

PROJECT_ID="easy-grocery-521d5"          # Your GCP Project ID
REGION="asia-south1"                        # Your region
SERVICE_NAME="easy-backend"                 # Cloud Run service name
MEMORY="512Mi"                              # Memory allocation
CPU="1"                                     # CPU allocation
MAX_INSTANCES="10"                          # Max autoscaling instances
TIMEOUT="300"                               # Request timeout in seconds

# ============================================
# Color Output
# ============================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ============================================
# Helper Functions
# ============================================

info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

success() {
    echo -e "${GREEN}✅ $1${NC}"
}

warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

error() {
    echo -e "${RED}❌ $1${NC}"
    exit 1
}

# ============================================
# Pre-deployment Checks
# ============================================

info "Starting pre-deployment checks..."

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    error "gcloud CLI not found. Please install Google Cloud SDK."
fi

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    error "Docker not found. Please install Docker."
fi

# Check if we're in the Backend directory
if [ ! -f "package.json" ]; then
    error "package.json not found. Please run this script from the Backend directory."
fi

# Check if redis package is installed
if ! grep -q '"redis"' package.json; then
    warning "Redis package not found in package.json."
    read -p "Do you want to install it now? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        npm install redis
        success "Redis package installed"
    else
        warning "Continuing without redis package (may cause issues)"
    fi
fi

# Verify gcloud is authenticated
info "Checking gcloud authentication..."
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q "."; then
    error "Not authenticated with gcloud. Run: gcloud auth login"
fi

# Set project
info "Setting GCP project to: $PROJECT_ID"
gcloud config set project "$PROJECT_ID" || error "Failed to set project"

success "Pre-deployment checks passed!"
echo

# ============================================
# Build Docker Image
# ============================================

info "Building Docker image..."

IMAGE_PATH="${REGION}-docker.pkg.dev/${PROJECT_ID}/cloud-run-source-deploy/${SERVICE_NAME}"

info "Image path: $IMAGE_PATH"

# Use Cloud Build (recommended) or local Docker build
read -p "Use Cloud Build (recommended) or local Docker build? (cloud/local) [cloud]: " BUILD_METHOD
BUILD_METHOD=${BUILD_METHOD:-cloud}

if [ "$BUILD_METHOD" = "cloud" ]; then
    info "Building with Cloud Build (takes 2-3 minutes)..."
    gcloud builds submit --tag "$IMAGE_PATH" || error "Build failed"
    success "Cloud Build complete!"
else
    info "Building with local Docker..."
    docker build -t "$IMAGE_PATH" . || error "Docker build failed"
    
    info "Pushing image to Artifact Registry..."
    docker push "$IMAGE_PATH" || error "Docker push failed"
    success "Docker build and push complete!"
fi

echo

# ============================================
# Deploy to Cloud Run
# ============================================

info "Deploying to Cloud Run..."
info "Service: $SERVICE_NAME"
info "Region: $REGION"
info "Memory: $MEMORY"
info "CPU: $CPU"
info "Max instances: $MAX_INSTANCES"

# Deploy command with all secrets
gcloud run deploy "$SERVICE_NAME" \
  --image "$IMAGE_PATH" \
  --region "$REGION" \
  --allow-unauthenticated \
  --platform managed \
  --memory "$MEMORY" \
  --cpu "$CPU" \
  --timeout "$TIMEOUT" \
  --max-instances "$MAX_INSTANCES" \
  --set-secrets "\
DB_CONNECTION_STRING=DB_CONNECTION_STRING:latest,\
DB_NAME=DB_NAME:latest,\
FCM_SERVER_KEY=FCM_SERVER_KEY:latest,\
FCM_SENDER_ID=FCM_SENDER_ID:latest,\
GOOGLE_MAPS_API_KEY=GOOGLE_MAPS_API_KEY:latest,\
UPI_VPA=UPI_VPA:latest,\
UPI_PAYER_NAME=UPI_PAYER_NAME:latest,\
UPI_NOTE_PREFIX=UPI_NOTE_PREFIX:latest,\
AUTO_VERIFY_CLAIMS=AUTO_VERIFY_CLAIMS:latest,\
JWT_SECRET=JWT_SECRET:latest,\
ADMIN_API_KEY=ADMIN_API_KEY:latest,\
REDIS_URL=REDIS_URL:latest,\
CDN_PROVIDER=CDN_PROVIDER:latest,\
CDN_DOMAIN=CDN_DOMAIN:latest,\
CDN_PREFIX=CDN_PREFIX:latest,\
GEOCODE_SERVER_FALLBACK=GEOCODE_SERVER_FALLBACK:latest,\
GOOGLE_APPLICATION_CREDENTIALS=FIREBASE_ADMIN_CREDENTIALS:latest,\
ALLOWED_ORIGINS=ALLOWED_ORIGINS:latest" \
  --set-env-vars "\
NODE_ENV=production,\
PORT=8080" || error "Deployment failed"

success "Deployment complete!"
echo

# ============================================
# Post-Deployment Verification
# ============================================

info "Running post-deployment checks..."

# Get service URL
SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" --region="$REGION" --format="value(status.url)")
success "Service URL: $SERVICE_URL"

# Wait for service to be ready
info "Waiting for service to be ready (10 seconds)..."
sleep 10

# Test health endpoint
info "Testing health endpoint..."
HEALTH_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "${SERVICE_URL}/health" || echo "000")

if [ "$HEALTH_RESPONSE" = "200" ]; then
    success "Health check passed! ✅"
    
    # Show health details
    info "Health details:"
    curl -s "${SERVICE_URL}/health" | jq . || echo "Note: Install jq for pretty JSON output"
else
    warning "Health check returned: $HEALTH_RESPONSE"
    warning "Service may still be starting. Check logs with:"
    echo "    gcloud run logs tail $SERVICE_NAME --region=$REGION"
fi

echo

# ============================================
# Summary
# ============================================

echo "=================================="
echo "📋 DEPLOYMENT SUMMARY"
echo "=================================="
echo "Service Name:    $SERVICE_NAME"
echo "Region:          $REGION"
echo "Image:           $IMAGE_PATH"
echo "Service URL:     $SERVICE_URL"
echo "=================================="
echo
success "Deployment complete! 🚀"
echo
info "Next steps:"
echo "  1. View logs: gcloud run logs tail $SERVICE_NAME --region=$REGION --follow"
echo "  2. Test API: curl ${SERVICE_URL}/health"
echo "  3. Update Flutter app API_BASE_URL to: $SERVICE_URL"
echo "  4. Update ALLOWED_ORIGINS secret to include: $SERVICE_URL"
echo
info "Useful commands:"
echo "  - List services:     gcloud run services list"
echo "  - Describe service:  gcloud run services describe $SERVICE_NAME --region=$REGION"
echo "  - View metrics:      gcloud run services describe $SERVICE_NAME --region=$REGION --format=yaml"
echo "  - Delete service:    gcloud run services delete $SERVICE_NAME --region=$REGION"
echo

# ============================================
# Optional: Update ALLOWED_ORIGINS
# ============================================

warning "IMPORTANT: Update ALLOWED_ORIGINS secret!"
echo "Your new Cloud Run URL needs to be added to ALLOWED_ORIGINS for CORS to work."
echo
echo "Run this command:"
echo "  echo -n \"$SERVICE_URL,http://localhost:3000\" | gcloud secrets versions add ALLOWED_ORIGINS --data-file=-"
echo
echo "Then redeploy:"
echo "  gcloud run services update $SERVICE_NAME --region=$REGION"
echo

read -p "Do you want to update ALLOWED_ORIGINS now? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    info "Updating ALLOWED_ORIGINS secret..."
    echo -n "$SERVICE_URL,http://localhost:3000" | gcloud secrets versions add ALLOWED_ORIGINS --data-file=-
    
    info "Redeploying to pick up new secret..."
    gcloud run services update "$SERVICE_NAME" --region="$REGION"
    
    success "ALLOWED_ORIGINS updated!"
fi

success "All done! 🎉"
