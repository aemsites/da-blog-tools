/* eslint-disable import/no-unresolved */
import { daFetch, DA_ORIGIN } from './fetch.js';

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
    const resp = await daFetch(`${DA_ORIGIN}/config/${org}/`);
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
// Inheritance graph helpers (operate on raw rows)
// ──────────────────────────────────────────────

function getDirectChildren(rows, site) {
  return rows
    .filter((row) => row.base === site && row.satellite)
    .map((row) => ({ site: row.satellite, label: row.title || row.satellite }));
}

function getParentRow(rows, site) {
  return rows.find((row) => row.satellite === site);
}

function getBaseLabel(rows, site) {
  const labelRow = rows.find((row) => row.base === site && !row.satellite);
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
    chain.unshift({
      site: parentRow.base,
      label: getBaseLabel(rows, parentRow.base) || parentRow.base,
    });
    current = parentRow.base;
  }
  return chain;
}

/** Nested satellite tree (direct children at each level) for rollout UI. */
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

export function getInheritanceChain(config, site) {
  return walkChain(config?.rows || [], site);
}

export function getSubtreeSites(config, rootSite) {
  return walkSubtree(config?.rows || [], rootSite);
}

export function getDescendantCount(config, site) {
  return getSubtreeSites(config, site).length;
}

export function getSiteRoles(config, site) {
  const rows = config?.rows || [];
  const children = getDirectChildren(rows, site);
  const parentRow = getParentRow(rows, site);
  const result = {};
  if (children.length) {
    const satellites = children.reduce((acc, child) => {
      acc[child.site] = {
        label: child.label,
        descendantCount: walkSubtree(rows, child.site).length,
        descendants: buildDescendantTree(rows, child.site),
      };
      return acc;
    }, {});
    result.asBase = { baseLabel: getBaseLabel(rows, site), satellites };
  }
  if (parentRow) {
    result.asSatellite = {
      base: parentRow.base,
      baseLabel: getBaseLabel(rows, parentRow.base) || parentRow.base,
      chain: walkChain(rows, site),
    };
  }
  return result;
}

export function expandSatellitesWithSubtree(config, directSatellites) {
  if (!config || !directSatellites) return directSatellites || {};
  const expanded = { ...directSatellites };
  Object.keys(directSatellites).forEach((siteName) => {
    getSubtreeSites(config, siteName).forEach((node) => {
      if (!expanded[node.site]) expanded[node.site] = { label: node.label };
    });
  });
  return expanded;
}

// ──────────────────────────────────────────────
// Derived config shapes
// ──────────────────────────────────────────────

function resolveBaseSites(rows) {
  const hasBaseCol = rows.length > 0 && rows[0].base !== undefined;
  if (!hasBaseCol) return [];

  const baseSites = rows
    .filter((row) => row.base)
    .reduce((acc, row) => {
      if (!acc.has(row.base)) {
        acc.set(row.base, { site: row.base, label: '', satellites: {} });
      }
      const entry = acc.get(row.base);
      if (!row.satellite) entry.label = row.title || row.base;
      else entry.satellites[row.satellite] = { label: row.title || row.satellite };
      return acc;
    }, new Map());

  return [...baseSites.values()].filter((b) => Object.keys(b.satellites).length > 0);
}

/** App-facing config: `{ baseSites, rows }`, cached per org. */
export async function fetchMsmConfig(org) {
  if (msmConfigCache[org]) return msmConfigCache[org];
  const rows = await fetchOrgMsmRows(org);
  if (!rows.length) return null;
  const baseSites = resolveBaseSites(rows);
  if (!baseSites.length) return null;
  const config = { baseSites, rows };
  msmConfigCache[org] = config;
  return config;
}

// Flat, de-duplicated list of every site referenced in the org's MSM config —
// both sources (bases) and targets (satellites). Each entry carries its
// inheritance `level` (0 = root source, 1 = its direct satellites, …).
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
    if (row.base && !row.satellite) add(row.base, row.title);
    if (row.base && row.satellite) {
      add(row.base);
      add(row.satellite, row.title);
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
// Dialog-facing config: `{ asBase, asSatellite }`
// ──────────────────────────────────────────────

function resolveConfig(rows, site) {
  if (!rows.length || rows[0].base === undefined) return null;
  const directChildren = getDirectChildren(rows, site);
  const parentRow = getParentRow(rows, site);
  if (!directChildren.length && !parentRow) return null;

  const result = {};
  if (directChildren.length) {
    const satellites = directChildren.reduce((acc, child) => {
      acc[child.site] = {
        label: child.label,
        descendantCount: walkSubtree(rows, child.site).length,
      };
      return acc;
    }, {});
    result.asBase = { baseLabel: getBaseLabel(rows, site), satellites };
  }
  if (parentRow) {
    result.asSatellite = {
      base: parentRow.base,
      baseLabel: getBaseLabel(rows, parentRow.base) || parentRow.base,
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

export async function getSatelliteTree(org, site) {
  const entry = await fetchSiteConfig(org, site);
  if (!entry) return [];
  return buildDialogTree(entry.rows, site);
}

export async function getSubtreeSatellites(org, baseSite) {
  const entry = await fetchSiteConfig(org, baseSite);
  if (!entry) return [];
  return walkSubtree(entry.rows, baseSite);
}

export async function getSatellites(org, baseSite) {
  const config = await getSiteConfig(org, baseSite);
  return config?.asBase?.satellites || {};
}

export async function getBaseSite(org, satellite) {
  const config = await getSiteConfig(org, satellite);
  return config?.asSatellite?.base || null;
}
