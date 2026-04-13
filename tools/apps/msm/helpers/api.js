/* eslint-disable no-underscore-dangle, import/no-unresolved, no-console */

const DA_ORIGIN = 'https://admin.da.live';
const AEM_ADMIN = 'https://admin.hlx.page';
const MAX_CONCURRENT = 5;

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

export async function fetchMsmConfig(org) {
  if (configCache[org]) return configCache[org];

  const rows = await fetchOrgMsmRows(org);
  if (!rows.length) return null;

  const baseSites = resolveBaseSites(rows);
  if (!baseSites.length) return null;

  const config = { baseSites };
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
// Override checking
// ──────────────────────────────────────────────

export async function checkPageOverrides(org, satellites, pagePath) {
  const entries = Object.entries(satellites);
  const results = await Promise.all(
    entries.map(async ([site, info]) => {
      const url = `${DA_ORIGIN}/source/${org}/${site}${pagePath}.html`;
      const resp = await daFetch(url, { method: 'HEAD' });
      return { site, label: info.label, hasOverride: resp.ok };
    }),
  );
  return results;
}

// ──────────────────────────────────────────────
// Preview / Publish
// ──────────────────────────────────────────────

export async function previewSatellite(org, satellite, pagePath) {
  const aemPath = pagePath.replace(/\.html$/, '');
  const url = `${AEM_ADMIN}/preview/${org}/${satellite}/main${aemPath}`;
  const resp = await daFetch(url, { method: 'POST' });
  if (!resp.ok) {
    const xError = resp.headers?.get('x-error') || `Preview failed (${resp.status})`;
    return { error: xError };
  }
  return resp.json();
}

export async function publishSatellite(org, satellite, pagePath) {
  const aemPath = pagePath.replace(/\.html$/, '');
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

export async function createOverride(org, baseSite, satellite, pagePath) {
  const basePath = `${DA_ORIGIN}/source/${org}/${baseSite}${pagePath}.html`;
  const resp = await daFetch(basePath);
  if (!resp.ok) return { error: `Failed to fetch base content (${resp.status})` };

  const content = await resp.text();
  const blob = new Blob([content], { type: 'text/html' });
  const formData = new FormData();
  formData.append('data', blob);

  const satPath = `${DA_ORIGIN}/source/${org}/${satellite}${pagePath}.html`;
  const saveResp = await daFetch(satPath, { method: 'PUT', body: formData });
  if (!saveResp.ok) return { error: `Failed to create override (${saveResp.status})` };
  return { ok: true };
}

export async function deleteOverride(org, satellite, pagePath) {
  const satPath = `${DA_ORIGIN}/source/${org}/${satellite}${pagePath}.html`;
  const resp = await daFetch(satPath, { method: 'DELETE' });
  if (!resp.ok) return { error: `Failed to delete override (${resp.status})` };
  return { ok: true };
}

export async function getSatellitePageStatus(org, satellite, pagePath) {
  const aemPath = pagePath.replace(/\.html$/, '');
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

export async function mergeFromBase(org, baseSite, satellite, pagePath) {
  try {
    const mergeCopy = await ensureMergeCopy();
    const url = {
      source: `/${org}/${baseSite}${pagePath}.html`,
      destination: `/${org}/${satellite}${pagePath}.html`,
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
    const pagePath = page.path.replace(/\.html$/, '');
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

    return applicableSats.map(([satSite]) => async () => {
      const key = `${page.path}:${satSite}`;
      onPageStatus?.(key, 'pending');

      try {
        let result;
        switch (action) {
          case 'preview':
            result = await previewSatellite(org, satSite, pagePath);
            break;
          case 'publish':
            result = await publishSatellite(org, satSite, pagePath);
            break;
          case 'break':
            result = await createOverride(org, baseSite, satSite, pagePath);
            break;
          case 'sync':
            result = syncMode === 'merge'
              ? await mergeFromBase(org, baseSite, satSite, pagePath)
              : await createOverride(org, baseSite, satSite, pagePath);
            break;
          case 'reset': {
            const pageStatus = await getSatellitePageStatus(org, satSite, pagePath);
            result = await deleteOverride(org, satSite, pagePath);
            if (!result?.error) {
              if (pageStatus.live) {
                await previewSatellite(org, satSite, pagePath);
                await publishSatellite(org, satSite, pagePath);
              } else if (pageStatus.preview) {
                await previewSatellite(org, satSite, pagePath);
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
