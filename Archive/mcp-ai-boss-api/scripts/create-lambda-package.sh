#!/bin/bash

# Script to create optimized Lambda deployment package

set -e

echo "📦 Creating optimized Lambda package..."

# Clean previous builds
rm -f lambda-package.zip
rm -rf dist
rm -rf node_modules

# Install only production dependencies
echo "📥 Installing production dependencies..."
npm install --production

# Build TypeScript
echo "🔨 Building TypeScript..."
npm run build

# Copy OpenAPI spec
echo "📋 Copying OpenAPI spec..."
npm run copy-openapi

# Create package with only necessary files
echo "📦 Creating zip package..."

# Create a temp directory for packaging
TEMP_DIR=$(mktemp -d)
cp -r dist/* "$TEMP_DIR/"
cp openapi.json "$TEMP_DIR/"
cp package.json "$TEMP_DIR/"
cp package-lock.json "$TEMP_DIR/"

# Copy only production node_modules (exclude dev dependencies)
mkdir -p "$TEMP_DIR/node_modules"
npm install --production --prefix "$TEMP_DIR" --no-save

# Create zip (exclude unnecessary files)
cd "$TEMP_DIR"
zip -r ../../lambda-package.zip . \
  -x "*.md" \
  -x "*.test.*" \
  -x "*.spec.*" \
  -x ".git/*" \
  -x ".DS_Store" \
  -x "*.log"

cd - > /dev/null

# Cleanup
rm -rf "$TEMP_DIR"

# Get file size
SIZE=$(du -h lambda-package.zip | cut -f1)
echo ""
echo "✅ Package created: lambda-package.zip ($SIZE)"
echo ""

# Check if still too large
SIZE_BYTES=$(stat -f%z lambda-package.zip 2>/dev/null || stat -c%s lambda-package.zip 2>/dev/null)
SIZE_MB=$((SIZE_BYTES / 1024 / 1024))

if [ $SIZE_MB -gt 50 ]; then
  echo "⚠️  Package is still large ($SIZE_MB MB). Consider using S3 upload method."
  echo "   See: MANUAL_DEPLOYMENT_AWS_CONSOLE.md (S3 Upload section)"
fi


