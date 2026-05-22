# Multi-site Manager (MSM) Plugin

A DA Prepare-menu plugin for managing multi-site inheritance from the page editor.
Lets authors roll out, sync, override, and resume inheritance between a base site
and its satellite sites without leaving DA.

This plugin is a standalone fork of the OOTB `Multi-site Manager` action that
ships in [`da-live`](https://github.com/adobe/da-live/tree/main/blocks/edit/da-prepare/actions/msm).
The OOTB version is still available by default; sites that want to opt in to
the plugin (e.g. to pin a specific version, or to use the plugin URL from any
site config without copying code) can configure their `prepare` sheet as
described below.

## How it works

1. Authors open a page in DA, click the Prepare menu, and pick **Multi-site Manager**.
2. The plugin reads the org's `msm` config sheet to determine the page's role:
   - **As a base** — lists satellites that inherit from this site.
   - **As a satellite** — shows the inheritance chain up to the base.
   - **Dual role** — both, with a "Sync from parent" switch to flip direction.
3. The author picks an action (roll out to preview/live, cancel inheritance,
   sync from base, resume inheritance, etc.) and the plugin executes it via
   the DA Admin and AEM Admin APIs.

The plugin uses [`DA_SDK`](https://da.live/nx/utils/sdk.js) so all admin calls
are authenticated against the host page's signed-in user — no separate auth
is required.

## Configuration

### 1. `.da/config.json` — `msm` sheet

The plugin reads the org-level `msm` sheet to discover the base/satellite
relationships. Each row describes one site:

| base   | satellite   | title           |
| ------ | ----------- | --------------- |
| mccs   |             | MCCS Global     |
| mccs   | san-diego   | San Diego       |
| mccs   | pendleton   | Camp Pendleton  |

- A row with `base` set and `satellite` empty defines the **base label** for
  that site (used in the breadcrumb).
- A row with both `base` and `satellite` defines an inheritance edge: edits
  to the base flow to the satellite unless the satellite has a local override.
- Multi-level inheritance works: a `satellite` row can also appear as a
  `base` row pointing to deeper satellites.

### 2. `.da/config.json` — `prepare` sheet

To make the plugin appear in the Prepare menu, add a row to the `prepare`
sheet at either the org or site level. Either point at this repo's hosted
plugin (no code copy needed) or use a relative path if you've vendored the
plugin into your own repo:

**Option A: use the hosted plugin (recommended)**

| title              | path                                                                                    | icon                                                                  | experience |
| ------------------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------- |
| Multi-site Manager | `https://main--da-blog-tools--aemsites.aem.live/tools/plugins/msm/msm.html`              | `https://da.live/blocks/edit/img/S2_Icon_GlobeGrid_20_N.svg#S2_Icon_GlobeGrid` | dialog     |

**Option B: vendored copy in your repo**

| title              | path                              | icon                                                                  | experience |
| ------------------ | --------------------------------- | --------------------------------------------------------------------- | ---------- |
| Multi-site Manager | `/tools/plugins/msm/msm.html`     | `https://da.live/blocks/edit/img/S2_Icon_GlobeGrid_20_N.svg#S2_Icon_GlobeGrid` | dialog     |

> The DA Prepare menu merges items by `title`, so using `Multi-site Manager`
> as the title overrides the OOTB version when this row is present.

## Behavior matrix

| Page role        | Direction available     | Actions                                                                   |
| ---------------- | ----------------------- | ------------------------------------------------------------------------- |
| Base only        | Downward (children)     | Roll out to preview · Roll out to live · Cancel inheritance · Sync · Resume inheritance |
| Satellite only   | Upward (parent)         | Sync from base · Resume inheritance                                       |
| Both             | Toggleable via switch   | Both sets, scoped by the switch position                                  |

### Sync modes

When syncing content from a base to a satellite (or vice versa), two modes are
available:

- **Merge** — runs a 3-way merge that preserves local edits in the satellite
  while pulling in changes from the base. Backed by the
  `mergeCopy` function from [`nx/blocks/loc/project`](https://da.live/nx/blocks/loc/project/index.js),
  loaded dynamically at runtime.
- **Override** — replaces the satellite's content with the base's content.
  Local edits are lost.

### Cascade to nested sites

For recursive actions (Roll out to preview / live) on sites that have nested
descendants, an extra checkbox appears in the footer:
**"Cascade to nested sites (+N more)"**. When checked, the action runs against
the entire subtree below each selected satellite, not just the direct child.

## Relationship to the OOTB version

This plugin is a **fork-copy** of `blocks/edit/da-prepare/actions/msm/` in
da-live. The component itself (`<da-msm>`) and its CSS are the same; only
the dependency wiring differs:

| Concern            | OOTB (da-live)                                  | Plugin (this repo)                                                 |
| ------------------ | ----------------------------------------------- | ------------------------------------------------------------------ |
| Lit                | `da-lit` resolved internally                    | `da-lit` resolved via importmap → `/tools/deps/lit/dist/index.js`  |
| `daFetch`          | `blocks/shared/utils.js`                        | `DA_SDK.actions.daFetch`, plumbed in via `setSdkFetch`             |
| `DA_ORIGIN`        | `blocks/shared/constants.js`                    | `https://da.live/nx/public/utils/constants.js`                     |
| NX URL             | `getNx()` (versioned/branch-aware)              | Hardcoded `https://da.live/nx`                                     |
| `mergeCopy`        | Dynamic import via `getNx()`                    | Dynamic import via the hardcoded NX URL                            |
| UI primitives      | `se-*` components from `${nx}/public/se/components.js`   | `sl-*` components from `${NX}/public/sl/components.js`, styled via nexter + `sl/styles.css` + `buttons.css` (loaded with `loadStyle` / `getStyle`) |
| Icons              | Relative paths `/blocks/edit/img/...`           | Absolute URLs `https://da.live/blocks/edit/img/...`                |
| Edit-link origin   | `window.location.origin` (always da.live)       | Derived from `document.referrer`; falls back to `https://da.live`  |

## Files

```
tools/plugins/msm/
├── README.md   (this file)
├── msm.html    (iframe entry; loads da-lit via importmap and msm.js)
├── msm.js      (<da-msm> Lit component + self-init from DA_SDK)
├── msm.css     (component styles, adapted to fill the 400x400 iframe)
├── config.js   (org/site msm-config resolution, override checks)
└── utils.js    (preview/publish/override/merge AEM+DA admin calls)
```
