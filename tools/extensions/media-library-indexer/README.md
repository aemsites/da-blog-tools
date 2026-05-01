# Media Library Indexer Chrome Extension

Background indexer for DA Media Library.

## Development

### Build

From repo root:
```bash
npm run build:extension
```

Or from extension directory:
```bash
cd tools/extensions/media-library-indexer
./scripts/build.sh
```

### Install

1. Build the extension (see above)
2. Open Chrome: `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select `tools/extensions/media-library-indexer/dist/` directory

### Package for Distribution

From repo root:
```bash
npm run package:extension
```

Creates: `media-library-indexer-v{version}.zip`

## Testing

1. Navigate to `https://da.live/#/{org}/{site}`
2. Icon should turn green
3. Right-click → "Add this site for indexing"
4. Open service worker console: Extensions → Media Library Indexer → "Inspect service worker"
5. Watch indexing logs

## Storage Inspection

Service worker console:
```javascript
chrome.storage.local.get('sites', console.log)
```

## References

- Design doc: `/Users/kiranm/Downloads/medialib-ext/2026-05-01-media-library-chrome-extension-design.md`
- Manifest V3: https://developer.chrome.com/docs/extensions/mv3/
