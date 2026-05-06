# Media Library Indexer Chrome Extension

Automatically builds and maintains media library indexes for AEM Edge Delivery Services sites.

## What It Does

- Monitors tracked sites for media changes when da.live tab is open
- Builds full index for new sites or when index is missing
- Runs incremental builds when content changes detected
- Only processes sites when you have da.live open (requires auth tokens)

## Installation

### Development

1. Build the extension:
```bash
cd tools/extensions/media-library-indexer
./scripts/build.sh
```

2. Load in Chrome:
   - Open `chrome://extensions`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select `dist/` folder

### Production

Chrome Web Store: *Coming soon*

## Usage

### Add a Site

1. Open `https://da.live/#/{org}/{repo}` in Chrome
2. Right-click → "Add this site for indexing"
3. Index builds automatically in background

### Remove a Site

Right-click on da.live page → "Remove this site from indexing"

### Check Status

Click the extension icon to see:
- Indexing status
- Last indexed time
- Total media count

## Viewing Debug Logs

1. Go to `chrome://extensions`
2. Find "Media Library Indexer"
3. Click "Inspect service worker"
4. View console logs

**Enable detailed token logging:**
```javascript
chrome.storage.local.set({ debugPerf: true });
```

## Troubleshooting

**"AUTH NEEDED" status**: Open da.live in a browser tab

**Extension not processing**: Keep a da.live tab open while working

**View tracked sites:**
```javascript
chrome.storage.local.get('sites', (result) => {
  console.table(result.sites);
});
```
