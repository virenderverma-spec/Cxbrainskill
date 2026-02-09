#!/bin/bash

# Script to upload Lambda package to S3 and create deployment

set -e

BUCKET_NAME="${1:-mcp-lambda-deployments}"
REGION="${2:-us-east-1}"
FUNCTION_NAME="${3:-mcp-ai-boss-api}"

echo "📦 Creating Lambda package for S3 upload..."

# Clean and build
rm -f lambda-package.zip
rm -rf dist
npm install --production
npm run build
npm run copy-openapi

# Create package
cd dist
zip -r ../lambda-package.zip .
cd ..
zip -r lambda-package.zip openapi.json package.json package-lock.json
zip -r lambda-package.zip node_modules/

SIZE=$(du -h lambda-package.zip | cut -f1)
echo "✅ Package created: lambda-package.zip ($SIZE)"
echo ""

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
  echo "❌ AWS CLI not found. Please install it first."
  echo "   https://aws.amazon.com/cli/"
  exit 1
fi

# Create S3 bucket if it doesn't exist
echo "📤 Uploading to S3..."
if ! aws s3 ls "s3://$BUCKET_NAME" 2>&1 | grep -q 'NoSuchBucket'; then
  echo "   Bucket exists: $BUCKET_NAME"
else
  echo "   Creating bucket: $BUCKET_NAME"
  aws s3 mb "s3://$BUCKET_NAME" --region "$REGION"
fi

# Upload to S3
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
S3_KEY="lambda-packages/${FUNCTION_NAME}-${TIMESTAMP}.zip"
aws s3 cp lambda-package.zip "s3://$BUCKET_NAME/$S3_KEY"

echo ""
echo "✅ Uploaded to S3: s3://$BUCKET_NAME/$S3_KEY"
echo ""
echo "📋 Next steps in AWS Console:"
echo "   1. Go to Lambda function: $FUNCTION_NAME"
echo "   2. Code tab → Upload from → Amazon S3"
echo "   3. S3 link URL: s3://$BUCKET_NAME/$S3_KEY"
echo "   4. Click Save"
echo ""


