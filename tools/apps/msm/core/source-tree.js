// Shared source-resolution logic for the MSM matrix (app) and the per-page
// linked tree (plugin). Both arrange linked sites into a parent→child tree and
// must answer the same question for any target site: which site does it pull
// from? The answer is the nearest ancestor that holds a detached copy, else the
// root site. Keeping this in one place stops the two views from drifting — e.g.
// a confirm dialog naming one source while the operation copies from another.

// Map of child site -> parent site; top-level nodes map to `rootSite`. `keyOf`
// reads a node's site id, since the app keys nodes on `site` and the plugin on
// `siteId`.
export function buildParentMap(tree, rootSite, keyOf) {
  const m = new Map();
  const walk = (nodes, parent) => nodes.forEach((n) => {
    m.set(keyOf(n), parent);
    if (n.children?.length) walk(n.children, keyOf(n));
  });
  walk(tree, rootSite);
  return m;
}

// Ancestors of `site`, nearest parent first, stopping before the root sentinel
// (top-level nodes map to `rootSite`, which is not itself a tree node).
export function ancestorChain(site, pm, rootSite) {
  const chain = [];
  let cur = pm.get(site);
  while (cur && cur !== rootSite) { chain.push(cur); cur = pm.get(cur); }
  return chain;
}

// The source a target site pulls from: the nearest ancestor with a detached
// copy (per `lookup`), else the root. `lookup(site)` returns
// `{ isDetached, lastModified }` (or undefined when that site isn't loaded yet).
// Returns `{ site, lm }`; for the root, `lm` is the caller-supplied `rootLm`.
export function effectiveSource(targetSite, pm, lookup, rootSite, rootLm) {
  let cur = pm.get(targetSite);
  while (cur && cur !== rootSite) {
    const info = lookup(cur);
    if (info?.isDetached) return { site: cur, lm: info.lastModified ?? null };
    cur = pm.get(cur);
  }
  return { site: rootSite, lm: rootLm ?? null };
}

// A detached copy is behind its source when the source changed after the copy's
// last-modified time, beyond the publish-lag grace window.
export function isOutOfSync(sourceLm, selfLm, lagMs) {
  return !!(sourceLm && selfLm
    && new Date(sourceLm).getTime() > new Date(selfLm).getTime() + lagMs);
}
