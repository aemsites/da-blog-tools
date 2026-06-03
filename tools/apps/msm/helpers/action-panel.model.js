// Pure decision logic behind the MSM action panel. No DOM, no fetch, no Lit —
// everything here takes plain inputs (the satellite column tree, the loaded
// cells/rows maps, the user's selection) and returns plain values, so it can be
// unit-tested directly. `action-panel.js` orchestrates IO and delegates these
// decisions here.
//
// Shared shapes:
//   tree        [{ site, label, children: [...] }]  satellite subtree as columns
//   rootSite    the site the panel is centered on (matrix base / source site)
//   cells       Map(cellKey(path, site) -> { hasOverride, lastModified, ... })
//   rows        Map(path -> { category, source, ... })  upward source-view rows
//   included    Set(site)                              target sites in scope

// Stable key for a (page, satellite) matrix cell.
export const cellKey = (pagePath, satSite) => `${pagePath}:${satSite}`;

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
export function parentMap(tree, rootSite) {
  const m = new Map();
  const walk = (nodes, parent) => nodes.forEach((n) => {
    m.set(n.site, parent);
    if (n.children?.length) walk(n.children, n.site);
  });
  walk(tree, rootSite);
  return m;
}

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

// Cascade like the dialog's scope chips: unchecking a column removes its whole
// subtree; checking it adds the subtree and re-enables ancestors. Returns a new
// Set (does not mutate `included`).
export function toggleTarget(tree, included, site, rootSite) {
  const next = new Set(included);
  const sub = subtreeSites(tree, site);
  if (next.has(site)) {
    sub.forEach((s) => next.delete(s));
  } else {
    sub.forEach((s) => next.add(s));
    const pm = parentMap(tree, rootSite);
    let p = pm.get(site);
    while (p && p !== rootSite) { next.add(p); p = pm.get(p); }
  }
  return next;
}

// The source a satellite pulls from for a page: the nearest ancestor holding a
// local copy (per already-loaded cells), else the root site.
export function effectiveSource(page, sat, pm, cells, rootSite) {
  let cur = pm.get(sat);
  while (cur && cur !== rootSite) {
    const cell = cells.get(cellKey(page.path, cur));
    if (cell?.hasOverride) return { site: cur, lm: cell.lastModified };
    cur = pm.get(cur);
  }
  return { site: rootSite, lm: page.lastModified };
}

// Inheritance category of a page from whether it has a local copy and whether
// any ancestor source exists: inherited (no copy) | override (copy + source) |
// local (copy, no source anywhere above).
export function deriveCategory({ hasOverride, sourceExists }) {
  if (!hasOverride) return 'inherited';
  return sourceExists ? 'override' : 'local';
}

// A local copy is out of sync when its source changed after the copy was last
// modified (beyond the publish-lag grace window).
export function isOutOfSync(sourceLm, selfLm, lagMs) {
  return !!(sourceLm && selfLm
    && new Date(sourceLm).getTime() > new Date(selfLm).getTime() + lagMs);
}

// Included downward cells matching a scope.
// scope: 'inherited' (rollout / cancel) | 'custom' (sync / re-enable).
export function scopedCells(allColumns, pages, included, cells, scope) {
  const out = [];
  const targets = allColumns.filter((c) => included.has(c.site));
  pages.forEach((page) => {
    targets.forEach((col) => {
      const cell = cells.get(cellKey(page.path, col.site));
      if (!cell) return;
      const match = scope === 'custom' ? cell.hasOverride : !cell.hasOverride;
      if (match) out.push({ page, satSite: col.site });
    });
  });
  return out;
}

// Source-view pages matching a scope, by inheritance category.
// scope: 'inherited' (roll out / cancel) | 'override' (sync / re-enable).
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
  scopedCells(allColumns, pages, included, cells, scope).forEach(({ page, satSite }) => {
    const source = effectiveSource(page, satSite, pm, cells, rootSite).site;
    const key = `${satSite}|${source}`;
    if (!groups.has(key)) groups.set(key, { target: satSite, source, pages: [] });
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
