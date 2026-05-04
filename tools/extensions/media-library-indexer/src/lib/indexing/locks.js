/**
 * Lock Management
 * Copied from da-nx/nx/blocks/media-library/indexing/locks.js
 * Adapted for Chrome extension service worker context
 */

import { daFetch, DA_ORIGIN } from '../../adapters/fetch-adapter.js';

const LOCK_HEARTBEAT_INTERVAL_MS = 60_000; // 60s
const LOCK_STALE_THRESHOLD_MS = 600_000;   // 10min

// In-memory lock owner ID (replaces sessionStorage in browser context)
let lockOwnerId = null;

/**
 * Get or create lock owner ID
 * @returns {string} - Unique owner ID for this service worker instance
 */
function getLockOwnerId() {
  if (!lockOwnerId) {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 10);
    lockOwnerId = `ml-${timestamp}-${random}`;
  }
  return lockOwnerId;
}

/**
 * Check if lock is fresh (updated within threshold)
 * @param {object} lock - Lock object
 * @param {number} now - Current timestamp
 * @returns {boolean} - True if lock is fresh
 */
export function isFreshIndexLock(lock, now = Date.now()) {
  if (!lock || !lock.lastUpdated) return false;
  return (now - lock.lastUpdated) < LOCK_STALE_THRESHOLD_MS;
}

/**
 * Check if index lock exists
 * Copied from da-nx locks.js::checkIndexLock
 *
 * @param {string} sitePath - Site path (e.g., '/org/repo')
 * @param {string} org - Organization
 * @param {string} repo - Repository
 * @returns {Promise<object>} - Lock object or {exists: false}
 */
export async function checkIndexLock(sitePath, org, repo) {
  try {
    const lockPath = `${sitePath}/.da/media-insights/index-lock.json`;
    const resp = await daFetch(`${DA_ORIGIN}/source${lockPath}`, org, repo);

    if (!resp.ok) {
      return { exists: false };
    }

    const result = await resp.json();
    const lock = result.data?.[0] || result;

    if (!lock || !lock.locked) {
      return { exists: false };
    }

    return {
      exists: true,
      ownerId: lock.ownerId,
      timestamp: lock.timestamp,
      startedAt: lock.startedAt,
      lastUpdated: lock.lastUpdated,
      locked: lock.locked
    };
  } catch (error) {
    console.error('[locks] Error checking lock:', error);
    return { exists: false };
  }
}

/**
 * Create index lock
 * Copied from da-nx locks.js::createIndexLock
 *
 * @param {string} sitePath - Site path
 * @param {string} org - Organization
 * @param {string} repo - Repository
 * @returns {Promise<object>} - Created lock object
 */
export async function createIndexLock(sitePath, org, repo) {
  const now = Date.now();
  const ownerId = getLockOwnerId();

  const lockData = {
    timestamp: now,
    startedAt: now,
    lastUpdated: now,
    ownerId,
    locked: true
  };

  // Create sheet with lock data
  const sheetData = {
    total: 1,
    limit: 1,
    offset: 0,
    data: [lockData],
    ':type': 'sheet'
  };

  const blob = new Blob([JSON.stringify(sheetData, null, 2)], {
    type: 'application/json'
  });

  const formData = new FormData();
  formData.append('data', blob);

  const lockPath = `${sitePath}/.da/media-insights/index-lock.json`;

  try {
    const resp = await daFetch(`${DA_ORIGIN}/source${lockPath}`, org, repo, {
      method: 'PUT',
      body: formData
    });

    if (!resp.ok) {
      throw new Error(`Failed to create lock: ${resp.status}`);
    }

    console.log('[locks] Created lock:', ownerId);
    return lockData;
  } catch (error) {
    console.error('[locks] Error creating lock:', error);
    throw error;
  }
}

/**
 * Refresh index lock (heartbeat)
 * Copied from da-nx locks.js::refreshIndexLock
 *
 * @param {string} sitePath - Site path
 * @param {object} lockData - Current lock data
 * @param {string} org - Organization
 * @param {string} repo - Repository
 * @returns {Promise<void>}
 */
export async function refreshIndexLock(sitePath, lockData, org, repo) {
  const updatedLock = {
    ...lockData,
    lastUpdated: Date.now()
  };

  const sheetData = {
    total: 1,
    limit: 1,
    offset: 0,
    data: [updatedLock],
    ':type': 'sheet'
  };

  const blob = new Blob([JSON.stringify(sheetData, null, 2)], {
    type: 'application/json'
  });

  const formData = new FormData();
  formData.append('data', blob);

  const lockPath = `${sitePath}/.da/media-insights/index-lock.json`;

  try {
    const resp = await daFetch(`${DA_ORIGIN}/source${lockPath}`, org, repo, {
      method: 'PUT',
      body: formData
    });

    if (!resp.ok) {
      throw new Error(`Failed to refresh lock: ${resp.status}`);
    }

    console.log('[locks] Refreshed lock');
  } catch (error) {
    console.error('[locks] Error refreshing lock:', error);
    throw error;
  }
}

/**
 * Remove index lock
 * Copied from da-nx locks.js::removeIndexLock
 *
 * @param {string} sitePath - Site path
 * @param {string} org - Organization
 * @param {string} repo - Repository
 * @returns {Promise<void>}
 */
export async function removeIndexLock(sitePath, org, repo) {
  const lockPath = `${sitePath}/.da/media-insights/index-lock.json`;

  try {
    const resp = await daFetch(`${DA_ORIGIN}/source${lockPath}`, org, repo, {
      method: 'DELETE'
    });

    if (!resp.ok && resp.status !== 404) {
      throw new Error(`Failed to remove lock: ${resp.status}`);
    }

    console.log('[locks] Removed lock');
  } catch (error) {
    console.error('[locks] Error removing lock:', error);
    throw error;
  }
}

// Export for testing
export { getLockOwnerId, LOCK_HEARTBEAT_INTERVAL_MS, LOCK_STALE_THRESHOLD_MS };
