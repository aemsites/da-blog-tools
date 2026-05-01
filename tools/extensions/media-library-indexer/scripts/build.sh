#!/bin/bash
set -e

echo "Building Media Library Indexer extension..."

# Clean dist
rm -rf dist
mkdir -p dist

# Copy source files to dist
cp -r src/* dist/

# Remove any .DS_Store files
find dist -name ".DS_Store" -delete

echo "Build complete: dist/"
echo "To install: chrome://extensions → Load unpacked → select dist/ folder"
