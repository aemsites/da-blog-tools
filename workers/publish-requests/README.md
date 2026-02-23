# Publish Requests Worker

A Cloudflare Worker that handles email notifications for the content publish request workflow. This is the **backend orchestration layer** — it sends emails on behalf of the [DA Plugin](../../tools/plugins/request-for-publish/) (publish requests) and the [DA App](../../tools/apps/publish-requests-inbox/) (rejections, publish confirmations).

## How It Works

### Overview

The worker is a stateless email relay. It receives authenticated requests from the DA Plugin and DA App, constructs HTML emails, and sends them via the Gmail API using OAuth. There is no database — all workflow state lives in DA Sheets.

### Architecture

- **Cloudflare Worker**: Vanilla JS, no frameworks or SDKs
- **Gmail API**: Sends emails via `https://gmail.googleapis.com/gmail/v1/users/me/messages/send` using OAuth 2.0 refresh token flow
- **DA Token Validation**: All endpoints (except `/health`) require a valid DA JWT bearer token
- **Stateless**: No D1 database, no n8n — the worker only sends emails

### Email Flow

1. **Publish Request** (`/api/request-publish`): DA Plugin submits a request → worker emails the approver(s) with a deep-link to the DA App review page. CC recipients are supported.
2. **Rejection** (`/api/notify-rejection`): DA App submits a rejection → worker emails the original author (and DigiOps if provided) with the rejection reason.
3. **Publish Success** (`/api/notify-published`): DA App publishes content → worker emails author(s) confirming their content is live. Groups paths by author so each author gets one consolidated email.

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | No | Health check — returns status, service name, timestamp, environment |
| `POST` | `/api/request-publish` | DA JWT | Send publish request email to approvers |
| `POST` | `/api/notify-rejection` | DA JWT | Send rejection notification to author and DigiOps |
| `POST` | `/api/notify-published` | DA JWT | Send publish-success notification to author(s) |

### `POST /api/request-publish`

**Body:**
```json
{
  "path": "/drafts/my-page",
  "previewUrl": "https://main--repo--org.aem.page/drafts/my-page",
  "authorEmail": "author@example.com",
  "authorName": "Author Name",
  "comment": "Optional note for reviewers",
  "approvers": ["approver1@example.com", "approver2@example.com"],
  "cc": ["cc-recipient@example.com"],
  "org": "my-org",
  "repo": "my-repo"
}
```

`org` and `repo` are optional — defaults to `DA_ORG` and `DA_REPO` from `wrangler.toml` vars.

### `POST /api/notify-rejection`

**Body:**
```json
{
  "path": "/drafts/my-page",
  "authorEmail": "author@example.com",
  "authorName": "Author Name",
  "rejecterEmail": "approver@example.com",
  "rejecterName": "Approver Name",
  "reason": "Needs revisions to the intro section",
  "digiops": "digiops@wsu.edu",
  "org": "my-org",
  "repo": "my-repo"
}
```

### `POST /api/notify-published`

**Body:**
```json
{
  "paths": [
    { "path": "/drafts/page-1", "authorEmail": "author1@example.com" },
    { "path": "/drafts/page-2", "authorEmail": "author2@example.com" }
  ],
  "approverEmail": "approver@example.com",
  "approverName": "Approver Name",
  "org": "my-org",
  "repo": "my-repo"
}
```

Paths are grouped by author — each author receives one consolidated email listing all their published pages.

## Authentication

All API endpoints (except `/health`) require a DA JWT bearer token in the `Authorization` header:

```
Authorization: Bearer <da-jwt-token>
```

The worker validates:
- `client_id` is `darkalley`
- Token is not expired (`created_at + expires_in > now`)
- Token contains a user identity (`aa_id` or `user_id`)

Note: signature verification is not performed — the worker validates claims only.

## Email Provider

### Gmail API (current)

Emails are sent via the Gmail API using OAuth 2.0. The worker exchanges a long-lived refresh token for a short-lived access token on each request, then sends the email as a Base64URL-encoded RFC 2822 message.

**Required secrets** (set via `wrangler secret put`):

| Secret | Description |
|--------|-------------|
| `PUBLISH_REQUESTS_GMAIL_CLIENT_ID` | Google OAuth client ID |
| `PUBLISH_REQUESTS_GMAIL_CLIENT_SECRET` | Google OAuth client secret |
| `PUBLISH_REQUESTS_GMAIL_REFRESH_TOKEN` | Long-lived OAuth refresh token with `gmail.send` scope |
| `PUBLISH_REQUESTS_GMAIL_EMAIL` | The Gmail address used as the sender |

```bash
npx wrangler secret put PUBLISH_REQUESTS_GMAIL_CLIENT_ID
npx wrangler secret put PUBLISH_REQUESTS_GMAIL_CLIENT_SECRET
npx wrangler secret put PUBLISH_REQUESTS_GMAIL_REFRESH_TOKEN
npx wrangler secret put PUBLISH_REQUESTS_GMAIL_EMAIL
```

### Resend API (previous, commented out)

The original Resend API implementation is preserved as commented-out code in `src/index.js` (`sendEmailResend`). To switch back, uncomment it and rename to `sendEmail`, then set `RESEND_API_KEY` via `wrangler secret put` and restore `RESEND_FROM` in `wrangler.toml` vars.

## Configuration

### `wrangler.toml` vars

| Variable | Description |
|----------|-------------|
| `ENVIRONMENT` | `dev` or `production` |
| `DA_ORG` | Default DA organization (used when `org` not in request body) |
| `DA_REPO` | Default DA repository (used when `repo` not in request body) |
| `GMAIL_FROM` | Optional — override the From display name (defaults to `DA Publishing <gmail-address>`) |

## Development

```bash
npm run dev          # Local dev server (wrangler dev)
npm run deploy       # Deploy to default environment
npm run deploy:prod  # Deploy to production
npm run tail         # Stream live logs
```

## Email Templates

The worker includes three HTML email templates:

| Template | Used By | Description |
|----------|---------|-------------|
| `buildApprovalRequestEmail` | `/api/request-publish` | WSU-branded email with content details and a "Review & Approve" button linking to the DA App |
| `buildRejectionEmail` | `/api/notify-rejection` | Red-themed email with rejection reason, sent to author and DigiOps |
| `buildPublishedEmail` | `/api/notify-published` | Green-themed success email with live links to published pages |
