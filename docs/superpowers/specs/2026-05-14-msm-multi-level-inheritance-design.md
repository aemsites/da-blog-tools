# MSM Multi-Level Inheritance — Design Spec

Date: 2026-05-14
Affects: `tools/apps/msm/`
Reference inputs:
- `msm-design-notes.md` §2 — multi-level inheritance architecture
- `msm-ui-redesign-spec.md` — Spectrum 2 UI redesign for the action panel

---

## 1. Goal

Extend the MSM tool app to support **multi-level inheritance**, where a single
site can act as both a satellite (has a parent) and a base (has children) — for
example, `europe-west-en` sitting between `europe-en` and `france-en`.

The data layer for multi-level (`getSiteRoles`, `walkChain`, `walkSubtree`,
descendant counts, `expandSatellitesWithSubtree`) is already in the working
tree. This spec covers the remaining work to surface that capability in the
authoring UI, and to land the Spectrum 2 redesign that the multi-level UX
depends on.

## 2. Scope

### In scope

- **Dual role classification.** Add a third role `'dual'` for sites that appear
  both as `base` and as `satellite` in the org `msm` sheet.
- **Direction switch on dual-role pages.** A Spectrum 2 Switch (M) labeled
  "Sync from parent" toggles the action picker between downward (push to
  children) and upward (pull from parent).
- **Action picker filtering** by direction — the picker shows only the
  optgroups relevant to the active direction. No mixed lists.
- **Upward action set.** Two new picker values, `'sync-from-base'` and
  `'resume-inheritance'`, aliased in `executeBulkAction` to the existing
  `'sync'` / `'reset'` execution paths with `baseSite = parent` and
  `satellites = { [self]: … }`.
- **UI redesign deltas from `msm-ui-redesign-spec.md`** that the multi-level
  story depends on:
  - Static breadcrumb above the switch (`Inherits from a › b › self`)
  - Upward summary block (`Source` / `Target` / `Local override`)
  - Action row as a fixed `1fr 1fr` grid with conditional sync-mode picker
  - Footer cascade toggle moved next to Apply
  - Picker label rebrand: `'preview'` → "Roll out to preview", `'publish'` →
    "Roll out to live" (action **values** unchanged)
  - Confirm dialog restyled as a yellow caution box using `--s2-yellow-*`
    fallbacks

### Out of scope

- Worker recursion change in the `da-msm` Cloudflare Worker repo
- Translation / `.da/translate.json` integration
- Custom-path support (`pathmap` sheet, `<meta name="msm-source-*">`)
- Worker-side hardening (KV cache, ETag revalidation, batched HEADs,
  cross-org scope check)

## 3. Architecture

### 3.1 Roles

```
classifySite(site):
  roles = getSiteRoles(config, site)
  if roles.asBase && roles.asSatellite → role = 'dual'
  else if roles.asBase                  → role = 'base'
  else if roles.asSatellite             → role = 'satellite'
  else                                  → fallback to first base, with warning
```

`getSiteRoles` already returns `{asBase, asSatellite}` and is unchanged.

### 3.2 Data flow into the action panel

`msm.js` exposes both shapes to `<msm-action-panel>` rather than collapsing to
one:

| Property         | Provided when     | Purpose                                 |
| ---------------- | ----------------- | --------------------------------------- |
| `role`           | always            | `'base' \| 'satellite' \| 'dual'`       |
| `parentChain`    | satellite, dual   | Breadcrumb display                      |
| `parentBase`     | satellite, dual   | Upward sync source site                 |
| `satellites`     | base, dual        | Direct children (label, descCount)      |
| `hasDescendants` | base, dual        | Cascade toggle visibility               |
| `msmConfig`      | always            | Subtree expansion for cascade           |

In `handleBrowseSelection`, when navigating via the column browser into a
different site (still in base/dual mode), re-classify so dual-role middle-tier
sites carry their parent context across navigation.

### 3.3 Direction state

Direction is **derived**, not stored:

```js
const UPWARD_VALUES = new Set(['sync-from-base', 'resume-inheritance']);
get _isUpwardMode() { return UPWARD_VALUES.has(this._action); }
get _hasDualRole()  { return this.role === 'dual'; }
```

The Spectrum 2 switch's `checked` reflects `_isUpwardMode`. `onChange` calls:

```js
onDirectionToggle(toUpward) {
  this.onActionChange(toUpward ? 'sync-from-base' : 'preview');
}
```

`onActionChange` resets `_taskStatuses` and `_pageActions`, same path the
picker `@change` already uses. State stays consistent regardless of which
control the user manipulates.

**Initial `_action` value depends on role**, set in `connectedCallback`:

| Role        | Initial `_action`   | Initial `_isUpwardMode` |
| ----------- | ------------------- | ----------------------- |
| `base`      | `'preview'`         | false                   |
| `satellite` | `'sync-from-base'`  | true                    |
| `dual`      | `'preview'`         | false (default OFF)     |

This replaces the existing unconditional `this._globalAction = 'preview'`.

### 3.4 Action values and direction mapping

| Picker value          | Direction | Executor case (in `executeBulkAction`)            |
| --------------------- | --------- | ------------------------------------------------- |
| `preview`             | down      | `previewSatellite(org, satSite, …)`               |
| `publish`             | down      | `publishSatellite(org, satSite, …)`               |
| `break`               | down      | `createOverride(org, baseSite, satSite, …)`       |
| `sync`                | down      | `mergeFromBase` or `createOverride`               |
| `reset`               | down      | `deleteOverride(org, satSite, …)`                 |
| `sync-from-base`      | up        | aliased to `sync` case (params from upward setup) |
| `resume-inheritance`  | up        | aliased to `reset` case (params from upward setup)|

Upward setup: in `apply()` / `executeAll()`, when `_isUpwardMode`, the panel
sets `baseSite = this.parentBase` and `satellites = { [this.site]: {…} }`
before calling `executeBulkAction`. The two new `case 'sync-from-base':` and
`case 'resume-inheritance':` lines fall through to the existing `'sync'` /
`'reset'` handlers — no logic duplication.

`RECURSIVE_ACTIONS` stays `new Set(['preview', 'publish'])`. Cascade is
downward-only by definition.

### 3.5 Adaptive layout (per `msm-ui-redesign-spec.md` §4)

| Page role     | Switch state    | Breadcrumb | Switch | Picker             | Children list | Summary |
| ------------- | --------------- | ---------- | ------ | ------------------ | ------------- | ------- |
| Base only     | n/a (down)      | hidden     | no     | Down optgroups     | shown         | no      |
| Satellite only| n/a (up)        | shown      | no     | Up optgroup        | not rendered  | shown   |
| Dual          | OFF (down)      | shown      | yes    | Down optgroups     | shown         | no      |
| Dual          | ON  (up)        | shown      | yes    | Up optgroup        | hidden        | shown   |

## 4. Component-level changes

### 4.1 `msm.js`

- Add `'dual'` branch to `classifySite`.
- Replace single `_baseSite` / `_satellites` with both `_parentBase` /
  `_parentChain` (upward context) and `_satellites` / `_hasDescendants`
  (downward context). `_baseSite` becomes a derived alias of `_parentBase`
  for backward-compat reading where needed.
- Pass `parentBase`, `parentChain`, `role` (now possibly `'dual'`),
  `satellites`, `hasDescendants`, `msmConfig` to `<msm-action-panel>`.
- `handleBrowseSelection`: when re-classifying the navigated-into site,
  populate both upward and downward fields if it's dual.

### 4.2 `helpers/action-panel.js`

**State** — no new state variables. `_action`, `_globalAction`, `_pageActions`
already exist. `_isUpwardMode` and `_hasDualRole` are derived getters.

**New constants:**

```js
const DOWNWARD_ACTIONS = [
  { heading: 'Inherited sites', items: [
      { value: 'preview', label: 'Roll out to preview' },
      { value: 'publish', label: 'Roll out to live' },
      { value: 'break',   label: 'Cancel inheritance' },
  ]},
  { heading: 'Custom sites', items: [
      { value: 'sync',  label: 'Sync to satellite' },
      { value: 'reset', label: 'Resume inheritance' },
  ]},
];

const UPWARD_ACTIONS = [
  { heading: 'From parent', items: [
      { value: 'sync-from-base',     label: 'Sync from base' },
      { value: 'resume-inheritance', label: 'Resume inheritance' },
  ]},
];

const UPWARD_VALUES = new Set(['sync-from-base', 'resume-inheritance']);
const RECURSIVE_ACTIONS = new Set(['preview', 'publish']);
```

`BASE_ACTION_OPTIONS` and `SAT_ACTION_OPTIONS` are removed; `_actionOptions`
returns `_isUpwardMode ? UPWARD_ACTIONS : DOWNWARD_ACTIONS`.

**New render helpers:**

```
renderBreadcrumb()         // satellite/dual: static "Inherits from a › b › self"
renderDirectionSwitch()    // dual only: native checkbox styled as S2 Switch
renderUpwardSummary()      // satellite/dual+upward: Source/Target/Local override
renderFooter()             // cascade toggle (left) + Apply (right)
renderConfirm()            // yellow caution box (restyled .alert-dialog)
```

`renderActionPicker()` builds optgroups based on `_isUpwardMode`.
`renderChildrenList()` (existing `renderSatelliteGrid`) returns `nothing` when
`_isUpwardMode`. `renderProgress()` and `renderPageRow()` are unchanged.

**Main `render()`:**

```
breadcrumb?
direction switch?
action row (picker + conditional sync-mode)
upward summary?
children list? OR page table?
progress?
footer (cascade + Apply)
confirm?
```

`renderSinglePage` and `renderBulk` are simplified to share this skeleton via
a single top-level `renderPanel(mode)` function. The two modes differ only in
which subtree renders inside the body slot (satellite grid vs page table).

**Apply path:**

```js
async apply() {
  if (this._isUpwardMode) {
    return this._applyUpward();   // baseSite = parentBase, sats = {[self]: …}
  }
  return this._applyDownward();   // existing executeAll() path
}
```

`_applyUpward()` reuses `executeBulkAction` with the upward parameter setup,
hitting the aliased `case 'sync-from-base':` / `case 'resume-inheritance':`
branches in `api.js`.

### 4.3 `helpers/api.js`

Add two `case` aliases in the `executeBulkAction` switch:

```js
case 'sync':
case 'sync-from-base':
  result = syncMode === 'merge'
    ? await mergeFromBase(org, baseSite, satSite, pagePath, ext)
    : await createOverride(org, baseSite, satSite, pagePath, ext);
  break;
case 'reset':
case 'resume-inheritance': {
  // existing reset block, unchanged
}
```

No other API changes. `getSiteRoles`, `walkChain`, `walkSubtree`,
`getDescendantCount`, `expandSatellitesWithSubtree` — all unchanged.

### 4.4 `helpers/action-panel.css`

**Add:**

- `.crumb-row` — single static horizontal row, no card, no click affordance
- `.direction-switch` — S2 Switch (M) lookalike: 26×14 pill track, 10px white
  knob, `gray-300` off-track, `blue-700` on-track, 14px label "Sync from
  parent" to the right
- `.upward-summary` — flex column of `<label>`/`<value>` rows for
  Source / Target / Local-override status; no card background
- `.footer-cascade` — inline-flex label sitting to the left of `Apply` in the
  footer row

**Modify:**

- `.action-row` from `flex-wrap: wrap` to `display: grid;
  grid-template-columns: 1fr 1fr; gap: 12px`. The sync-mode picker
  conditionally renders into the right column; otherwise the right column
  stays empty so the action picker doesn't expand
- `.alert-dialog` adopts a yellow caution treatment using token-with-fallback
  syntax: `background: var(--s2-yellow-100, #fef9ee)`, `border: 1px solid
  var(--s2-yellow-400, #f5d96b)`, with `⚠` glyph in the heading
- `.include-descendants` styling lifted into `.footer-cascade` (footer-anchored
  inline-flex)

**Remove:** nothing — the boxed-card classes the original spec called out
(`.msm-section.has-companion`, `.section-title`) don't exist in the current
file. Current state is already cleaner than the spec's "before" baseline.

### 4.5 Files NOT touched

- `tools/apps/msm/helpers/column-browser.js` / `.css`
- `tools/apps/msm/msm.css`
- `tools/apps/msm/msm.html`
- `tools/apps/msm/README.md` (will be updated separately if dual-role behavior
  needs documentation, kept out of this spec)

## 5. Edge cases and decisions

### 5.1 Bulk mode in upward direction

Spec §4 only describes single-page layouts. For bulk + dual + upward:

- The page table stays — it's the "what to operate on" list, not a satellite
  list.
- Per-row action picker filters to upward options.
- Upward summary collapses to a one-liner: `Source: <parent> → Target: <self>`.
  No per-page override count (each row already has its own override badge).

### 5.2 "Resume inheritance" appears in both directions

Same label, different scope:

- Downward: deletes overrides at children (multi-target, scoped to selected
  satellites)
- Upward: deletes the override at *self* against parent (single target — the
  current site)

The label stays "Resume inheritance" in both. Direction-switch position makes
the meaning clear, and the confirm dialog spells out exactly what's being
deleted.

### 5.3 Cascade toggle in upward mode

Cascade only makes sense for downward recursive actions (`preview`/`publish`
on inherited satellites' descendants). In upward mode there are no descendants
to cascade into — `_showDescendantsToggle` returns `false`, footer stays
clean.

### 5.4 Default direction on a dual-role page

Switch defaults OFF (downward). Authors most often visit a middle-tier site
to push *out*, not pull *in*.

### 5.5 Switch state preservation

When switch flips ON: children list hidden entirely (not dimmed). When it
flips back OFF: previously-selected satellites and per-page actions are
preserved (not cleared). Only `_action` resets to the appropriate direction's
first item via `_resetExecution`.

### 5.6 Cycles in the config sheet

`walkChain` and `walkSubtree` already use a `visited` set; classification
stops cleanly. No new code needed; covered by a unit test.

### 5.7 Site that is satellite of two different bases (malformed config)

`getParentRow` returns the first match; behavior is deterministic but
config-author error. Document, don't try to fix in v1.

### 5.8 Upward "Resume inheritance" when there's no local override

The "Local override: no" line in the summary tells the user that
`Sync from base` will create one. `Resume inheritance` is a no-op in this
case — Apply is disabled with a tooltip explanation.

### 5.9 `mergeFromBase` upward

Uses the existing `mergeCopy` path with `source = /org/parent/path`,
`destination = /org/self/path`. Same NX dependency; no behavior change in
`api.js` itself.

## 6. Testing approach

### 6.1 Manual testing

Configure an org sheet that exercises all three roles, e.g.
`global-en → europe-en → europe-west-en → france-en`:

1. **Base-only on `global-en`:** breadcrumb hidden, switch hidden, downward
   picker (`Roll out to preview` / `Roll out to live` / `Cancel inheritance`
   / `Sync to satellite` / `Resume inheritance`), children list shown.
2. **Satellite-only on `france-en`:** breadcrumb shown, switch hidden
   (implicit upward), upward picker only (`Sync from base` /
   `Resume inheritance`), upward summary shown.
3. **Dual on `europe-west-en`:** breadcrumb shown, switch shown OFF →
   downward; ON → upward summary, children hidden.
4. **Cascade toggle on `global-en`** with `Roll out to preview` selected →
   fans out through all 3 descendant levels.

### 6.2 Unit tests

`helpers/api.js` multi-level helpers are pure functions, worth keeping:

- `getSiteRoles` returns `{asBase, asSatellite}` for dual-role site, single
  shape for leaf or root
- `walkChain` produces `[]` for root, single-element for direct child,
  multi-element for deep descendant
- `walkSubtree` enumerates all descendants, deduplicates on cycle
- `expandSatellitesWithSubtree` adds descendants without overwriting direct
  children's labels

The action panel itself is mostly UI; manual coverage is sufficient for v1.
If a unit-test harness for Lit components is later added, dual-role
classification and switch toggling are the natural first targets.

### 6.3 Lint

`npm run lint` must pass. Existing `eslint-disable` directives at the top of
each file (`no-underscore-dangle, import/no-unresolved, no-console,
class-methods-use-this`) carry over.

## 7. Backward compatibility

- All existing sites continue to classify as `'base'` or `'satellite'` exactly
  as today; only sites that appear in *both* `base` and `satellite` columns
  pick up the new `'dual'` role.
- Picker action **values** are unchanged for downward actions; only their
  user-facing labels change. Saved bookmarks, automated scripts, and
  per-page action state stay valid.
- `executeBulkAction` adds two case aliases, no signature change.
- No API contract change to `helpers/api.js` exports.
- No HTML or CSS class renames that could break user-side selectors (this is
  a shadow-DOM Lit component anyway).

### Intentional behavior change: own-site Preview/Publish removed from satellite picker

Today, satellite-only mode shows `Preview` / `Publish` (own site) under a
"Content" optgroup, alongside `Sync from base` / `Resume inheritance` under
"Inheritance". Per `msm-ui-redesign-spec.md` §4 (table), the new design shows
**only the "From parent" optgroup** in satellite-only and dual+upward modes.

Rationale:
- Own-site Preview/Publish are not MSM concerns — they're part of the
  standard DA preview/publish workflow available outside the MSM panel.
- Mixing own-site and cross-site actions in one picker is the visual noise
  the redesign explicitly cleans up.

Authors who today preview/publish a satellite's own pages from the MSM panel
will need to use DA's standard preview/publish controls instead (the
sidekick, the in-editor publish button, or the DA admin UI). This is called
out in the PR description so users have advance warning.

## 8. Risks

| Risk                                                | Mitigation                                               |
| --------------------------------------------------- | -------------------------------------------------------- |
| Author confusion between downward and upward modes  | Direction switch label + breadcrumb + summary block      |
| Misconfigured sheet with cycles                     | Existing `visited` set in `walkChain`/`walkSubtree`      |
| Upward `Resume inheritance` deletes the wrong file  | Confirm dialog spells out path; Apply disabled when N/A  |
| Action picker filter regression on satellite-only   | Switch is hidden when not dual, picker still filters     |
| CSS regression in confirm dialog                    | Tokens use fallbacks (`var(--s2-yellow-100, #fef9ee)`)   |

## 9. Roll-out

Single PR. The `'dual'` role is opt-in at the data level (only triggers when
the org sheet actually has a site appearing in both columns). Existing
customers see no behavioral change unless they add a multi-level row.

## 10. Deferred follow-ups

None blocking. Items intentionally pushed to later iterations:

- Visual inheritance graph (D3/SVG) instead of a flat breadcrumb. Out of
  scope; revisit if customers report the breadcrumb being insufficient at
  4+ ancestor depth.
- Clickable `parentChain` for column-browser navigation. `msm-ui-redesign-spec.md`
  §3 #5 says no for v1 — the switch is the direction control.
- Restoring own-site Preview/Publish in satellite mode if user feedback
  indicates the change is disruptive. The mechanism would be adding a
  small "Self" optgroup back to `UPWARD_ACTIONS`.
