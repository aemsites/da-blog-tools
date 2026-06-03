/* eslint-disable no-underscore-dangle, import/no-unresolved, no-console */

// App-facing API surface. Shared MSM behavior lives in ../core and is
// re-exported here; this file adds only app-specific concerns (folder
// browsing, bulk execution) that the dialog doesn't need.

import { daFetch, DA_ORIGIN } from '../core/fetch.js';
import { getSourceChain } from '../core/config.js';
import {
  previewPage,
  publishPage,
  copyFromSource,
  deleteCopy,
  mergeFromSource,
} from '../core/operations.js';
import { getPageStatus } from '../core/status.js';

export {
  fetchMsmConfig,
  getAllMsmSites,
  getSiteRoles,
} from '../core/config.js';
export {
  previewPage,
  publishPage,
  copyFromSource,
  deleteCopy,
  mergeFromSource,
} from '../core/operations.js';
export { getPageStatus, getStatusConfig, getPageTimestamp } from '../core/status.js';
export { PUBLISH_LAG_MS } from '../core/fetch.js';

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

// Lists a folder for a linked site and merges in inherited entries from the
// source chain. Adds these fields to every item:
//   - sourceSite         : where the file actually lives (current site or ancestor)
//   - linkedFrom         : null when it's a local copy, ancestor site name when linked
//   - shadowsSource      : true iff the path exists locally AND in an ancestor
//   - sourceLastModified : nearest ancestor's lastModified (when it shadows one), so
//                          callers can compute behind-source without extra requests
// Closest-source-wins: the level nearest the current site decides the source.
export async function listFolderWithInheritance(org, site, path, msmConfig) {
  const chain = msmConfig ? getSourceChain(msmConfig, site) : [];
  if (!chain.length) {
    const items = await listFolder(org, site, path);
    return items.map((i) => ({
      ...i, sourceSite: site, linkedFrom: null, shadowsSource: false, sourceLastModified: null,
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
      const shadowsSource = isLocal
        && lists.slice(1).some((arr) => arr.some((i) => i.path === item.path));
      seen.set(item.path, {
        ...item,
        site,
        sourceSite: node.site,
        linkedFrom: isLocal ? null : node.site,
        shadowsSource,
        sourceLastModified: shadowsSource ? ancestorLM(item.path) : null,
      });
    });
  });

  return [...seen.values()];
}

// ──────────────────────────────────────────────
// Bulk action executor
// ──────────────────────────────────────────────

export async function executeBulkAction({
  org, sourceSite, pages, targets, action, syncMode, onPageStatus,
}) {
  const targetEntries = Object.entries(targets);

  const tasks = pages.flatMap((page) => {
    const ext = getExtension(page.path) || 'html';
    const pagePath = stripExtension(page.path);

    targetEntries.forEach(([targetSite]) => onPageStatus?.(`${page.path}:${targetSite}`, 'queued'));

    return targetEntries.map(([targetSite]) => async () => {
      const key = `${page.path}:${targetSite}`;
      onPageStatus?.(key, 'pending');
      try {
        let result;
        switch (action) {
          case 'preview':
            result = await previewPage(org, targetSite, pagePath, ext);
            break;
          case 'publish': {
            // AEM requires a current preview before publishing to live.
            const pv = await previewPage(org, targetSite, pagePath, ext);
            result = pv?.error ? pv : await publishPage(org, targetSite, pagePath, ext);
            break;
          }
          case 'detach':
            result = await copyFromSource(org, sourceSite, targetSite, pagePath, ext);
            break;
          case 'sync':
            result = syncMode === 'merge'
              ? await mergeFromSource(org, sourceSite, targetSite, pagePath, ext)
              : await copyFromSource(org, sourceSite, targetSite, pagePath, ext);
            break;
          case 'reconnect': {
            const status = await getPageStatus(org, targetSite, pagePath, null, ext);
            result = await deleteCopy(org, targetSite, pagePath, ext);
            if (!result?.error) {
              if (status.liveState !== 'not-published') {
                await previewPage(org, targetSite, pagePath, ext);
                await publishPage(org, targetSite, pagePath, ext);
              } else if (status.previewState !== 'not-published') {
                await previewPage(org, targetSite, pagePath, ext);
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
