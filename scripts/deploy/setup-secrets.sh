#!/bin/bash

#################################################
# GCP Secret Manager Setup Script
#################################################
#
# This script creates all required secrets in GCP Secret Manager
# for the Easy App backend deployment.
#
# Run this ONCE before your first deployment.
# Run from your GitHub Codespace (Linux environment)
#
# Usage: ./setup-secrets.sh
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${BLUE}ℹ️  $1${NC}"; }
success() { echo -e "${GREEN}✅ $1${NC}"; }
warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
error() { echo -e "${RED}❌ $1${NC}"; exit 1; }

echo "================================================"
echo "🔐 GCP Secret Manager Setup"
echo "================================================"
echo

# Check if .env file exists
if [ ! -f ".env" ]; then
    error ".env file not found. Please create it first."
fi

info "Loading environment variables from .env file..."
source .env
success "Environment variables loaded"
echo

# Function to create or update secret
create_or_update_secret() {
    local SECRET_NAME=$1
    local SECRET_VALUE=$2
    
    if [ -z "$SECRET_VALUE" ]; then
        warning "Skipping $SECRET_NAME (value is empty)"
        return
    fi
    
    # Check if secret exists
    if gcloud secrets describe "$SECRET_NAME" &>/dev/null; then
        info "Secret $SECRET_NAME already exists, adding new version..."
        echo -n "$SECRET_VALUE" | gcloud secrets versions add "$SECRET_NAME" --data-file=-
        success "Updated $SECRET_NAME"
    else
        info "Creating secret $SECRET_NAME..."
        echo -n "$SECRET_VALUE" | gcloud secrets create "$SECRET_NAME" --data-file=-
        success "Created $SECRET_NAME"
    fi
}

# ============================================
# Required Secrets
# ============================================

info "Creating/updating required secrets..."
echo

# Database
create_or_update_secret "DB_CONNECTION_STRING" "$DB_CONNECTION_STRING"
create_or_update_secret "DB_NAME" "$DB_NAME"

# Firebase/FCM
create_or_update_secret "FCM_SERVER_KEY" "$FCM_SERVER_KEY"
create_or_update_secret "FCM_SENDER_ID" "$FCM_SENDER_ID"

# Google Maps
create_or_update_secret "GOOGLE_MAPS_API_KEY" "$GOOGLE_MAPS_API_KEY"
create_or_update_secret "GEOCODE_SERVER_FALLBACK" "${GEOCODE_SERVER_FALLBACK:-1}"

# UPI Payment
create_or_update_secret "UPI_VPA" "$UPI_VPA"
create_or_update_secret "UPI_PAYER_NAME" "$UPI_PAYER_NAME"
create_or_update_secret "UPI_NOTE_PREFIX" "$UPI_NOTE_PREFIX"

# Admin & Authentication
create_or_update_secret "JWT_SECRET" "$JWT_SECRET"
create_or_update_secret "ADMIN_API_KEY" "$ADMIN_API_KEY"

# Other Settings
create_or_update_secret "AUTO_VERIFY_CLAIMS" "${AUTO_VERIFY_CLAIMS:-true}"
create_or_update_secret "ALLOWED_ORIGINS" "$ALLOWED_ORIGINS"

# ============================================
# Optional Secrets
# ============================================

info "Creating/updating optional secrets..."
echo

# Redis (optional - for caching)
if [ -n "$REDIS_URL" ]; then
    create_or_update_secret "REDIS_URL" "$REDIS_URL"
else
    warning "REDIS_URL not set in .env"
    info "Redis is optional. Create this secret later if you want to enable caching."
    # Create with dummy value so deployment doesn't fail
    create_or_update_secret "REDIS_URL" "redis://localhost:6379"
fi

# CDN (optional - for image optimization)
create_or_update_secret "CDN_PROVIDER" "${CDN_PROVIDER:-cloudflare}"
create_or_update_secret "CDN_DOMAIN" "${CDN_DOMAIN:-}"
create_or_update_secret "CDN_PREFIX" "${CDN_PREFIX:-}"

echo
success "All secrets created/updated successfully!"
echo

# ============================================
# Verification
# ============================================

info "Verifying secrets..."
echo

REQUIRED_SECRETS=(
    "DB_CONNECTION_STRING"
    "DB_NAME"
    "FCM_SERVER_KEY"
    "FCM_SENDER_ID"
    "GOOGLE_MAPS_API_KEY"
    "UPI_VPA"
    "UPI_PAYER_NAME"
    "UPI_NOTE_PREFIX"
    "AUTO_VERIFY_CLAIMS"
    "JWT_SECRET"
    "ADMIN_API_KEY"
    "REDIS_URL"
    "CDN_PROVIDER"
    "CDN_DOMAIN"
    "CDN_PREFIX"
    "GEOCODE_SERVER_FALLBACK"
    "ALLOWED_ORIGINS"
)

echo "Checking all required secrets..."
MISSING_SECRETS=()

for secret in "${REQUIRED_SECRETS[@]}"; do
    if gcloud secrets describe "$secret" &>/dev/null; then
        echo "  ✓ $secret"
    else
        echo "  ✗ $secret (MISSING)"
        MISSING_SECRETS+=("$secret")
    fi
done

echo

if [ ${#MISSING_SECRETS[@]} -eq 0 ]; then
    success "All required secrets are present! ✅"
else
    warning "Missing secrets: ${MISSING_SECRETS[*]}"
    warning "Please create these secrets manually or add them to your .env file and run this script again."
fi

echo
echo "================================================"
echo "📋 SUMMARY"
echo "================================================"
echo
echo "Total secrets configured: ${#REQUIRED_SECRETS[@]}"
echo
info "Next steps:"
echo "  1. Verify secrets: gcloud secrets list"
echo "  2. View a secret: gcloud secrets versions access latest --secret=SECRET_NAME"
echo "  3. Run deployment: ./deploy.sh"
echo
warning "SECURITY NOTE:"
echo "  - Never commit .env file to git"
echo "  - Keep your secrets secure"
echo "  - Rotate secrets regularly"
echo
success "Setup complete! You're ready to deploy! 🚀"
