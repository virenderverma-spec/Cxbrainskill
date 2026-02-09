#!/bin/bash

# Script to create optimized Lambda package (under 50 MB)

set -e

echo "📦 Creating optimized Lambda package..."

cd "$(dirname "$0")/.."

# Clean previous builds
rm -f lambda-package.zip
rm -rf dist
rm -rf node_modules

# Install ONLY production dependencies (excludes devDependencies)
echo "📥 Installing production dependencies only..."
npm install --production --no-optional

# Build TypeScript
echo "🔨 Building TypeScript..."
npm run build

# Copy OpenAPI spec
echo "📋 Copying OpenAPI spec..."
npm run copy-openapi

# Create temp directory for packaging
TEMP_DIR=$(mktemp -d)
echo "📁 Using temp directory: $TEMP_DIR"

# Copy only necessary files
echo "📦 Packaging files..."
cp -r dist/* "$TEMP_DIR/"
cp openapi.json "$TEMP_DIR/" 2>/dev/null || echo "⚠️  openapi.json not found, continuing..."
cp package.json "$TEMP_DIR/"
cp package-lock.json "$TEMP_DIR/"

# Copy node_modules but exclude unnecessary files
echo "📦 Copying node_modules (excluding unnecessary files)..."
mkdir -p "$TEMP_DIR/node_modules"

# Copy node_modules (rsync is better but cp works too)
if command -v rsync &> /dev/null; then
  rsync -av \
    --exclude='*.md' \
    --exclude='*.test.*' \
    --exclude='*.spec.*' \
    --exclude='test/' \
    --exclude='tests/' \
    --exclude='__tests__/' \
    --exclude='.git/' \
    --exclude='.DS_Store' \
    --exclude='*.log' \
    --exclude='*.map' \
    --exclude='docs/' \
    --exclude='examples/' \
    --exclude='*.ts' \
    --exclude='*.tsx' \
    --exclude='tsconfig.json' \
    node_modules/ "$TEMP_DIR/node_modules/" 2>/dev/null
else
  # Fallback: copy all, will clean up in zip step
  cp -r node_modules "$TEMP_DIR/" 2>/dev/null || echo "⚠️  Could not copy node_modules"
fi

# Create zip with maximum compression
echo "🗜️  Creating zip with maximum compression..."
cd "$TEMP_DIR"
zip -r -9 ../../lambda-package.zip . \
  -x "*.md" \
  -x "*.test.*" \
  -x "*.spec.*" \
  -x ".git/*" \
  -x ".DS_Store" \
  -x "*.log" \
  -x "*.map" \
  -x "docs/*" \
  -x "examples/*" \
  -x "*.ts" \
  -x "*.tsx" \
  -x "tsconfig.json" \
  > /dev/null 2>&1

cd - > /dev/null

# Cleanup
rm -rf "$TEMP_DIR"

# Get file size
if [ -f lambda-package.zip ]; then
  SIZE=$(du -h lambda-package.zip | cut -f1)
  SIZE_BYTES=$(stat -f%z lambda-package.zip 2>/dev/null || stat -c%s lambda-package.zip 2>/dev/null)
  SIZE_MB=$((SIZE_BYTES / 1024 / 1024))
  
  echo ""
  echo "✅ Package created: lambda-package.zip"
  echo "   Size: $SIZE ($SIZE_MB MB)"
  echo ""
  
  if [ $SIZE_MB -lt 50 ]; then
    echo "✅ Package is under 50 MB - ready to upload directly to Lambda!"
  else
    echo "⚠️  Package is still $SIZE_MB MB (over 50 MB limit)"
    echo ""
    echo "💡 Additional optimization options:"
    echo "   1. Remove unused dependencies from package.json"
    echo "   2. Use Lambda Layers for node_modules (advanced)"
    echo "   3. Check for large files in node_modules"
    echo ""
    echo "   To check what's taking space:"
    echo "   unzip -l lambda-package.zip | sort -k1 -n | tail -20"
  fi
else
  echo "❌ Failed to create package"
  exit 1
fi

