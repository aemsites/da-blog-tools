#!/bin/bash
set -e

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
