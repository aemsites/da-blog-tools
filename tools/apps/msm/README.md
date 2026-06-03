# MSM — Multi-Site Management

A DA (Document Authoring) tool for managing content links across source sites and the sites that link to them. MSM lets authors preview, publish, sync, and control independent copies between a source site and its linked sites from a single interface.

## Overview

In an AEM Edge Delivery Services multi-site setup, a **source site** holds the canonical content while **linked sites** pull from it. A linked site either stays linked (resolving content from its source) or holds its own detached copy. MSM provides a UI to manage this relationship — browsing content, checking link status, and executing bulk actions across linked sites.

## How It Works

### Roles

A site's role is relative to a relationship, so the UI names the two directions rather than labelling a site absolutely:

- **Linked sites view** — the sites that link to the current site (looking down). Actions target those sites for the selected pages.
- **Source view** — the single site the current site links up to (looking up). Actions apply between the current site and its source.

A site that is both (a mid-tier site) shows both via tabs. The role is determined automatically from the org's MSM configuration and the site entered in the toolbar.

### Link state

Each page on a linked site is either:

- **Linked** — no copy exists on the site; content resolves from its source (at preview/publish time).
- **Detached** — the site holds its own independent copy of the page, so it no longer follows the source.

Actions are scoped by this state. For example, Publish targets linked pages, while Merge/Replace target detached copies.

### Actions

Terminology matches the [MSM plugin](../../plugins/msm/README.md).

| Action | Scope | Description |
|---|---|---|
| **Preview** | Linked | Triggers a preview of the page on linked sites |
| **Publish** | Linked | Publishes the page to linked sites (live) |
| **Detach** | Linked | Creates an independent copy on the site, breaking the link |
| **Merge** | Detached | Updates the detached copy from source, keeping local edits (3-way merge) |
| **Replace** | Detached | Overwrites the detached copy with the source's content |
| **Reconnect** | Detached | Deletes the independent copy so the page links to its source again |

Confirmations name the destination, e.g. *"Publish 6 pages to 2 linked sites: India, Japan?"*.

## Configuration

MSM is configured at the **org level** via the DA Admin config API (`/config/{org}/`). The config must include an `msm` property with a `data` array of rows. Columns may use either the original `base`/`satellite` names or the new `source`/`linked` names — the app reads whichever is present:

| Column | Required | Description |
|---|---|---|
| `source` (or `base`) | Yes | The source site/repo name |
| `linked` (or `satellite`) | No | A linked site name. Rows without it define the source-site label. |
| `title` | No | Display label for the source or linked site |

A source site must have at least one linked site to appear in the app.

**Example config rows:**

| source | linked | title |
|---|---|---|
| `en` | | English (Source) |
| `en` | `fr` | French |
| `en` | `de` | German |

## Architecture

### Files

```
tools/apps/msm/
├── msm.html                    # Entry point (DA tool shell page)
├── msm.js                      # Root Lit component (MsmApp)
├── msm.css                     # Shell and layout styles
├── core/                       # Shared MSM logic (also used by the plugin)
│   ├── config.js               # Org config + link graph (source/linked)
│   ├── status.js               # Page timestamp + publish status + status config
│   ├── operations.js           # preview/publish/copy/delete/merge primitives
│   └── fetch.js                # Pluggable daFetch + constants
└── helpers/
    ├── api.js                  # App-facing API facade (folder listing, bulk exec)
    ├── column-browser.js       # Finder-style multi-column content browser
    ├── column-browser.css      # Column browser styles
    ├── action-panel.js         # Action selection, execution, and progress UI
    ├── action-panel.model.js   # Pure decision logic behind the action panel
    └── action-panel.css        # Action panel styles
```

### Components

- **`msm-app`** (`msm.js`) — Root component. Manages state (org, site, config), loads MSM configuration, and coordinates the browser and action panel.
- **`msm-column-browser`** (`column-browser.js`) — A Finder-style multi-column browser for navigating site content. Lists all sites, then navigates into a site's content tree (merging in linked content where applicable). Supports folder expansion, checkbox selection, keyboard navigation, and recursive folder selection.
- **`msm-action-panel`** (`action-panel.js`) — Displays available actions for the active view and selection. Supports the linked-sites matrix and source table, linked-site filtering, sync mode selection (Merge vs Replace), confirmation dialogs for destructive actions, and per-item progress tracking.

### External Dependencies

| Dependency | Source | Purpose |
|---|---|---|
| Lit (via `da-lit`) | `/tools/deps/lit/dist/index.js` | Web component framework |
| DA SDK | `https://da.live/nx/utils/sdk.js` | Provides auth context and token |
| DA Fetch | `https://da.live/nx/utils/daFetch.js` | Authenticated requests to DA APIs |
| NX Merge | `https://da.live/nx/blocks/loc/project/index.js` | `mergeCopy` for content merging |
| Shoelace components | `https://da.live/nx/public/sl/components.js` | UI primitives (`sl-input`, `sl-button`, etc.) |
| NX Styles | `https://da.live/nx/styles/` and `https://da.live/nx/public/sl/styles.css` | Shared design tokens and component styles |

### APIs

| Endpoint | Host | Methods | Purpose |
|---|---|---|---|
| `/config/{org}/` | `admin.da.live` | GET | Fetch org config including MSM rows |
| `/list/{org}/{site}{path}` | `admin.da.live` | GET | List folder contents |
| `/source/{org}/{site}{path}` | `admin.da.live` | HEAD, GET, PUT, DELETE | Check copies, read/write/delete content |
| `/preview/{org}/{site}/main{path}` | `admin.hlx.page` | POST | Trigger preview |
| `/live/{org}/{site}/main{path}` | `admin.hlx.page` | POST | Trigger publish |
| `/status/{org}/{site}/main{path}` | `admin.hlx.page` | GET | Check preview/live status |

Bulk operations run with a concurrency limit of 5 parallel requests.

## Usage

1. Open the MSM tool from the DA interface (hosted at `/tools/apps/msm/msm`).
2. Enter an org (e.g., `/myorg`) or org + site (e.g., `/myorg/en`) in the toolbar and click **Load**.
3. Browse the content tree using the column browser. Select pages or folders.
4. Choose an action from the action panel, configure options (sync mode, linked-site filter), and execute.
5. Monitor progress in the progress panel — each page/site combination shows pending, success, or error status.
