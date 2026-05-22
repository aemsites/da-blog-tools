/* eslint-disable no-underscore-dangle, import/no-unresolved, no-console */

const DA_ORIGIN = 'https://admin.da.live';
const AEM_ADMIN = 'https://admin.hlx.page';
const MAX_CONCURRENT = 5;

export const ACTIONABLE_EXTENSIONS = new Set(['html', 'json', 'svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf']);

export function isActionableItem(item) {
  return !item.isFolder && !item.isSite && ACTIONABLE_EXTENSIONS.has(item.ext);
}

function stripExtension(filePath) {
  return filePath.replace(/\.[^/.]+$/, '');
}

function getExtension(filePath) {
  const match = filePath.match(/\.([^/.]+)$/);
  return match ? match[1] : '';
}

let daFetchFn;

async function ensureDaFetch() {
  if (!daFetchFn) {
    const { daFetch: fn } = await import('https://da.live/nx/utils/daFetch.js');
    daFetchFn = fn;
  }
}

async function daFetch(url, opts = {}) {
  await ensureDaFetch();
  return daFetchFn(url, opts);
}

// ──────────────────────────────────────────────
// Concurrency limiter for bulk operations
// ──────────────────────────────────────────────

/* eslint-disable no-restricted-syntax, no-await-in-loop */
async function runWithConcurrency(tasks, limit = MAX_CONCURRENT) {
  const results = [];
  const executing = new Set();

  for (const task of tasks) {
    const p = task().then((r) => { executing.delete(p); return r; });
    executing.add(p);
    results.push(p);
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  return Promise.allSettled(results);
}
/* eslint-enable no-restricted-syntax, no-await-in-loop */

// ──────────────────────────────────────────────
// MSM Config
// ──────────────────────────────────────────────

const configCache = {};

async function fetchOrgConfig(org) {
  if (configCache[org]) return configCache[org];
  const resp = await daFetch(`${DA_ORIGIN}/config/${org}/`);
  if (!resp.ok) return null;
  const json = await resp.json();
  configCache[org] = json;
  return json;
}

async function fetchOrgMsmRows(org) {
  const orgConfig = await fetchOrgConfig(org);
  return orgConfig?.msm?.data || [];
}

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
      if (!row.satellite) {
        entry.label = row.title || row.base;
      } else {
        entry.satellites[row.satellite] = { label: row.title || row.satellite };
      }
      return acc;
    }, new Map());

  return [...baseSites.values()].filter((b) => Object.keys(b.satellites).length > 0);
}

// ──────────────────────────────────────────────
// Multi-level inheritance helpers
// ──────────────────────────────────────────────

function getParentRow(rows, site) {
  return rows.find((row) => row.satellite === site);
}

function getBaseLabel(rows, site) {
  const labelRow = rows.find((row) => row.base === site && !row.satellite);
  return labelRow?.title;
}

function getDirectChildren(rows, site) {
  return rows
    .filter((row) => row.base === site && row.satellite)
    .map((row) => ({ site: row.satellite, label: row.title || row.satellite }));
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
    result.asBase = {
      baseLabel: getBaseLabel(rows, site),
      satellites,
    };
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
    const subtree = getSubtreeSites(config, siteName);
    subtree.forEach((node) => {
      if (!expanded[node.site]) {
        expanded[node.site] = { label: node.label };
      }
    });
  });
  return expanded;
}

export async function fetchMsmConfig(org) {
  if (configCache[org]) return configCache[org];

  const rows = await fetchOrgMsmRows(org);
  if (!rows.length) return null;

  const baseSites = resolveBaseSites(rows);
  if (!baseSites.length) return null;

  const config = { baseSites, rows };
  configCache[org] = config;
  return config;
}

// ──────────────────────────────────────────────
// Folder listing via DA Admin
// ──────────────────────────────────────────────

export async function listFolder(org, site, path = '/') {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const url = `${DA_ORIGIN}/list/${org}/${site}${cleanPath}`;
  const resp = await daFetch(url);
  if (!resp.ok) return [];
  const items = await resp.json();
  const prefix = `/${org}/${site}`;
  return items.map((item) => {
    let itemPath = item.path || `${cleanPath === '/' ? '' : cleanPath}/${item.name}`;
    if (itemPath.startsWith(prefix)) {
      itemPath = itemPath.substring(prefix.length) || '/';
    }
    return {
      name: item.name,
      path: itemPath,
      ext: item.ext || (item.name.includes('.') ? item.name.split('.').pop() : null),
      isFolder: !item.ext && !item.name.includes('.'),
    };
  });
}

// ──────────────────────────────────────────────
// Inheritance-aware folder listing
// ──────────────────────────────────────────────

// Lists a folder for a satellite site and merges in inherited entries from the
// ancestor chain. Returns the same item shape as `listFolder` with three extra
// fields on every item:
//   - sourceSite       : where the file actually lives (current site or an ancestor)
//   - inheritedFrom    : null when local, ancestor site name when inherited
//   - hasLocalOverride : true iff the path exists in both the current site AND
//                        in some ancestor (i.e. the local file overrides a base)
// Closest-source-wins: when an item exists at multiple levels, the level
// nearest to the current site (lowest in the chain) decides the source.
export async function listFolderWithInheritance(org, site, path, msmConfig) {
  const chain = msmConfig ? getInheritanceChain(msmConfig, site) : [];
  if (!chain.length) {
    const items = await listFolder(org, site, path);
    return items.map((i) => ({
      ...i,
      sourceSite: site,
      inheritedFrom: null,
      hasLocalOverride: false,
    }));
  }

  // walk[0] = self; walk[1..] = ancestors in nearest-first order.
  const walk = [{ site }, ...chain.slice().reverse()];
  const lists = await Promise.all(
    walk.map((node) => listFolder(org, node.site, path).catch(() => [])),
  );

  const seen = new Map();
  lists.forEach((items, idx) => {
    const node = walk[idx];
    const isLocal = idx === 0;
    items.forEach((item) => {
      if (seen.has(item.path)) return;
      seen.set(item.path, {
        ...item,
        site,
        sourceSite: node.site,
        inheritedFrom: isLocal ? null : node.site,
        hasLocalOverride: isLocal
          && lists.slice(1).some((arr) => arr.some((i) => i.path === item.path)),
      });
    });
  });

  return [...seen.values()];
}

// ──────────────────────────────────────────────
// Override checking
// ──────────────────────────────────────────────

export async function checkPageOverrides(org, satellites, pagePath, ext = 'html') {
  const entries = Object.entries(satellites);
  const results = await Promise.all(
    entries.map(async ([site, info]) => {
      const url = `${DA_ORIGIN}/source/${org}/${site}${pagePath}.${ext}`;
      const resp = await daFetch(url, { method: 'HEAD' });
      return { site, label: info.label, hasOverride: resp.ok };
    }),
  );
  return results;
}

// ──────────────────────────────────────────────
// Preview / Publish
// ──────────────────────────────────────────────

export async function previewSatellite(org, satellite, pagePath, ext = 'html') {
  const aemPath = ext === 'html' ? pagePath : `${pagePath}.${ext}`;
  const url = `${AEM_ADMIN}/preview/${org}/${satellite}/main${aemPath}`;
  const resp = await daFetch(url, { method: 'POST' });
  if (!resp.ok) {
    const xError = resp.headers?.get('x-error') || `Preview failed (${resp.status})`;
    return { error: xError };
  }
  return resp.json();
}

export async function publishSatellite(org, satellite, pagePath, ext = 'html') {
  const aemPath = ext === 'html' ? pagePath : `${pagePath}.${ext}`;
  const url = `${AEM_ADMIN}/live/${org}/${satellite}/main${aemPath}`;
  const resp = await daFetch(url, { method: 'POST' });
  if (!resp.ok) {
    const xError = resp.headers?.get('x-error') || `Publish failed (${resp.status})`;
    return { error: xError };
  }
  return resp.json();
}

// ──────────────────────────────────────────────
// Override management
// ──────────────────────────────────────────────

const EXT_MIME_TYPES = {
  html: 'text/html',
  json: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

export async function createOverride(org, baseSite, satellite, pagePath, ext = 'html') {
  const basePath = `${DA_ORIGIN}/source/${org}/${baseSite}${pagePath}.${ext}`;
  const resp = await daFetch(basePath);
  if (!resp.ok) return { error: `Failed to fetch base content (${resp.status})` };

  const content = await resp.blob();
  const mimeType = EXT_MIME_TYPES[ext] || 'application/octet-stream';
  const blob = new Blob([content], { type: mimeType });
  const formData = new FormData();
  formData.append('data', blob);

  const satPath = `${DA_ORIGIN}/source/${org}/${satellite}${pagePath}.${ext}`;
  const saveResp = await daFetch(satPath, { method: 'PUT', body: formData });
  if (!saveResp.ok) return { error: `Failed to create override (${saveResp.status})` };
  return { ok: true };
}

export async function deleteOverride(org, satellite, pagePath, ext = 'html') {
  const satPath = `${DA_ORIGIN}/source/${org}/${satellite}${pagePath}.${ext}`;
  const resp = await daFetch(satPath, { method: 'DELETE' });
  if (!resp.ok) return { error: `Failed to delete override (${resp.status})` };
  return { ok: true };
}

export async function getSatellitePageStatus(org, satellite, pagePath, ext = 'html') {
  const aemPath = ext === 'html' ? pagePath : `${pagePath}.${ext}`;
  const url = `${AEM_ADMIN}/status/${org}/${satellite}/main${aemPath}`;
  const resp = await daFetch(url);
  if (!resp.ok) return { preview: false, live: false };
  const json = await resp.json();
  return {
    preview: json.preview?.status === 200,
    live: json.live?.status === 200,
  };
}

// ──────────────────────────────────────────────
// Merge from base (uses NX mergeCopy)
// ──────────────────────────────────────────────

let mergeCopyFn;

async function ensureMergeCopy() {
  if (!mergeCopyFn) {
    const mod = await import('https://da.live/nx/blocks/loc/project/index.js');
    mergeCopyFn = mod.mergeCopy;
  }
  return mergeCopyFn;
}

export async function mergeFromBase(org, baseSite, satellite, pagePath, ext = 'html') {
  try {
    const mergeCopy = await ensureMergeCopy();
    const url = {
      source: `/${org}/${baseSite}${pagePath}.${ext}`,
      destination: `/${org}/${satellite}${pagePath}.${ext}`,
    };
    const result = await mergeCopy(url, 'MSM Merge');
    if (!result?.ok) return { error: 'Merge failed' };
    return { ok: true };
  } catch (e) {
    return { error: e.message || 'Merge failed' };
  }
}

// ──────────────────────────────────────────────
// Bulk action executors
// ──────────────────────────────────────────────

export async function executeBulkAction({
  org,
  baseSite,
  pages,
  satellites,
  action,
  syncMode,
  scope,
  overrides,
  onPageStatus,
  onSkipped,
}) {
  const satEntries = Object.entries(satellites);

  const tasks = pages.flatMap((page) => {
    const ext = getExtension(page.path) || 'html';
    const pagePath = stripExtension(page.path);
    const pageOverrides = overrides?.get(page.path) || [];

    const applicableSats = scope
      ? satEntries.filter(([satSite]) => {
        const ov = pageOverrides.find((o) => o.site === satSite);
        const hasOverride = ov?.hasOverride ?? false;
        return scope === 'custom' ? hasOverride : !hasOverride;
      })
      : satEntries;

    if (applicableSats.length < satEntries.length) {
      const skipped = satEntries
        .filter(([s]) => !applicableSats.some(([a]) => a === s))
        .map(([s]) => s);
      skipped.forEach((s) => onSkipped?.(page, s, scope));
    }

    applicableSats.forEach(([satSite]) => {
      onPageStatus?.(`${page.path}:${satSite}`, 'queued');
    });

    return applicableSats.map(([satSite]) => async () => {
      const key = `${page.path}:${satSite}`;
      onPageStatus?.(key, 'pending');

      try {
        let result;
        switch (action) {
          case 'preview':
            result = await previewSatellite(org, satSite, pagePath, ext);
            break;
          case 'publish':
            result = await publishSatellite(org, satSite, pagePath, ext);
            break;
          case 'break':
          case 'cancel-inheritance':
            // 'cancel-inheritance' is the upward (satellite-side) framing of
            // the same operation: materialize the inherited page locally,
            // breaking the inheritance link.
            result = await createOverride(org, baseSite, satSite, pagePath, ext);
            break;
          case 'sync':
          case 'sync-from-base':
            result = syncMode === 'merge'
              ? await mergeFromBase(org, baseSite, satSite, pagePath, ext)
              : await createOverride(org, baseSite, satSite, pagePath, ext);
            break;
          case 'reset':
          case 'resume-inheritance': {
            const pageStatus = await getSatellitePageStatus(org, satSite, pagePath, ext);
            result = await deleteOverride(org, satSite, pagePath, ext);
            if (!result?.error) {
              if (pageStatus.live) {
                await previewSatellite(org, satSite, pagePath, ext);
                await publishSatellite(org, satSite, pagePath, ext);
              } else if (pageStatus.preview) {
                await previewSatellite(org, satSite, pagePath, ext);
              }
            }
            break;
          }
          default:
            result = { error: `Unknown action: ${action}` };
        }

        onPageStatus?.(key, result?.error ? 'error' : 'success', result?.error);
        return { key, status: result?.error ? 'error' : 'success', error: result?.error };
      } catch (e) {
        onPageStatus?.(key, 'error', e.message);
        return { key, status: 'error', error: e.message };
      }
    });
  });

  return runWithConcurrency(tasks, MAX_CONCURRENT);
}
