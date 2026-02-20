# Publish Requests App

A full-page DA (Document Authoring) application that allows designated approvers to review, approve, or reject content publish requests. This app is the **approver-facing** side of the publish workflow.

## How It Works

### Overview

When an author submits a publish request (via the [Request for Publish Plugin](../request-for-publish-plugin/)), an email notification is sent to the designated approver(s). The approver can either open the app directly (without a `path` parameter) to see **all** pending requests they can act on, or open a specific request link to review a single request.

### Architecture

- **Web Component**: Built as a LitElement custom element (`<publish-requests-inbox>`)
- **DA SDK**: Integrates with the DA.live SDK for authentication and context
- **Helix Admin API**: Publishes content via `POST https://admin.hlx.page/live/{org}/{repo}/main/{path}` (single) or the [bulk publish API](https://www.aem.live/docs/admin.html#tag/publish/operation/bulkPublish) `POST https://admin.hlx.page/live/{org}/{repo}/main/*` (Approve All)
- **DA Config API**: Reads the workflow configuration (approver rules and group-to-email mappings) via `GET https://admin.da.live/config/{org}/{repo}/` with automatic fallback to `GET https://admin.da.live/config/{org}/` if not found at repo level. See [DA Config API docs](https://docs.da.live/developers/api/config#get-config)
- **DA Admin API**: Reads/writes the pending requests sheet at `/publish-workflow-requests.json`
- **Cloudflare Worker**: Sends rejection notifications (`/api/notify-rejection`) and publish-success notifications to authors (`/api/notify-published`) via the `publish-requests` worker
- **Adobe IMS**: Fetches the current user's email from the Adobe IMS profile endpoint

### Two Operating Modes

#### Inbox Mode (no `path` parameter)

When the app is opened with just `org` and `repo` parameters, it enters **inbox mode**:

1. Fetches the user's email from Adobe IMS
2. Reads the workflow config via the DA Config API (`/config/{org}/{repo}/`, falling back to `/config/{org}/`) — if not found at either level, an error is displayed
3. Reads all pending requests from `publish-workflow-requests.json`
4. For each pending request, finds the best (most specific) matching rule for that path, resolves the approvers (including expanding DL groups via the `groups-to-email` tab), and checks if the current user is among them
5. Displays only the requests the user is authorized to approve
6. Provides individual approve, review, and diff links per request, plus an **Approve All** bulk action

#### Single-Review Mode (with `path` parameter)

When the app is opened with a `path` parameter (e.g., from an approval email link), it enters **single-review mode**:

1. Fetches the user's email from Adobe IMS
2. Validates that a pending request exists for the given path in the requests sheet
3. Reads the workflow config via the DA Config API (repo-level, then org-level fallback) — if not found, an error is displayed
4. Finds the best (most specific) matching rule for the path, resolves the approvers (expanding DL groups), and verifies the user is authorized
5. Renders the full review interface with content diff, approve, and reject options

### Group-to-Email Resolution

Approver entries in the config can be either direct email addresses or distribution list (DL) names. When a DL is encountered (e.g., `dl-reviewers@example.com`), it is resolved to individual email addresses using the `groups-to-email` tab in the DA config.

### Pattern Matching (Specificity-Based)

When multiple rules could match a given content path, the app selects the **most specific** (closest) match rather than the first match. Rules are scored by how closely their prefix matches the content path:

1. **Exact match** (e.g., `/drafts/user1/sample-page`) — highest priority
2. **Closest wildcard** (e.g., `/drafts/user1/*`) — most path segments matched
3. **Parent wildcard** (e.g., `/drafts/*`) — fewer segments matched
4. **Root wildcard** (`/*`) — lowest priority, catches everything

**Example config:**
| Pattern | Approvers |
|---------|-----------|
| `/drafts/user1/*` | `approver-a@example.com` |
| `/drafts/*` | `approver-b@example.com` |
| `/*` | `dl-reviewers@example.com` |

**groups-to-email tab:**
| group | email |
|-------|-------|
| `dl-reviewers@example.com` | `reviewer1@example.com` |

For path `/drafts/user1/sample-page`, the rule `/drafts/user1/*` is selected (specificity 2) over `/drafts/*` (specificity 1) and `/*` (specificity 0). So `approver-a@example.com` is the resolved approver.

For path `/about`, only `/*` matches, so `dl-reviewers@example.com` is resolved to `reviewer1@example.com`.

### URL Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `org`     | Yes      | The DA organization (e.g., `my-org`) |
| `repo`    | Yes      | The DA repository (e.g., `my-repo`) |
| `path`    | No       | The content path to review. If omitted → inbox mode |
| `author`  | No       | Email of the author who submitted the request |
| `preview` | No       | URL to the preview version of the content |
| `comment` | No       | Comment/note from the author |

**Inbox URL (all pending requests):**
```
/tools/publish-requests-inbox/publish-requests-inbox?org=my-org&repo=my-repo
```

**Single-review URL (specific request):**
```
/tools/publish-requests-inbox/publish-requests-inbox?org=my-org&repo=my-repo&path=/drafts/my-page&author=author@example.com
```

## Use Cases Handled

### 1. View All Pending Approvals (Inbox)

The landing page when no `path` is specified. Displays a list of all pending publish requests that the logged-in user is authorized to approve. Each item shows the content path, requester, and action buttons (Diff, Review, Approve).

### 2. Approve All Pending Requests (Bulk Publish)

From the inbox, the approver can click **"Approve All"** to bulk-publish all visible pending requests in a single operation using the [AEM Admin bulk publish API](https://www.aem.live/docs/admin.html#tag/publish/operation/bulkPublish).

**How it works:**
1. All pending paths are collected and sent in a single `POST` to `https://admin.hlx.page/live/{org}/{repo}/main/*` with a `{ "paths": [...] }` body
2. The API returns a job; the app polls `https://admin.hlx.page/job/{org}/{repo}/main/{jobName}/details` until the job completes (up to 60 seconds, polling every 2 seconds)
3. On completion, the app checks the job details for per-resource status codes
4. All successfully published requests are removed from the requests sheet in a single batch write (rather than N individual writes)
5. If some paths failed, only the succeeded ones are removed and a summary is shown

This approach is significantly faster than sequential per-path publishing and avoids race conditions on sheet writes.

### 3. Author Email Notification on Publish

Whenever content is successfully published — whether via single approve, inbox approve, or bulk "Approve All" — the app sends a **publish-success email** to the original author(s) via the worker's `/api/notify-published` endpoint.

**How it works:**
- After a successful publish, the app calls `notifyPublished()` with the published path(s) and each author's email
- The worker groups paths by author, so each author receives **one consolidated email** listing all their pages that were just published
- The email includes live links to the published pages
- The notification is fire-and-forget — it does not block the UI since the publish itself already succeeded
- On **bulk publish with partial failures**, only authors of successfully published pages are notified

### 4. Approve a Single Request from Inbox

Each inbox item has an individual **"Approve"** button that publishes just that one request. The item is removed from the list upon success, and a publish notification email is sent to the author.

### 5. Review & Approve a Single Request

The full review page for a specific request. The approver sees the content path, author, optional note, preview link, and a content diff link. They can click **"Approve & Publish"** to publish the content. A publish notification email is sent to the author upon success.

### 6. Reject a Publish Request

From the single-review page, the approver expands the reject section, provides a mandatory reason, and clicks **"Reject Request"**. This sends a rejection notification to the author and DigiOps team via the Cloudflare Worker.

### 7. Review Content Diff

Both the inbox (per-item) and the review page provide links to the AEM Page Status diff tool, allowing the approver to compare preview vs. live content before making a decision.

### 8. No Pending Request

If an approver opens a link for a request that has already been processed, the app shows a "No Pending Request" page with a link back to the inbox.

### 9. Unauthorized Access

If a user is not an authorized approver for the given content path (after group resolution), the app shows a "Not Authorized" page listing who is authorized.

### 10. Empty Inbox

If the user has no pending requests to act on, the inbox displays an empty state message.

### 11. Missing Configuration

If the `publish-workflow-config` tab is not found in the DA config at either the repo level (`/config/{org}/{repo}/`) or the org level (`/config/{org}/`), the app displays an error message:

> *"Publish workflow configuration not found. Please ensure the "publish-workflow-config" tab exists in the DA config for repo "{org}/{repo}" or org "{org}"."*

This prevents the app from operating without proper approver rules.

### 12. Session/Login Issues

If the user's email cannot be determined from the Adobe IMS token, a warning is shown and action buttons are disabled.

## File Structure

| File | Description |
|------|-------------|
| `publish-requests-inbox.html` | Entry HTML that loads DA SDK and the app module |
| `publish-requests-inbox.js` | Main LitElement component with inbox and review modes, all UI states and event handlers |
| `publish-requests-inbox.css` | Styles for all component states (inbox, review, approved, rejected, error, etc.) |
| `api.js` | API layer — single & bulk publish via Helix Admin, job polling, rejection & publish-success notifications, DA Config API fetch with org fallback, requests sheet read/write (including batch removal), group resolution, approver lookup, IMS profile fetch |

## Configuration

### DA Config API (approver rules + groups)

The workflow configuration is read from the **DA Config API** as tabs within the root config:

- **Repo-level** (primary): `GET https://admin.da.live/config/{org}/{repo}/`
- **Org-level** (fallback): `GET https://admin.da.live/config/{org}/`

The config is a multi-sheet JSON. The app uses these two tabs:

- **`publish-workflow-config`** tab: Path-based rules with `Pattern`, `Approvers`, `CC`, and `NotifyOnReject` columns
- **`groups-to-email`** tab: Maps distribution list names to comma-separated individual email addresses

If the `publish-workflow-config` tab is not found at either level, the app shows an error.

### `/publish-workflow-requests.json` (DA Source API)

Tracks pending publish requests with columns: `requester`, `approver`, `path`, `status`

## States

The app renders one of these states at any time:

| State | Trigger |
|-------|---------|
| `loading` | Initial load, fetching user profile and data |
| `inbox` | No `path` param — shows all pending requests for the user |
| `review` | Valid pending request found and user is authorized |
| `approved` | Content successfully published |
| `rejected` | Request successfully rejected and notifications sent |
| `no-request` | No pending request found for the given path |
| `unauthorized` | Current user is not an authorized approver (after group resolution) |
| `error` | Missing required URL parameters, auth failure, or missing workflow configuration |
