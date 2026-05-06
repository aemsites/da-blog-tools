/**
 * Index Status - Worker-safe wrapper for da-nx index-status.js
 * Imports constants from da.live CDN, uses worker-safe fetch adapter
 *
 * Based on: https://da.live/nx/blocks/media-library/indexing/index-status.js
 */

import { IndexConfig, IndexFiles } from 'https://da.live/nx/blocks/media-library/core/constants.js';
import { getImsToken } from '../../adapters/auth-adapter.js';

// Import constants directly from da.live CDN (pure, no dependencies)

const DA_ORIGIN = 'https://admin.da.live';
const INDEX_SCHEMA_VERSION = 2;

/**
 * Worker-safe loadSheetMeta
 * Extracted from worker fetch.js:242-257
 */
async function loadSheetMeta(path, org, repo) {
  const imsToken = await getImsToken(org, repo);
  if (!imsToken) {
    return null;
  }

  try {
    const resp = await fetch(`${DA_ORIGIN}/source${path}`, {
      headers: {
        Authorization: `Bearer ${imsToken}`,
      },
    });

    if (resp.ok) {
      const data = await resp.json();
      const metaData = data.data || data || null;
      if (Array.isArray(metaData) && metaData.length > 0) {
        return metaData[0];
      }
      return metaData;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Worker-safe loadIndexMeta
 * Uses IndexFiles constant from da-nx
 */
export async function loadIndexMeta(sitePath, org, repo) {
  const metaPath = `${sitePath}/${IndexFiles.FOLDER}/${IndexFiles.MEDIA_INDEX_META}`;
  return loadSheetMeta(metaPath, org, repo);
}

/**
 * Get index status
 * From da-nx index-status.js:24-38 (verbatim logic, simplified without checkIndex call)
 */
export async function getIndexStatus(sitePath, org, repo) {
  const meta = await loadIndexMeta(sitePath, org, repo);

  return {
    lastRefresh: meta?.lastFetchTime || null,
    entriesCount: meta?.entriesCount || 0,
    lastBuildMode: meta?.lastBuildMode || null,
    schemaVersion: meta?.schemaVersion || null,
    chunkCount: meta?.chunkCount || 0,
    indexExists: !!meta,
  };
}

/**
 * Determine if full rebuild is needed
 * Based on da-nx index-status.js:checkReindexEligibility + incremental.js logic
 *
 * Decision logic matches da-nx:
 * - No meta?.lastFetchTime → Full build required
 * - Schema mismatch → Full build required
 * - Otherwise → Can use incremental
 */
export async function determineIndexMode(sitePath, org, repo) {
  const meta = await loadIndexMeta(sitePath, org, repo);

  // From incremental.js:108-111 - No lastFetchTime = cannot run incremental
  if (!meta?.lastFetchTime) {
    return {
      needsFullBuild: true,
      reason: 'Cannot run incremental: meta missing lastFetchTime',
      canUseIncremental: false,
      lastFetchTime: null,
    };
  }

  // From incremental.js:113-115 - Schema version mismatch = full rebuild required
  if (meta.schemaVersion && meta.schemaVersion !== INDEX_SCHEMA_VERSION) {
    return {
      needsFullBuild: true,
      reason: `Index schema version mismatch: expected ${INDEX_SCHEMA_VERSION}, found ${meta.schemaVersion}. Full rebuild required.`,
      canUseIncremental: false,
      lastFetchTime: null,
    };
  }

  // Index exists with valid schema = can use incremental
  return {
    needsFullBuild: false,
    reason: 'Index exists with valid schema',
    canUseIncremental: true,
    lastFetchTime: meta.lastFetchTime,
  };
}

// Export constants for use elsewhere
export { IndexConfig, IndexFiles };
