// Pure decision logic behind the MSM action panel. No DOM, no fetch, no Lit —
// everything here takes plain inputs (the linked-site column tree, the loaded
// cells/rows maps, the user's selection) and returns plain values, so it can be
// unit-tested directly. `action-panel.js` orchestrates IO and delegates these
// decisions here.
//
// Shared shapes:
//   tree        [{ site, label, children: [...] }]  linked-site subtree as columns
//   rootSite    the site the panel is centered on (matrix source site)
//   cells       Map(cellKey(path, site) -> { isDetached, lastModified, ... })
//   rows        Map(path -> { category, source, ... })  upward source-view rows
//   included    Set(site)                              target sites in scope

import {
  buildParentMap,
  effectiveSource as resolveSource,
  isOutOfSync as resolveOutOfSync,
} from '../core/source-tree.js';

// Stable key for a (page, linked-site) matrix cell.
export const cellKey = (pagePath, targetSite) => `${pagePath}:${targetSite}`;

// First node in the tree matching `site`, or null.
export function findNode(tree, site) {
  const find = (nodes) => {
    let result = null;
    nodes.some((n) => {
      if (n.site === site) { result = n; return true; }
      result = find(n.children || []);
      return result !== null;
    });
    return result;
  };
  return find(tree);
}

// `site` plus every descendant under it. Falls back to `[site]` when the site
// isn't in the tree (e.g. the root itself).
export function subtreeSites(tree, site) {
  const node = findNode(tree, site);
  if (!node) return [site];
  const out = [];
  const collect = (n) => { out.push(n.site); (n.children || []).forEach(collect); };
  collect(node);
  return out;
}

// Map of child site -> parent site; top-level columns map to `rootSite`.
export const parentMap = (tree, rootSite) => buildParentMap(tree, rootSite, (n) => n.site);

// Every column in the subtree, depth-first, regardless of expansion — the basis
// for data loading, target inclusion, and action scope.
export function flattenAll(tree, rootSite) {
  const out = [];
  const walk = (nodes, depth, parentSite) => nodes.forEach((n) => {
    out.push({
      site: n.site, label: n.label, depth, parentSite, childCount: n.children?.length || 0,
    });
    if (n.children?.length) walk(n.children, depth + 1, n.site);
  });
  walk(tree, 0, rootSite);
  return out;
}

// Visible columns only: children appear when their parent is in `expanded`.
export function flattenVisible(tree, rootSite, expanded) {
  const out = [];
  const walk = (nodes, depth, parentSite) => {
    nodes.forEach((n) => {
      const childCount = n.children?.length || 0;
      out.push({
        site: n.site, label: n.label, depth, parentSite, childCount,
      });
      if (childCount && expanded.has(n.site)) walk(n.children, depth + 1, n.site);
    });
  };
  walk(tree, 0, rootSite);
  return out;
}

// Tri-state of a column's checkbox given the included set, spanning its subtree.
export function columnState(tree, site, included) {
  const sub = subtreeSites(tree, site);
  const inc = sub.filter((s) => included.has(s)).length;
  if (inc === 0) return 'unchecked';
  if (inc === sub.length) return 'checked';
  return 'indeterminate';
}

// Cascade like the dialog's scope chips: a fully-checked column unchecks its
// whole subtree; a partially-checked (indeterminate) or unchecked column checks
// the subtree and re-enables ancestors. Keying off full-checkedness — not mere
// parent membership — is what makes an indeterminate parent fill in (check all)
// rather than wipe out. Returns a new Set (does not mutate `included`).
export function toggleTarget(tree, included, site, rootSite) {
  const next = new Set(included);
  const sub = subtreeSites(tree, site);
  const fullyChecked = sub.every((s) => next.has(s));
  if (fullyChecked) {
    sub.forEach((s) => next.delete(s));
  } else {
    sub.forEach((s) => next.add(s));
    const pm = parentMap(tree, rootSite);
    let p = pm.get(site);
    while (p && p !== rootSite) { next.add(p); p = pm.get(p); }
  }
  return next;
}

// Columns that must be expanded to reveal cells at the given target sites: each
// site's ancestors up to (but excluding) the root. The sites themselves need no
// expansion — only their ancestor columns must be open for them to show.
export function ancestorsToExpand(tree, rootSite, sites) {
  const pm = parentMap(tree, rootSite);
  const out = new Set();
  sites.forEach((site) => {
    let p = pm.get(site);
    while (p && p !== rootSite) { out.add(p); p = pm.get(p); }
  });
  return out;
}

// The source a linked site pulls from for a page: the nearest ancestor holding
// a detached copy (per already-loaded cells), else the root site.
export function effectiveSource(page, targetSite, pm, cells, rootSite) {
  const lookup = (site) => cells.get(cellKey(page.path, site));
  return resolveSource(targetSite, pm, lookup, rootSite, page.lastModified);
}

// Link category of a page from whether it has a detached copy and whether any
// ancestor source exists: linked (no copy) | detached (copy + source) | local
// (copy, no source anywhere above).
export function deriveCategory({ isDetached, sourceExists }) {
  if (!isDetached) return 'linked';
  return sourceExists ? 'detached' : 'local';
}

// A detached copy is behind its source when the source changed after the copy
// was last modified (beyond the publish-lag grace window).
export const isOutOfSync = resolveOutOfSync;

// Included downward cells matching a scope.
// scope: 'linked' (publish / detach) | 'detached' (sync / reconnect).
export function scopedCells(allColumns, pages, included, cells, scope) {
  const out = [];
  const targets = allColumns.filter((c) => included.has(c.site));
  pages.forEach((page) => {
    targets.forEach((col) => {
      const cell = cells.get(cellKey(page.path, col.site));
      if (!cell) return;
      const match = scope === 'detached' ? cell.isDetached : !cell.isDetached;
      if (match) out.push({ page, targetSite: col.site });
    });
  });
  return out;
}

// Source-view pages matching a scope, by link category.
// scope: 'linked' (publish / detach) | 'detached' (sync / reconnect).
export function scopedPagesUp(pages, rows, scope) {
  return pages.filter((p) => rows.get(p.path)?.category === scope);
}

// Group in-scope downward work into valid bulk-action calls — one target per
// group, the pages that share its resolved source — so sync / cancel pull from
// the right base at any tree depth.
export function downGroups({
  tree, pages, allColumns, included, cells, rootSite, scope,
}) {
  const pm = parentMap(tree, rootSite);
  const groups = new Map();
  scopedCells(allColumns, pages, included, cells, scope).forEach(({ page, targetSite }) => {
    const source = effectiveSource(page, targetSite, pm, cells, rootSite).site;
    const key = `${targetSite}|${source}`;
    if (!groups.has(key)) groups.set(key, { target: targetSite, source, pages: [] });
    groups.get(key).pages.push(page);
  });
  return [...groups.values()];
}

// Source view: target is always the current site; source is each page's
// resolved nearest ancestor with content (already computed in `rows`).
export function upGroups({
  pages, rows, scope, base, target,
}) {
  const groups = new Map();
  scopedPagesUp(pages, rows, scope).forEach((page) => {
    const source = rows.get(page.path)?.source || base;
    const key = source || '_';
    if (!groups.has(key)) groups.set(key, { target, source, pages: [] });
    groups.get(key).pages.push(page);
  });
  return [...groups.values()];
}

// Whether every (page, column) matrix cell has loaded — actions must wait for
// this so a click can't act on only the subset resolved so far (an unloaded
// cell is silently skipped, and source resolution walks loaded ancestor cells).
export function matrixComplete(pages, allColumns, cells) {
  return pages.every((p) => allColumns.every((c) => cells.has(cellKey(p.path, c.site))));
}

// Whether every source-view row has loaded — the upward-view counterpart.
export function sourceComplete(pages, rows) {
  return pages.every((p) => rows.has(p.path));
}

// Decide what the action panel should load when its selection changes. The
// context key is `org|site`; a context change is always a full reset (selection
// is single-site). Within a context, only newly-added pages load — removed
// pages keep their already-loaded data (instant re-add, no refetch). Returns the
// per-view page lists to load (empty when that role/view doesn't apply).
//   - 'noop'        nothing changed
//   - 'reset'       context changed → load all selected pages per role
//   - 'incremental' selection changed → load only pages not already loaded
export function planSelectionLoad({
  prevContextKey, prevSelKey, contextKey, selKey,
  pages, loadedDownPaths, loadedUpPaths, hasSource, hasLinked,
}) {
  if (contextKey === prevContextKey && selKey === prevSelKey) {
    return { kind: 'noop', downPages: [], upPages: [] };
  }
  if (contextKey !== prevContextKey) {
    return {
      kind: 'reset',
      downPages: hasSource ? pages : [],
      upPages: hasLinked ? pages : [],
    };
  }
  return {
    kind: 'incremental',
    downPages: hasSource ? pages.filter((p) => !loadedDownPaths.has(p.path)) : [],
    upPages: hasLinked ? pages.filter((p) => !loadedUpPaths.has(p.path)) : [],
  };
}
