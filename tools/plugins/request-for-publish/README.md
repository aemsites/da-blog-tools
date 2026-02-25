# Request for Plugin

A DA (Document Authoring) plugin that enables content authors to submit publish requests for approval. This plugin is the **author-facing** side of the publish workflow, appearing as a dialog within the DA editing environment.

## How It Works

### Overview

When an author finishes editing content and wants to publish it, they open this plugin from the DA interface. The plugin automatically detects the current content path, identifies the appropriate approvers and CC recipients from the workflow configuration (including resolving distribution list groups), and lets the author submit a publish request with an optional note. The designated approvers then receive a notification (email) with CC recipients copied, along with a link to the [Publish Requests App](../../apps/publish-requests-inbox/) where they can review and approve or reject the request.

### Architecture

- **Web Component**: Built as a LitElement custom element (`<request-for-publish>`)
- **DA SDK**: Integrates with the DA.live SDK for authentication, context (org, site, path), and dialog rendering
- **DA Config API**: Reads the workflow configuration (approver rules and group-to-email mappings) via `GET https://admin.da.live/config/{org}/{site}/` with automatic fallback to `GET https://admin.da.live/config/{org}/` if not found at site level. See [DA Config API docs](https://docs.da.live/developers/api/config#get-config)
- **DA Admin API**: Reads/writes the pending requests sheet at `/.da/publish-workflow-requests.json`
- **Cloudflare Worker**: Submits publish requests to a worker (`/api/request-publish`) which sends email notifications to approvers with CC recipients copied
- **Adobe IMS**: Fetches the current user's email from the Adobe IMS profile endpoint
- **Dual Mode**: Can run as a fullsize-dialog (HTML entry point) or as a DA panel plugin (exported `init` function)

### Initialization Flow

1. The plugin loads and fetches the current user's email from Adobe IMS
2. The content path is derived from the DA SDK context (`/{org}/{site}{path}` → strips org/site prefix)
3. It reads the workflow config via the DA Config API (`/config/{org}/{site}/`, falling back to `/config/{org}/`) — if the `publish-workflow-config` tab is not found at either level, an error message is displayed and the form is not shown
4. Distribution list (DL) groups in the Approvers and CC fields are resolved to individual emails using the `groups-to-email` tab
5. It checks the requests sheet (`/.da/publish-workflow-requests.json`) for any existing pending request by this user for this path
6. If a pending request exists, it shows a "Request Pending" state instead of the form
7. Otherwise, the submission form is rendered with pre-filled details

### Approver Detection & Group Resolution

Approvers are detected by matching the content path against rules defined in the DA config sheet:

```
DA Config API → /config/{org}/{site}/ → publish-workflow-config tab
```

Each rule has a **Pattern** (e.g., `/drafts/*`, `/*`), **Approvers** (comma-separated emails or DL names), and an optional **CC** column (comma-separated emails or DL names). If no rule matches the path, an error is shown.

When an approver or CC entry matches a group in the `groups-to-email` tab, it is expanded to individual email addresses. CC recipients that overlap with approvers are automatically deduplicated by the worker to avoid sending duplicate emails.

#### Pattern Matching (Specificity-Based)

When multiple rules could match a given content path, the plugin selects the **most specific** (closest) match rather than the first match. Rules are scored by how closely their prefix matches the content path:

1. **Exact match** (e.g., `/drafts/user1/sample-page`) — highest priority
2. **Closest wildcard** (e.g., `/drafts/user1/*`) — most path segments matched
3. **Parent wildcard** (e.g., `/drafts/*`) — fewer segments matched
4. **Root wildcard** (`/*`) — lowest priority, catches everything

**Example:**
| Pattern | Approvers | CC |
|---------|-----------|-----|
| `/drafts/user1/*` | `user1@example.com` | `manager@example.com` |
| `/drafts/*` | `user2@example.com` | `dl-leads@example.com` |
| `/*` | `dl-reviewers@example.com` | `ops-team@example.com` |

**groups-to-email tab:**
| group | email |
|-------|-------|
| `dl-reviewers@example.com` | `reviewer1@example.com` |
| `dl-leads@example.com` | `lead1@example.com, lead2@example.com` |

For content at `/drafts/user1/my-page`, the rule `/drafts/user1/*` is selected (specificity 2) over `/drafts/*` (specificity 1) and `/*` (specificity 0). So `user1@example.com` is the approver and `manager@example.com` is CC'd.

For content at `/about`, only `/*` matches, so `dl-reviewers@example.com` is resolved to `reviewer1@example.com` as the approver, and `ops-team@example.com` is included as CC.

If no matching rule is found, an error message is shown prompting the user to add a matching pattern to the config.

### Submission Flow

1. Author opens the plugin and sees the pre-filled form (content path, preview link, detected approvers, and CC recipients)
2. Author optionally reviews the content diff via the AEM Page Status diff tool link
3. Author optionally adds a note for the reviewers
4. Author clicks **"Request Publish"**
5. The plugin sends the request to the Cloudflare Worker (`/api/request-publish`), which triggers email notifications to all resolved approvers with CC recipients copied
6. On success, it writes a new entry to `/.da/publish-workflow-requests.json` with status `pending`
7. A success confirmation is shown listing the notified approvers and CC'd recipients

## Use Cases Handled

### 1. Submit a New Publish Request

The primary use case. The author sees the content path, preview URL, resolved approvers and CC recipients (with DLs expanded), and a content diff link. They can add an optional note and submit. This:
- Sends the request via the Cloudflare Worker which emails the approvers (with CC recipients copied) with a review link
- Records the pending request in the DA requests sheet (requester, approver, path, status)
- Shows a success confirmation with the list of notified approvers and CC'd recipients

### 2. Existing Pending Request Detection

If the author already has a pending request for the same content path, the plugin shows a "Request Pending" state instead of the form. This prevents duplicate submissions and displays:
- The content path
- The assigned approver
- The current status (`pending`)
- A note asking the author to wait for the existing request to be reviewed

### 3. Review Content Diff Before Submitting

Before submitting, the author can click the diff link to open the AEM Page Status diff tool (`https://tools.aem.live/tools/page-status/diff.html`). This shows a comparison of the preview (draft) content versus the currently live/published version, helping the author verify their changes are correct before requesting approval.

### 4. View Preview

The plugin generates and displays a preview URL (`https://main--{site}--{org}.aem.page/{path}`) that the author can click to see how the content will look when published.

### 5. Approver Transparency

The plugin clearly shows which approvers and CC recipients will receive the request (with DLs fully resolved to individual names), along with the source of the detection:
- **Config-based**: "Approvers and CC determined by content path rules" — matched from the workflow config
- **Error**: If no matching rule is found or the config is missing, an error message is shown instead of the form

### 6. Missing Configuration

If the `publish-workflow-config` tab is not found in the DA config at either the site level (`/config/{org}/{site}/`) or the org level (`/config/{org}/`), the plugin displays an error:

> *"Publish workflow configuration not found. Please ensure the "publish-workflow-config" tab exists in the DA config for site "{org}/{site}" or org "{org}"."*

Similarly, if the config exists but no rule matches the current content path, an error is shown:

> *"No approver rule found matching path "{path}". Please add a matching pattern to the "publish-workflow-config" tab."*

In both cases, the submission form is not rendered and the author cannot submit a request.

### 7. Session/Auth Issues

If the user's email cannot be determined from the Adobe IMS token (e.g., expired session), the submit is blocked with an error message: "Could not determine your email. Please try again."

### 8. Submission Failure Handling

If the request fails to submit (network error, worker error, etc.), an error message is displayed and the form remains active so the author can retry.

## File Structure

| File | Description |
|------|-------------|
| `request-for-publish.html` | Entry HTML for fullsize-dialog mode; loads DA SDK and the plugin module |
| `request-for-publish.js` | Main LitElement component with form, states, and event handlers; includes both dialog and panel mode initialization |
| `request-for-publish.css` | Styles for all component states (form, pending, success, loading) |
| `utils.js` | Utility layer — approver and CC detection with group resolution via DA Config API (with org fallback), publish request submission, DA sheet read/write, IMS profile fetch |

## Configuration

### DA Config API (approver rules + groups)

The workflow configuration is read from the **DA Config API** as tabs within the root config:

- **Site-level** (primary): `GET https://admin.da.live/config/{org}/{site}/`
- **Org-level** (fallback): `GET https://admin.da.live/config/{org}/`

The config is a multi-sheet JSON. The plugin uses these two tabs:

- **`publish-workflow-config`** tab: Path-based rules with `Pattern`, `Approvers`, `CC`, and `NotifyOnReject` columns. Patterns support wildcards (e.g., `/drafts/*`, `/*`)
- **`groups-to-email`** tab: Maps distribution list group names (e.g., `dl-reviewers@example.com`) to comma-separated individual email addresses

If the `publish-workflow-config` tab is not found at either level, the plugin shows an error message and disables submission.

### `/.da/publish-workflow-requests.json` (DA Source API)

Tracks pending publish requests with columns: `requester`, `approver`, `path`, `status`

## Plugin Modes

### Fullsize Dialog Mode (Primary)

The plugin runs as a standalone page loaded in a DA dialog. The HTML file bootstraps the DA SDK, and the component self-initializes by reading context from the SDK.

### Panel / Sidekick Mode (Available)

The plugin exports a default `init` function compatible with the DA plugin panel API. This allows it to be rendered in a sidebar panel, though the dialog mode is the primary usage pattern.

```javascript
export default async function init({ context, token }) {
  return {
    title: 'Request Publish',
    panel: {
      render: (container) => { /* mounts the component */ },
    },
  };
}
```

## States

The plugin renders one of these states at any time:

| State | Trigger |
|-------|---------|
| Loading | Initial load, fetching user profile and approver config |
| Form | No existing pending request; ready for submission |
| Pending | An existing pending request for this path/user already exists |
| Submitted | Request was successfully submitted |
