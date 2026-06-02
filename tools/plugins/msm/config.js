/* eslint-disable import/no-unresolved */
import { DA_ORIGIN } from 'https://da.live/nx/public/utils/constants.js';

let sdkFetch;
export function setSdkFetch(fn) { sdkFetch = fn; }
function daFetch(url, opts) {
  if (!sdkFetch) throw new Error('MSM plugin: SDK daFetch not initialised');
  return sdkFetch(url, opts);
}

const configCache = {};
const orgConfigPromises = {};

function fetchOrgConfig(org) {
  if (!org) return Promise.resolve(null);
  orgConfigPromises[org] ??= (async () => {
    const url = `${DA_ORIGIN}/config/${org}/`;
    const resp = await daFetch(url);
    if (!resp.ok) return null;
    const json = await resp.json();
    return json;
  })();
  return orgConfigPromises[org];
}

async function fetchOrgMsmRows(org) {
  const orgConfig = await fetchOrgConfig(org);
  const rows = orgConfig?.msm?.data || [];
  return rows;
}

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
  const children = getDirectChildren(rows, rootSite);
  return children.flatMap((child) => [
    child,
    ...walkSubtree(rows, child.site, visited),
  ]);
}

function walkChain(rows, site, visited = new Set()) {
  const chain = [];
  let current = site;
  while (current && !visited.has(current)) {
    visited.add(current);
    const parentRow = getParentRow(rows, current);
    if (!parentRow) break;
    const baseLabel = getBaseLabel(rows, parentRow.base) || parentRow.base;
    chain.unshift({ site: parentRow.base, label: baseLabel });
    current = parentRow.base;
  }
  return chain;
}

function resolveConfig(rows, site) {
  if (!rows.length || rows[0].base === undefined) return null;

  const directChildren = getDirectChildren(rows, site);
  const parentRow = getParentRow(rows, site);

  if (!directChildren.length && !parentRow) return null;

  const result = {};

  if (directChildren.length) {
    const satellites = directChildren.reduce((acc, child) => {
      const subtree = walkSubtree(rows, child.site);
      acc[child.site] = {
        label: child.label,
        descendantCount: subtree.length,
      };
      return acc;
    }, {});
    result.asBase = {
      baseLabel: getBaseLabel(rows, site),
      satellites,
    };
  }

  if (parentRow) {
    const chain = walkChain(rows, site);
    result.asSatellite = {
      base: parentRow.base,
      baseLabel: getBaseLabel(rows, parentRow.base) || parentRow.base,
      chain,
    };
  }

  return result;
}

async function fetchSiteConfig(org, site) {
  const key = `${org}/${site}`;
  if (configCache[key]) return configCache[key];

  const rows = await fetchOrgMsmRows(org);
  if (!rows.length) {
    return null;
  }

  const config = resolveConfig(rows, site);
  if (!config) {
    return null;
  }

  configCache[key] = { config, rows };
  return configCache[key];
}

export async function getSiteConfig(org, site) {
  const entry = await fetchSiteConfig(org, site);
  return entry?.config || null;
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

function buildTree(rows, siteId) {
  const children = getDirectChildren(rows, siteId);
  return children.map((child) => ({
    siteId: child.site,
    label: child.label,
    children: buildTree(rows, child.site),
  }));
}

export async function getSatelliteTree(org, site) {
  const entry = await fetchSiteConfig(org, site);
  if (!entry) return [];
  return buildTree(entry.rows, site);
}

export async function getBaseSite(org, satellite) {
  const config = await getSiteConfig(org, satellite);
  return config?.asSatellite?.base || null;
}

export async function getPageTimestamp(org, site, pagePath) {
  const resp = await daFetch(
    `${DA_ORIGIN}/source/${org}/${site}${pagePath}.html`,
    { method: 'HEAD', cache: 'no-store' },
  );
  return { exists: resp.ok, lastModified: resp.headers?.get('Last-Modified') || null };
}

export async function isPageLocal(org, site, pagePath) {
  const { exists } = await getPageTimestamp(org, site, pagePath);
  return exists;
}

export async function checkOverrides(org, baseSite, satellites, pagePath) {
  const entries = Object.entries(satellites);
  const [baseTs, ...satResults] = await Promise.all([
    getPageTimestamp(org, baseSite, pagePath),
    ...entries.map(async ([site, info]) => {
      const ts = await getPageTimestamp(org, site, pagePath);
      return { site, info, ts };
    }),
  ]);

  const baseTime = baseTs.lastModified ? new Date(baseTs.lastModified).getTime() : null;

  return satResults.map(({ site, info, ts }) => {
    const satTime = ts.lastModified ? new Date(ts.lastModified).getTime() : null;
    const outOfSync = ts.exists && baseTime !== null && satTime !== null
      ? satTime < baseTime
      : false;
    return {
      site,
      label: info.label,
      descendantCount: info.descendantCount || 0,
      hasOverride: ts.exists,
      outOfSync,
    };
  });
}

export function clearMsmCache() {
  Object.keys(configCache).forEach((key) => { delete configCache[key]; });
  Object.keys(orgConfigPromises).forEach((key) => { delete orgConfigPromises[key]; });
}
