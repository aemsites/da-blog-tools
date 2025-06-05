# Publish to Date Structure Workflow

This GitHub Actions workflow automatically publishes pages from drafts to a date-based directory structure and manages their publication lifecycle in Helix.

## Functionality

The `publish-to-date.yaml` workflow performs the following steps:

1. **Unpublishes** the page from Helix live environment
2. **Unpublishes** the page from Helix preview environment  
3. **Moves** the page from `/drafts/` to a date-based structure (`/blog/YYYY/MM/DD/`)
4. **Converts** `.md` files to `.html` during the move
5. **Publishes** the page to Helix preview environment
6. **Publishes** the page to Helix live environment

## Installation

### 1. Required Secrets

Add these secrets to your repository settings (`Settings > Secrets and variables > Actions`):

- `DA_TOKEN` - Document Authoring API token
- `HELIX_TOKEN` - Helix API token

### 2. Required Variables

Add these variables to your repository settings (`Settings > Secrets and variables > Actions > Variables`):

- `ORG_ID` - Your organization ID
- `REPO` - Your repository name

### 3. Dependencies

The workflow automatically installs Node.js dependencies in `.github/actions/`:

```bash
cd .github/actions
npm install
```

Required packages:
- `node-fetch` - For HTTP requests
- `date-fns` - For date formatting
- `formdata-node` - For multipart form data

## Usage

### Automatic Trigger (Repository Dispatch)

The workflow is triggered automatically when a `resource-published` event is dispatched with the following payload:

```json
{
  "path": "/drafts/example-post.md",
  "org": "your-org",
  "site": "your-site"
}
```

### Manual Trigger (Workflow Dispatch)

You can manually trigger the workflow from the GitHub Actions UI:

1. Go to `Actions` tab in your repository
2. Select "publish page to date structure"
3. Click "Run workflow"
4. Enter the AEM page path (e.g., `/drafts/example-post.md`)

## Environment Variables

The workflow uses these environment variables:

| Variable | Source | Description |
|----------|--------|-------------|
| `DA_TOKEN` | Secret | Document Authoring API token |
| `HELIX_TOKEN` | Secret | Helix API token |
| `AEM_PAGE_PATH` | Event payload | Path of the page to publish |
| `ORG_ID` | Variable | Organization ID |
| `REPO` | Variable | Repository name |
| `HLX_ORG` | Event payload | Helix organization |
| `HLX_SITE` | Event payload | Helix site |
| `DEBUG_EVENT_PAYLOAD` | Event payload | Full event data (for debugging) |

## File Structure

```
.github/
├── workflows/
│   ├── publish-to-date.yaml    # Main workflow file
│   └── README.md               # This documentation
└── actions/
    ├── publisher.js            # Main logic script
    └── package.json            # Node.js dependencies
```

## Path Processing

The workflow processes paths as follows:

**Input:** `/drafts/my-article.md`
**Output:** `/blog/2024/01/15/my-article.html`

- Removes `/drafts/` prefix
- Adds date-based directory structure (`YYYY/MM/DD`)
- Converts `.md` extension to `.html`
- Adds blog root path

## Error Handling

- **Invalid path pattern**: Workflow completes successfully but logs info message and stops processing
- **API errors**: Workflow fails with detailed error messages
- **Missing environment variables**: Workflow fails at startup with clear error message

## Troubleshooting

### Enable Debug Logging

Uncomment the debug line in `publisher.js` to see the full event payload:

```js
log('info', `DEBUG_EVENT_PAYLOAD: ${process.env.DEBUG_EVENT_PAYLOAD}`);
```

### Common Issues

1. **Missing environment variables**: Ensure all required secrets and variables are set
2. **Invalid path format**: Path must start with `/drafts/` and end with `.md`
3. **API authentication**: Verify tokens have correct permissions
4. **Network issues**: Check if DA and Helix APIs are accessible

## API Endpoints

The workflow interacts with these APIs:

- **Document Authoring**: `https://admin.da.live`
- **Helix**: `https://admin.hlx.page`

## Contributing

When modifying the workflow:

1. Test changes in a development environment
2. Validate all environment variables are properly set
3. Ensure error handling covers new failure modes
4. Update this documentation for any new features 