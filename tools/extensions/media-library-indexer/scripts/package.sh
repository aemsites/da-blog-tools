#!/bin/bash
set -e

# Check if manifest exists
if [ ! -f "src/manifest.json" ]; then
  echo "Error: src/manifest.json not found. Create manifest first."
  exit 1
fi

# Get version from manifest
VERSION=$(grep -o '"version": "[^"]*"' src/manifest.json | cut -d'"' -f4)

echo "Packaging Media Library Indexer v${VERSION}..."

# Build first
./scripts/build.sh

# Create zip
cd dist
zip -r "../media-library-indexer-v${VERSION}.zip" .
cd ..

echo "Package created: media-library-indexer-v${VERSION}.zip"
