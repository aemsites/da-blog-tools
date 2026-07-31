# Satellite Console

## Overview

Satellite Console is a Document Authoring (da.live) tool for managing multi-site content relationships. It enables a **base** site to preview and publish pages to one or more **satellite** sites, and allows satellite sites to copy, overwrite, or delete pages from their source base — with automatic link rewriting.

## Prerequisites

- A Base site configured in DA
- One or more satellite sites configuredin DA using the [DA MSM - Multi-Site Management for Edge Delivery Services](https://github.com/da-sites/da-msm) endpoint as the content source in the site config
- An authenticated [Document Authoring](https://da.live) session (the tool loads inside the DA SDK environment)
- A `satellites.json` configuration file placed at `/.da/satellites.json` in your org's content repository

## Configuration

Create a `satellites.json` file at `/{org}/.da/satellites.json` on `content.da.live`. Each row defines a relationship between a base site and a satellite site.

### Schema

| Column | Description |
|---|---|
| `base` (or `primary`) | The base site name (or `{org}/{site}` path) |
| `satellite` | The satellite site name (or `{org}/{site}` path) |
| `title` | Display name for the site in the console UI |

A row with only `base` and `title` (no `satellite`) sets the display title for the base site itself.

### Example

```json
[
  { "base": "main-site", "title": "Main Site" },
  { "base": "main-site", "satellite": "site-emea", "title": "EMEA" },
  { "base": "main-site", "satellite": "site-apac", "title": "APAC" }
]
```

The file also supports a `{ "data": [...] }` wrapper format.

## How It Works

On load, the console reads your org and current site from the DA SDK, fetches `satellites.json`, and determines whether the current site is a **base** or a **satellite**. The UI adapts accordingly.

### Base Mode

When opened from a base site, the console provides:

- **Page Tree** — Recursively crawls the base site and displays a navigable folder/file tree in the sidebar.
- **Satellite Matrix** — For each page in the selected folder, a table shows every satellite site with its status (exists / not found).
- **Selective Preview & Publish** — Check individual pages per satellite (or use the column header to select all), then preview and publish in sequence. Preview hits `admin.hlx.page/preview/...` and publish hits `admin.hlx.page/live/...`.
- **Activity Log** — Timestamped log of all preview/publish operations with success/error status.
- **Progress Bar** — Visual progress indicator during batch operations.

### Satellite Mode

When opened from a satellite site, the console provides:

- **Source Tree** — Crawls the source (base) site's content tree for browsing.
- **Local Status** — For each source page, shows whether a local copy exists on the satellite.
- **Copy** — Fetches the source page HTML, rewrites internal links (`.aem.page`, `.aem.live`, and DA content paths) to point to the satellite site, and saves the result.
- **Overwrite** — Re-copies a page that already exists locally.
- **Delete** — Removes a local page from the satellite (with confirmation).
- **Edit** — Direct link to open a copied page in the DA editor.

### Link Rewriting

When copying pages from base to satellite, the following substitutions are applied automatically:

| Pattern | Rewritten To |
|---|---|
| `main--{base}--{org}.aem.page` | `main--{satellite}--{org}.aem.page` |
| `main--{base}--{org}.aem.live` | `main--{satellite}--{org}.aem.live` |
| `/{org}/{base}/` | `/{org}/{satellite}/` |

## File Structure

```
satellite-console/
├── satellite-console.html   # Entry point
├── satellite-console.js     # Init, config parsing, role detection
├── satellite-console.css    # All styles (shared, base, satellite views)
├── views/
│   ├── base.js              # Base site UI and preview/publish logic
│   └── satellite.js         # Satellite site UI and copy/delete logic
└── icons/
    ├── Smock_Folder_18_N.svg
    ├── Smock_FolderOpen_18_N.svg
    ├── Smock_FileHTML_18_N.svg
    ├── Smock_FileData_18_N.svg
    ├── CheckmarkSize100.svg
    ├── CrossSize100.svg
    ├── InfoSmall.svg
    └── AlertSmall.svg
```

## Dependencies

All dependencies are loaded from CDN at runtime — no build step or `npm install` required.

| Dependency | Source | Purpose |
|---|---|---|
| DA SDK | `da.live/nx/utils/sdk.js` | Auth context (org, repo, token) |
| daFetch | `da.live/nx/utils/daFetch.js` | Authenticated fetch wrapper |
| crawl | `da.live/nx/public/utils/tree.js` | Recursive site tree traversal |
| Shoelace | `da.live/nx/public/sl/components.js` | UI components (`sl-button`, `sl-input`) |

## API Endpoints Used

| Endpoint | Used By | Purpose |
|---|---|---|
| `content.da.live/{org}/.da/satellites.json` | Init | Load satellite configuration |
| `admin.da.live/list/{org}/{site}{path}` | Both | List folder contents |
| `admin.da.live/source/{org}/{site}{path}` | Satellite | Read, write, and delete page source |
| `admin.hlx.page/preview/{org}/{site}/main{path}` | Base | Trigger AEM preview |
| `admin.hlx.page/live/{org}/{site}/main{path}` | Base | Trigger AEM publish |
