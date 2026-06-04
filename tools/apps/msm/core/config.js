/* eslint-disable import/no-unresolved */
import { daFetch, DA_ORIGIN } from './fetch.js';

// The authored config sheet may use either the original `base`/`satellite`
// column names or the new `source`/`linked` names. These accessors read
// whichever is present, so the sheet can be migrated to the new vocabulary
// without a code change (and mixed rows still work during a migration).
const sourceOf = (row) => row.base ?? row.source;
const linkedOf = (row) => row.satellite ?? row.linked;
const hasGraphCols = (rows) => rows.length > 0 && sourceOf(rows[0]) !== undefined;

// ──────────────────────────────────────────────
// Org config fetching + caching
// ──────────────────────────────────────────────

const orgConfigPromises = {};
const msmConfigCache = {};
const siteConfigCache = {};

export function clearMsmCache() {
  [orgConfigPromises, msmConfigCache, siteConfigCache].forEach((cache) => {
    Object.keys(cache).forEach((k) => { delete cache[k]; });
  });
}

function fetchOrgConfig(org) {
  if (!org) return Promise.resolve(null);
  orgConfigPromises[org] ??= (async () => {
    // no-store so a fresh Load (which clears the JS cache) actually re-reads
    // the sheet rather than a heuristically-cached response.
    const resp = await daFetch(`${DA_ORIGIN}/config/${org}/`, { cache: 'no-store' });
    if (!resp.ok) return null;
    return resp.json();
  })();
  return orgConfigPromises[org];
}

export async function fetchOrgMsmRows(org) {
  const orgConfig = await fetchOrgConfig(org);
  return orgConfig?.msm?.data || [];
}

// ──────────────────────────────────────────────
// Link graph helpers (operate on raw rows)
// ──────────────────────────────────────────────

function getDirectChildren(rows, site) {
  return rows
    .filter((row) => sourceOf(row) === site && linkedOf(row))
    .map((row) => ({ site: linkedOf(row), label: row.title || linkedOf(row) }));
}

function getParentRow(rows, site) {
  return rows.find((row) => linkedOf(row) === site);
}

function getSourceLabel(rows, site) {
  const labelRow = rows.find((row) => sourceOf(row) === site && !linkedOf(row));
  return labelRow?.title;
}

function walkSubtree(rows, rootSite, visited = new Set()) {
  if (visited.has(rootSite)) return [];
  visited.add(rootSite);
  return getDirectChildren(rows, rootSite).flatMap((child) => [
    child,
    ...walkSubtree(rows, child.site, visited),
  ]);
}

function walkChain(rows, site) {
  const chain = [];
  const visited = new Set();
  let current = site;
  while (current && !visited.has(current)) {
    visited.add(current);
    const parentRow = getParentRow(rows, current);
    if (!parentRow) break;
    const parentSite = sourceOf(parentRow);
    chain.unshift({
      site: parentSite,
      label: getSourceLabel(rows, parentSite) || parentSite,
    });
    current = parentSite;
  }
  return chain;
}

/** Nested linked-site tree (direct children at each level) for the publish UI. */
export function buildDescendantTree(rows, rootSite, visited = new Set()) {
  if (!rows?.length || visited.has(rootSite)) return [];
  visited.add(rootSite);
  return getDirectChildren(rows, rootSite).map((child) => ({
    site: child.site,
    label: child.label,
    children: buildDescendantTree(rows, child.site, new Set(visited)),
  }));
}

// Dialog-facing tree shape: uses `siteId` field (matches plugin/msm/msm.js usage).
function buildDialogTree(rows, siteId) {
  return getDirectChildren(rows, siteId).map((child) => ({
    siteId: child.site,
    label: child.label,
    children: buildDialogTree(rows, child.site),
  }));
}

export function getSourceChain(config, site) {
  return walkChain(config?.rows || [], site);
}

export function getSiteRoles(config, site) {
  const rows = config?.rows || [];
  const children = getDirectChildren(rows, site);
  const parentRow = getParentRow(rows, site);
  const result = {};
  if (children.length) {
    const linked = children.reduce((acc, child) => {
      acc[child.site] = {
        label: child.label,
        descendantCount: walkSubtree(rows, child.site).length,
        descendants: buildDescendantTree(rows, child.site),
      };
      return acc;
    }, {});
    result.asSource = { sourceLabel: getSourceLabel(rows, site), linked };
  }
  if (parentRow) {
    const parentSite = sourceOf(parentRow);
    result.asLinked = {
      source: parentSite,
      sourceLabel: getSourceLabel(rows, parentSite) || parentSite,
      chain: walkChain(rows, site),
    };
  }
  return result;
}

// ──────────────────────────────────────────────
// Derived config shapes
// ──────────────────────────────────────────────

function resolveSourceSites(rows) {
  if (!hasGraphCols(rows)) return [];

  const sourceSites = rows
    .filter((row) => sourceOf(row))
    .reduce((acc, row) => {
      const source = sourceOf(row);
      const linked = linkedOf(row);
      if (!acc.has(source)) {
        acc.set(source, { site: source, label: '', linked: {} });
      }
      const entry = acc.get(source);
      if (!linked) entry.label = row.title || source;
      else entry.linked[linked] = { label: row.title || linked };
      return acc;
    }, new Map());

  return [...sourceSites.values()].filter((b) => Object.keys(b.linked).length > 0);
}

/** App-facing config: `{ sourceSites, rows }`, cached per org. */
export async function fetchMsmConfig(org) {
  if (msmConfigCache[org]) return msmConfigCache[org];
  const rows = await fetchOrgMsmRows(org);
  if (!rows.length) return null;
  const sourceSites = resolveSourceSites(rows);
  if (!sourceSites.length) return null;
  const config = { sourceSites, rows };
  msmConfigCache[org] = config;
  return config;
}

// Flat, de-duplicated list of every site referenced in the org's MSM config —
// both sources and linked sites. Each entry carries its link `level`
// (0 = root source, 1 = its direct linked sites, …).
//
// Ordering is breadth-first but grouped under parents: all of one level before
// the next, and within a level the sites are ordered by their parent's order
// in the level above. e.g. global / apac,eu,na / india,japan,france,uk,canada,us.
// Achieved by giving each site a path of sibling-indices from its root and
// sorting by (level, path).
export function getAllMsmSites(config) {
  const rows = config?.rows || [];
  const map = new Map();
  const add = (site, label) => {
    if (!site) return;
    const existing = map.get(site);
    if (!existing) map.set(site, { site, label: label || site });
    else if (label && existing.label === site) existing.label = label;
  };
  rows.forEach((row) => {
    const source = sourceOf(row);
    const linked = linkedOf(row);
    if (source && !linked) add(source, row.title);
    if (source && linked) {
      add(source);
      add(linked, row.title);
    }
  });

  const paths = new Map();
  const visited = new Set();
  const assign = (site, prefix) => {
    if (visited.has(site)) return;
    visited.add(site);
    paths.set(site, prefix);
    getDirectChildren(rows, site)
      .sort((a, b) => a.label.localeCompare(b.label))
      .forEach((child, i) => assign(child.site, [...prefix, i]));
  };
  [...map.values()]
    .filter((s) => !getParentRow(rows, s.site))
    .sort((a, b) => a.label.localeCompare(b.label))
    .forEach((root, i) => assign(root.site, [i]));

  const comparePath = (a, b) => {
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i += 1) {
      if (a[i] !== b[i]) return a[i] - b[i];
    }
    return a.length - b.length;
  };
  const orphan = [Number.MAX_SAFE_INTEGER];

  return [...map.values()]
    .map((s) => ({ ...s, level: (paths.get(s.site) || orphan).length - 1 }))
    .sort((a, b) => (a.level - b.level)
      || comparePath(paths.get(a.site) || orphan, paths.get(b.site) || orphan));
}

// ──────────────────────────────────────────────
// Dialog-facing config: `{ asSource, asLinked }`
// ──────────────────────────────────────────────

function resolveConfig(rows, site) {
  if (!rows.length || !hasGraphCols(rows)) return null;
  const directChildren = getDirectChildren(rows, site);
  const parentRow = getParentRow(rows, site);
  if (!directChildren.length && !parentRow) return null;

  const result = {};
  if (directChildren.length) {
    const linked = directChildren.reduce((acc, child) => {
      acc[child.site] = {
        label: child.label,
        descendantCount: walkSubtree(rows, child.site).length,
      };
      return acc;
    }, {});
    result.asSource = { sourceLabel: getSourceLabel(rows, site), linked };
  }
  if (parentRow) {
    const parentSite = sourceOf(parentRow);
    result.asLinked = {
      source: parentSite,
      sourceLabel: getSourceLabel(rows, parentSite) || parentSite,
      chain: walkChain(rows, site),
    };
  }
  return result;
}

async function fetchSiteConfig(org, site) {
  const key = `${org}/${site}`;
  if (siteConfigCache[key]) return siteConfigCache[key];
  const rows = await fetchOrgMsmRows(org);
  if (!rows.length) return null;
  const config = resolveConfig(rows, site);
  if (!config) return null;
  siteConfigCache[key] = { config, rows };
  return siteConfigCache[key];
}

export async function getSiteConfig(org, site) {
  const entry = await fetchSiteConfig(org, site);
  return entry?.config || null;
}

export async function getLinkedTree(org, site) {
  const entry = await fetchSiteConfig(org, site);
  if (!entry) return [];
  return buildDialogTree(entry.rows, site);
}

export async function getSubtreeLinked(org, sourceSite) {
  const entry = await fetchSiteConfig(org, sourceSite);
  if (!entry) return [];
  return walkSubtree(entry.rows, sourceSite);
}

export async function getLinkedSites(org, sourceSite) {
  const config = await getSiteConfig(org, sourceSite);
  return config?.asSource?.linked || {};
}

export async function getSourceSite(org, site) {
  const config = await getSiteConfig(org, site);
  return config?.asLinked?.source || null;
}
