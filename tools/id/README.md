# Ghost ID Generator

A Document Authoring (DA) app that generates and manages Ghost IDs for documents, with automatic clipboard integration and persistent storage.

## Overview

This tool is designed to work within Adobe's Document Authoring environment. It generates unique 6-digit numeric IDs for documents and maintains a persistent mapping between document paths and their Ghost IDs in a JSON sheet. The tool automatically copies the generated Ghost URL to the clipboard for easy sharing.

## Features

- **Smart ID Management**: Checks existing Ghost IDs before generating new ones
- **Persistent Storage**: Stores ID mappings in a JSON sheet for consistency
- **Automatic Clipboard**: Copies the Ghost URL to clipboard automatically
- **Manual Copy Button**: Additional copy button for re-copying the URL
- **Clean UI**: Simple interface with styled result display
- **DA Integration**: Uses the DA SDK for seamless integration

## Configuration

1. **Open the CONFIG for the site**
2. **Add/Edit the library sheet** with the following values:
   - title: Insert-Id
   - path: /tools/id/generate-id.html

3. **Update the Ghost Link Base** (in `generate-id.js`):
   ```javascript
   const GHOST_LINK_BASE = '/blogs/'; // Change to your site's base path
   ```

## Usage

1. **Launch the app** in Document Authoring
2. **Click "Get Ghost ID"** to retrieve or generate a Ghost ID for the current document
3. **The Ghost URL is automatically copied** to your clipboard
4. **Use the "Copy URL" button** to copy the URL again if needed
5. **The URL is displayed** in a styled container for reference

## Output Format

The tool generates a Ghost URL with the following structure:

```
https://main--{repo}--{org}.aem.page{GHOST_LINK_BASE}?p={ghostId}
```

Example:
```
https://main--msft-blogs-tools--aemsites.aem.page/blogs/?p=123456
```

## Data Storage

The tool maintains a JSON sheet at `.da/ghost-links.json` with the following structure:

```json
{
    "total": 1,
    "limit": 1,
    "offset": 0,
    "data": [
        {
            "source": "123456",
            "destination": "/drafts/test0"
        }
    ],
    ":colWidths": [50, 315],
    ":sheetname": "data",
    ":type": "sheet"
}
```

## Technical Details

### Dependencies
- **DA SDK**: `https://da.live/nx/utils/sdk.js`
- **DA Fetch**: `https://da.live/nx/utils/daFetch.js`
- **Constants**: `https://da.live/nx/public/utils/constants.js`
- **Spectrum Web Components**: For UI elements (`sl-button`)

### Key Functions

#### `generateGhostId()`
Generates a random 6-digit number between 100000 and 999999.

#### `updateSheet(path, token, org, repo, actions)`
- Fetches the current ghost-links sheet
- Checks if the document path already has a Ghost ID
- If found, returns the existing ID
- If not found, generates a new ID and adds it to the sheet
- Returns the Ghost ID (either existing or new)

#### `init()`
Initializes the app, sets up the UI, and handles user interactions.

### DA SDK Integration

The app uses the following DA SDK features:
- `actions.daFetch()`: Makes authenticated requests to DA API
- `actions.sendText()`: Sends text content back to DA
- `context`: Accesses current document context information

## File Structure

```
tools/id/
├── generate-id.js      # Main application logic
├── generate-id.html    # HTML wrapper for the app
├── generate-id.css     # Styling for the UI
└── README.md          # This documentation
```

## Development

### Local Development
1. Run the app locally using the DA development environment
2. The app will connect to `localhost:3000` in development mode
3. Use browser console to debug and monitor sheet operations

### Production
- Deployed as part of the DA app collection
- Automatically uses production DA API endpoints
- Includes proper authentication via DA tokens

## Customization

### Changing ID Format
Modify the `generateGhostId()` function to generate different ID formats:

```javascript
// For alphanumeric IDs
function generateGhostId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
```

### Changing the Sheet Path
Update the `GHOST_LINKS_SHEET` constant:

```javascript
const GHOST_LINKS_SHEET = '.da/your-custom-sheet.json';
```

### Modifying the URL Structure
Update the URL generation logic in the button click handler:

```javascript
const ghostUrl = `${ghostLink}?customParam=${ghostId}`;
```

## Troubleshooting

### Common Issues

1. **"Failed to fetch sheet"**
   - Check that the `.da/ghost-links.json` file exists
   - Verify the DA API permissions

2. **"Failed to update sheet"**
   - Check DA API write permissions
   - Verify the sheet format is correct

3. **Clipboard not working**
   - Ensure the app is running in HTTPS
   - Check browser clipboard permissions
   - Use the manual "Copy URL" button as fallback

4. **Wrong URL base**
   - Update the `GHOST_LINK_BASE` constant to match your site structure

### Debug Mode

Enable debug mode by uncommenting the context buttons:

```javascript
container.appendChild(contextButton);
container.appendChild(pathButton);
```

This will show additional information about the current document context.

## License

This tool is part of the Microsoft Blogs Tools project and follows the same licensing terms as the parent repository. 