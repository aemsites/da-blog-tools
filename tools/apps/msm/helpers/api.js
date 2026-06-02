/* eslint-disable no-underscore-dangle, import/no-unresolved, no-console */

// App-facing API surface. Shared MSM behavior lives in ../core and is
// re-exported here; this file adds only app-specific concerns (folder
// browsing, bulk execution) that the dialog doesn't need.

import { daFetch, DA_ORIGIN } from '../core/fetch.js';
import { getInheritanceChain } from '../core/config.js';
import {
  previewSatellite,
  publishSatellite,
  createOverride,
  deleteOverride,
  mergeFromBase,
} from '../core/operations.js';
import { getPageStatus } from '../core/status.js';

export {
  fetchMsmConfig,
  getAllMsmSites,
  getSiteRoles,
  getInheritanceChain,
  getSubtreeSites,
  getDescendantCount,
  buildDescendantTree,
  expandSatellitesWithSubtree,
} from '../core/config.js';
export {
  previewSatellite,
  publishSatellite,
  createOverride,
  deleteOverride,
  mergeFromBase,
} from '../core/operations.js';
export { getPageStatus, getStatusConfig, getPageTimestamp } from '../core/status.js';

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
    if (executing.size >= limit) await Promise.race(executing);
  }
  return Promise.allSettled(results);
}
/* eslint-enable no-restricted-syntax, no-await-in-loop */

// ──────────────────────────────────────────────
// Folder listing via DA Admin (app-only)
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
    if (itemPath.startsWith(prefix)) itemPath = itemPath.substring(prefix.length) || '/';
    return {
      name: item.name,
      path: itemPath,
      ext: item.ext || (item.name.includes('.') ? item.name.split('.').pop() : null),
      isFolder: !item.ext && !item.name.includes('.'),
      lastModified: item.lastModified || null,
    };
  });
}

// Lists a folder for a satellite and merges in inherited entries from the
// ancestor chain. Adds these fields to every item:
//   - sourceSite       : where the file actually lives (current site or ancestor)
//   - inheritedFrom    : null when local, ancestor site name when inherited
//   - hasLocalOverride : true iff the path exists locally AND in an ancestor
//   - baseLastModified : nearest ancestor's lastModified (when overridden), so
//                        callers can compute out-of-sync without extra requests
// Closest-source-wins: the level nearest the current site decides the source.
export async function listFolderWithInheritance(org, site, path, msmConfig) {
  const chain = msmConfig ? getInheritanceChain(msmConfig, site) : [];
  if (!chain.length) {
    const items = await listFolder(org, site, path);
    return items.map((i) => ({
      ...i, sourceSite: site, inheritedFrom: null, hasLocalOverride: false, baseLastModified: null,
    }));
  }

  // walk[0] = self; walk[1..] = ancestors in nearest-first order.
  const walk = [{ site }, ...chain.slice().reverse()];
  const lists = await Promise.all(
    walk.map((node) => listFolder(org, node.site, path).catch(() => [])),
  );

  const ancestorLM = (itemPath) => {
    for (let i = 1; i < lists.length; i += 1) {
      const hit = lists[i].find((it) => it.path === itemPath);
      if (hit) return hit.lastModified || null;
    }
    return null;
  };

  const seen = new Map();
  lists.forEach((items, idx) => {
    const node = walk[idx];
    const isLocal = idx === 0;
    items.forEach((item) => {
      if (seen.has(item.path)) return;
      const hasLocalOverride = isLocal
        && lists.slice(1).some((arr) => arr.some((i) => i.path === item.path));
      seen.set(item.path, {
        ...item,
        site,
        sourceSite: node.site,
        inheritedFrom: isLocal ? null : node.site,
        hasLocalOverride,
        baseLastModified: hasLocalOverride ? ancestorLM(item.path) : null,
      });
    });
  });

  return [...seen.values()];
}

// ──────────────────────────────────────────────
// Override checking across satellites
// ──────────────────────────────────────────────

export async function checkPageOverrides(org, satellites, pagePath, ext = 'html') {
  const entries = Object.entries(satellites);
  return Promise.all(entries.map(async ([site, info]) => {
    const url = `${DA_ORIGIN}/source/${org}/${site}${pagePath}.${ext}`;
    const resp = await daFetch(url, { method: 'HEAD' });
    return { site, label: info.label, hasOverride: resp.ok };
  }));
}

// ──────────────────────────────────────────────
// Bulk action executor
// ──────────────────────────────────────────────

export async function executeBulkAction({
  org, baseSite, pages, satellites, action, syncMode, scope, overrides, onPageStatus, onSkipped,
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
      satEntries
        .filter(([s]) => !applicableSats.some(([a]) => a === s))
        .forEach(([s]) => onSkipped?.(page, s, scope));
    }

    applicableSats.forEach(([satSite]) => onPageStatus?.(`${page.path}:${satSite}`, 'queued'));

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
            const status = await getPageStatus(org, satSite, pagePath, null, ext);
            result = await deleteOverride(org, satSite, pagePath, ext);
            if (!result?.error) {
              if (status.liveState !== 'not-rolled-out') {
                await previewSatellite(org, satSite, pagePath, ext);
                await publishSatellite(org, satSite, pagePath, ext);
              } else if (status.previewState !== 'not-rolled-out') {
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
