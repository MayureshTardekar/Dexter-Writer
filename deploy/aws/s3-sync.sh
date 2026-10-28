#!/usr/bin/env bash
# ==============================================================================
# Dexter Write — S3 Frontend & Export Storage Sync
# Uses AWS IAM Role attached to the EC2 instance or AWS CLI profile
# ==============================================================================
set -euo pipefail

BUCKET_NAME="${1:-dexter-write-storage}"
REGION="${AWS_REGION:-ap-south-1}"

echo "=========================================================="
echo " Syncing Dexter Write to S3: s3://${BUCKET_NAME} (${REGION})"
echo "=========================================================="

echo "[1/3] Building production bundle..."
npm run build

echo "[2/3] Uploading static assets with long-term cache headers..."
aws s3 sync dist/assets "s3://${BUCKET_NAME}/assets" \
  --region "${REGION}" \
  --cache-control "public, max-age=31536000, immutable"

echo "[3/3] Uploading remaining files (HTML, Manifest) with no-cache..."
aws s3 sync dist "s3://${BUCKET_NAME}" \
  --region "${REGION}" \
  --exclude "assets/*" \
  --cache-control "public, max-age=0, must-revalidate"

echo "Sync completed successfully!"

