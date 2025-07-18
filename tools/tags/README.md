# Tags Plugin

A multi-select, searchable tag picker for Adobe Document Authoring (DA) Edge Delivery Services and Universal Editor (UE) environments.

## Features

- **Fetches tags** from a JSON file (`/docs/library/tagging.json`) in your DA repo.
- **Searchable**: Quickly filter tags by value, key, or comments.
- **Multi-select**: Select multiple tags using checkboxes.
- **Bulk actions**: Select all, deselect all, and send all selected tags at once.
- **Accessible UI**: Keyboard and screen-reader friendly.
- **Modern, responsive design**: Clean, sticky action bar and mobile-friendly layout.

## Usage

1. **Add the plugin to your DA tools directory** (already present as `tools/tags/`).
2. **Ensure your DA repo contains a `docs/library/tagging.json` file** with the following structure:

   ```json
   {
     "data": [
       {
         "key": "tag-key-1",
         "value": "Tag Value 1",
         "comments": "Optional description / unsed in UI"
       },
       {
         "key": "tag-key-2",
         "value": "Tag Value 2"
       }
     ],
     "limit": 100
   }
   ```

   - `key`: The value sent to the document when selected.
   - `value`: The label shown in the UI.
   - `comments`: (Optional) Additional info shown in the UI.

3. **Open `tools/tags/tags.html` in the DA/UE environment**.
   - The plugin will automatically fetch and display tags from your repo.
   - Use the search box to filter tags.
   - Select tags using checkboxes.
   - Use the action bar at the bottom to select all, deselect all, or send selected tags.
   - Click "Send Selected" to insert the selected tag keys (comma-separated) into your document.

## File Overview

- `tags.html` – Minimal HTML shell, loads the plugin and styles.
- `tags.js` – Main plugin logic (fetch, render, search, select, send).
- `tags.css` – All UI styles (customizable).

## Integration

- **DA SDK**: Uses the DA App SDK (`https://da.live/nx/utils/sdk.js`) for context, fetch, and document actions.
- **No build step required**: All files are plain JS/CSS/HTML.
- **No external dependencies**: Only the DA SDK is required.

### Configuration

> Site _CONFIG_ > _library_

| title | path | icon | ref | format | experience |
| ------- | ----------------------- | -------------------------------------------------------------------- | --- | --- | -------- |
| `Tags`  | `/tools/tags/tags.html` | `https://main--{site}--{org}.aem.page/tools/tags/classification.svg` |     |     | `dialog` |

## Customization

- **Styling**: Edit `tags.css` to change the look and feel.
- **Data source**: Change the fetch URL in `tags.js` if your tagging data is elsewhere.
- **Button text/labels**: Edit in `tags.js` for localization or branding.

## Development

- Lint with `npm run lint`.
- All code is ES6+ and uses modern best practices.
- No console logging except for errors.

## License

[MIT](../../LICENSE) (or your project’s license) 
