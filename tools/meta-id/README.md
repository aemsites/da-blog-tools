# Meta-ID Tool

A powerful tool for managing Post_ID metadata in AEM Document Authoring (DA) Edge Delivery Services pages. This tool automatically detects, generates, and manages unique Post_ID values within page metadata structures.

## Overview

The Meta-ID Tool is designed to help content authors and developers manage Post_ID metadata entries in DA pages. It provides an intuitive interface for:

- **Detecting** existing Post_ID values in page metadata
- **Generating** new unique UUID v4 Post_IDs when missing
- **Updating** existing Post_ID values
- **Cleaning up** duplicate Post_ID entries
- **Creating** metadata structures when they don't exist

## Features

### 🔍 **Automatic Detection**
- Scans page source for metadata tables or div structures
- Case-insensitive matching for "Post_ID" keys
- Supports both table-based and div-based metadata formats
- Real-time status updates

### 🆔 **Smart ID Generation**
- Generates unique UUID v4 identifiers
- Ensures no conflicts with existing IDs
- Follows standard UUID format: `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`

### 🧹 **Duplicate Management**
- Detects multiple Post_ID entries
- Provides cleanup functionality to remove duplicates
- Keeps the first occurrence and removes others
- Prevents metadata corruption

### 🏗️ **Metadata Structure Creation**
- Automatically creates metadata div structures when missing
- Inserts metadata in the correct position within the page structure
- Maintains proper HTML formatting

### 🔄 **Real-time Updates**
- Posts changes directly to the DA source API
- Updates are immediately reflected in the page source
- Clean HTML output (removes comments)

## Usage

### Basic Workflow

1. **Open the Tool**: Navigate to the meta-id tool in your DA environment
2. **Automatic Scan**: The tool automatically scans the current page for Post_ID metadata
3. **Review Status**: View the current Post_ID status:
   - ✅ **Found**: Shows existing Post_ID value with option to generate new one
   - ❌ **Missing**: Shows option to generate new Post_ID
   - ⚠️ **Duplicates**: Shows warning with cleanup option

### Actions Available

#### Generate Post_ID
- **When**: Post_ID is missing or you want to replace existing one
- **Action**: Click "Generate Post_ID" or "Generate New Post_ID"
- **Result**: Creates/updates Post_ID with new UUID v4

#### Clean Up Duplicates
- **When**: Multiple Post_ID entries are detected
- **Action**: Click "Clean Up Duplicates"
- **Result**: Removes all but the first Post_ID entry

## Technical Details

### Metadata Structure Support

The tool supports metadata formats:

#### Div-based Structure (Preferred)
```html
<div class="metadata">
  <div>
    <div><p>Post_ID</p></div>
    <div><p>xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx</p></div>
  </div>
  <div>
    <div><p>Other_Key</p></div>
    <div><p>Other_Value</p></div>
  </div>
</div>
```

### API Integration

- **Source Fetching**: Uses DA source API to retrieve page content
- **Content Updates**: Posts modified HTML back to source API
- **Authentication**: Leverages DA SDK for secure API access
- **Error Handling**: Comprehensive error reporting and user feedback

### Page Structure Integration

When creating new metadata structures, the tool follows this insertion logic:

1. **Primary**: Insert into first `<div>` within `<main>` element
2. **Fallback 1**: Insert directly into `<main>` element
3. **Fallback 2**: Insert into `<body>` element

This ensures metadata is placed in the most appropriate location for your page structure.

## Installation

1. Ensure the `meta-id.js, meta-id.html, meta-id.css` files are placed in your `tools/meta-id/` directory
2. The tool is self-contained and requires no additional dependencies
3. Install in the site _CONFIG_ > _library_ sheet
    - **title**: Page ID
    - **path**: `/tools/meta-id/meta-id.html`
    - click _save_ on the sheet
3. Access through your DA library interface


## Dependencies

- **DA SDK**: For API access and authentication
- **DA Constants**: For origin URL configuration
- **Modern Browser**: Requires DOMParser and FormData support

## Error Handling

The tool provides comprehensive error handling for:

- **Network Issues**: Failed API requests
- **Parsing Errors**: Invalid HTML content
- **Structure Issues**: Missing page elements
- **Duplicate Conflicts**: Multiple Post_ID entries

All errors are displayed to the user with clear, actionable messages.

## Browser Compatibility

- **Modern Browsers**: Chrome, Firefox, Safari, Edge (latest versions)
- **Required Features**: ES6 modules, DOMParser, FormData, fetch API
- **No Polyfills**: Uses native browser APIs

## Security

- **Authentication**: Uses DA SDK authentication tokens
- **Content Validation**: Validates HTML structure before updates
- **Safe Updates**: Only modifies metadata content, preserves page structure
- **Error Logging**: Console errors for debugging (no sensitive data)

## Contributing

When contributing to this tool:

1. **Code Style**: Follow existing JSDoc comment patterns
2. **Error Handling**: Always provide user-friendly error messages
3. **Testing**: Test with various metadata structures and edge cases
4. **Documentation**: Update this README for any new features

## Troubleshooting

### Common Issues

**"Failed to fetch page source"**
- Check network connectivity
- Verify DA authentication
- Ensure page path is correct

**"No metadata element found"**
- Tool will create metadata structure automatically
- Check if page has proper HTML structure

**"Multiple Post_IDs detected"**
- Use cleanup function to remove duplicates
- Review page source for manual fixes

### Debug Information

The tool provides detailed status messages and error reporting. For technical debugging, check the browser console for additional error details.

## License

This tool is part of the DA Blog Tools project. See the main project LICENSE file for details. 