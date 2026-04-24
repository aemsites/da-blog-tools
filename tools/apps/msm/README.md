# MSM — Multi-Site Management

A DA (Document Authoring) tool for managing content inheritance across base sites and their satellite sites. MSM lets authors preview, publish, sync, and control content overrides between a base site and its satellites from a single interface.

## Overview

In an AEM Edge Delivery Services multi-site setup, a **base site** holds the canonical content while **satellite sites** inherit from it. Satellites can either inherit pages directly from the base or maintain custom overrides. MSM provides a UI to manage this relationship — browsing content, checking inheritance status, and executing bulk actions across satellites.

## How It Works

### Roles

- **Base mode** — The user operates from the perspective of a base site. Actions target inherited or customized satellites for the selected pages.
- **Satellite mode** — The user operates from a single satellite site. Actions apply only to that satellite.

The role is determined automatically based on the org's MSM configuration and the site entered in the toolbar.

### Content Inheritance

Each page on a satellite is either:

- **Inherited** — No local copy exists on the satellite; it inherits content from the base site.
- **Custom (overridden)** — A local copy exists on the satellite, breaking inheritance.

Actions are scoped by this status. For example, "Preview" and "Publish" target inherited satellites, while "Sync" and "Resume inheritance" target satellites with custom overrides.

### Actions

| Action | Scope | Description |
|---|---|---|
| **Preview** | Inherited | Triggers a preview of the page on inherited satellites |
| **Publish** | Inherited | Publishes the page to inherited satellites |
| **Cancel inheritance** | Inherited | Creates a local copy on the satellite, breaking inheritance |
| **Sync to satellite** | Custom | Updates the satellite's override — either via **Merge** (preserves satellite edits) or **Override** (replaces with base content) |
| **Resume inheritance** | Custom | Deletes the satellite override and re-previews/publishes if the page was previously live |

## Configuration

MSM is configured at the **org level** via the DA Admin config API (`/config/{org}/`). The config must include an `msm` property with a `data` array of rows:

| Column | Required | Description |
|---|---|---|
| `base` | Yes | The base site/repo name |
| `satellite` | No | A satellite site name. Rows without `satellite` define the base site label. |
| `title` | No | Display label for the base or satellite |

A base site must have at least one satellite to appear in the app.

**Example config rows:**

| base | satellite | title |
|---|---|---|
| `en` | | English (Base) |
| `en` | `fr` | French |
| `en` | `de` | German |

## Architecture

### Files

```
tools/apps/msm/
├── msm.html                    # Entry point (DA tool shell page)
├── msm.js                      # Root Lit component (MsmApp)
├── msm.css                     # Shell and layout styles
└── helpers/
    ├── api.js                  # All API calls (DA Admin, AEM Admin, NX merge)
    ├── column-browser.js       # Finder-style multi-column content browser
    ├── column-browser.css      # Column browser styles
    ├── action-panel.js         # Action selection, execution, and progress UI
    └── action-panel.css        # Action panel styles
```

### Components

- **`msm-app`** (`msm.js`) — Root component. Manages state (org, site, role, config), loads MSM configuration, classifies the site as base or satellite, and coordinates the browser and action panel.
- **`msm-column-browser`** (`column-browser.js`) — A Finder-style multi-column browser for navigating site content. Lists base sites (in base mode) or navigates directly into a satellite's content tree. Supports folder expansion, checkbox selection, keyboard navigation, and recursive folder selection.
- **`msm-action-panel`** (`action-panel.js`) — Displays available actions based on role and selection. Supports single-page and bulk modes, satellite filtering, sync mode selection (Merge vs Override), confirmation dialogs for destructive actions, and per-item progress tracking.

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
| `/source/{org}/{site}{path}` | `admin.da.live` | HEAD, GET, PUT, DELETE | Check overrides, read/write/delete content |
| `/preview/{org}/{site}/main{path}` | `admin.hlx.page` | POST | Trigger preview |
| `/live/{org}/{site}/main{path}` | `admin.hlx.page` | POST | Trigger publish |
| `/status/{org}/{site}/main{path}` | `admin.hlx.page` | GET | Check preview/live status |

Bulk operations run with a concurrency limit of 5 parallel requests.

## Usage

1. Open the MSM tool from the DA interface (hosted at `/tools/apps/msm/msm`).
2. Enter an org (e.g., `/myorg`) or org + site (e.g., `/myorg/en`) in the toolbar and click **Load**.
3. Browse the content tree using the column browser. Select pages or folders.
4. Choose an action from the action panel, configure options (sync mode, satellite filter), and execute.
5. Monitor progress in the progress panel — each page/satellite combination shows pending, success, or error status.
