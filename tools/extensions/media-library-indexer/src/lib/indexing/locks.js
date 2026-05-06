/**
 * Lock Management - Worker-safe version
 * Imports lock logic from da.live CDN, adapted for Chrome extension service worker
 *
 * Based on: https://da.live/nx/blocks/media-library/indexing/locks.js
 */

import { IndexConfig, IndexFiles } from 'https://da.live/nx/blocks/media-library/core/constants.js';
import { getImsToken } from '../../adapters/auth-adapter.js';

// Import constants directly from da.live CDN (pure, no dependencies)

const DA_ORIGIN = 'https://admin.da.live';
const { LOCK_STALE_THRESHOLD_MS } = IndexConfig;

// In-memory lock owner ID (replaces window.sessionStorage)
let lockOwnerId = null;

/**
 * Worker-safe createSheet - extracted from admin-api.js
 * Creates FormData with sheet metadata format
 */
function createSheet(data, type = 'sheet') {
  const sheetMeta = {
    total: data.length,
    limit: data.length,
    offset: 0,
    data,
    ':type': type,
  };
  const blob = new Blob([JSON.stringify(sheetMeta, null, 2)], { type: 'application/json' });
  const formData = new FormData();
  formData.append('data', blob);
  return formData;
}

/**
 * Worker-safe daFetch - uses IMS token from auth-adapter
 */
async function workerDaFetch(url, org, repo, options = {}) {
  const imsToken = await getImsToken(org, repo);

  if (!imsToken) {
    throw new Error('[locks] No IMS token available');
  }

  const headers = options.headers || {};
  headers.Authorization = `Bearer ${imsToken}`;

  const resp = await fetch(url, {
    ...options,
    headers,
  });

  return resp;
}

/**
 * Get media library folder path
 * From locks.js:16-18
 */
function getMediaLibraryPath(sitePath) {
  return `${sitePath}/${IndexFiles.FOLDER}`;
}

/**
 * Get index lock file path
 * From locks.js:20-22
 */
export function getIndexLockPath(sitePath) {
  return `${getMediaLibraryPath(sitePath)}/${IndexFiles.INDEX_LOCK}`;
}

/**
 * Get or create lock owner ID
 * From locks.js:70-78 (adapted for service worker - no sessionStorage)
 */
export function getIndexLockOwnerId() {
  if (!lockOwnerId) {
    lockOwnerId = `ml-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
  return lockOwnerId;
}

/**
 * Check if lock is fresh (< 10 min old)
 * From locks.js:63-68
 */
export function isFreshIndexLock(lock, now = Date.now()) {
  if (!(lock?.exists && lock?.locked)) return false;
  const heartbeat = lock.lastUpdated || lock.timestamp || lock.startedAt;
  if (!heartbeat) return false;
  return (now - heartbeat) < LOCK_STALE_THRESHOLD_MS;
}

/**
 * Check if index lock exists
 * From locks.js:24-61
 */
export async function checkIndexLock(sitePath, org, repo) {
  const path = getIndexLockPath(sitePath);
  try {
    const resp = await workerDaFetch(`${DA_ORIGIN}/source${path}`, org, repo);
    if (resp.ok) {
      const data = await resp.json();
      const lockData = data.data?.[0] || data;
      return {
        exists: true,
        locked: lockData.locked || false,
        timestamp: lockData.timestamp || null,
        startedAt: lockData.startedAt || lockData.timestamp || null,
        lastUpdated: lockData.lastUpdated || lockData.timestamp || null,
        ownerId: lockData.ownerId || '',
        mode: lockData.mode || '',
      };
    }
  } catch (e) {
    return {
      exists: false,
      locked: false,
      timestamp: null,
      startedAt: null,
      lastUpdated: null,
      ownerId: '',
      mode: '',
    };
  }
  return {
    exists: false,
    locked: false,
    timestamp: null,
    startedAt: null,
    lastUpdated: null,
    ownerId: '',
    mode: '',
  };
}

/**
 * Create index lock
 * From locks.js:81-104 (simplified error handling for worker)
 */
export async function createIndexLock(sitePath, org, repo, mode = 'full') {
  const path = getIndexLockPath(sitePath);
  const ownerId = getIndexLockOwnerId();
  const now = Date.now();
  const lockData = [{
    timestamp: now,
    startedAt: now,
    lastUpdated: now,
    ownerId,
    locked: true,
    mode,
  }];
  const formData = createSheet(lockData);
  const resp = await workerDaFetch(`${DA_ORIGIN}/source${path}`, org, repo, {
    method: 'PUT',
    body: formData,
  });
  if (!resp.ok) {
    let errorDetail = '';
    try {
      errorDetail = await resp.text();
    } catch (e) {
      errorDetail = 'Could not read error response';
    }
    throw new Error(`Failed to create lock: ${resp.status} ${resp.statusText} - ${errorDetail}`);
  }

  console.log(`[locks] Created lock: ${ownerId} (mode: ${mode})`);
  return resp;
}

/**
 * Refresh index lock (heartbeat)
 * From locks.js:106-128 (simplified error handling for worker)
 */
export async function refreshIndexLock(sitePath, lockData, org, repo) {
  const path = getIndexLockPath(sitePath);
  const now = Date.now();
  const formData = createSheet([{
    locked: true,
    timestamp: lockData.timestamp || lockData.startedAt || now,
    startedAt: lockData.startedAt || lockData.timestamp || now,
    lastUpdated: now,
    ownerId: lockData.ownerId || getIndexLockOwnerId(),
    mode: lockData.mode || '',
  }]);
  const resp = await workerDaFetch(`${DA_ORIGIN}/source${path}`, org, repo, {
    method: 'PUT',
    body: formData,
  });
  if (!resp.ok) {
    let errorDetail = '';
    try {
      errorDetail = await resp.text();
    } catch (e) {
      errorDetail = 'Could not read error response';
    }
    throw new Error(`Failed to refresh lock: ${resp.status} ${resp.statusText} - ${errorDetail}`);
  }

  console.log('[locks] Refreshed lock');
  return resp;
}

/**
 * Remove index lock
 * From locks.js:130-139
 */
export async function removeIndexLock(sitePath, org, repo) {
  const path = getIndexLockPath(sitePath);
  const resp = await workerDaFetch(`${DA_ORIGIN}/source${path}`, org, repo, { method: 'DELETE' });
  if (!resp.ok) {
    if (resp.status === 404) return resp;
    throw new Error(`Failed to remove lock: ${resp.status}`);
  }

  console.log('[locks] Removed lock');
  return resp;
}

// Export constants for testing
export { LOCK_STALE_THRESHOLD_MS };
