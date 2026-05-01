/**
 * Indexing Runner - Reuses existing indexing patterns
 *
 * This module implements the same logic as da-nx media library indexing,
 * but adapted for Chrome extension service worker context with our auth adapters.
 *
 * Core logic copied from:
 * - /nx/blocks/media-library/ui/data.js (loadMediaIfUpdated, loadMediaSheet)
 * - /nx/blocks/media-library/indexing/index-status.js (getIndexStatus)
 */

import { daFetch, DA_ORIGIN } from '../adapters/fetch-adapter.js';
import { getSite, updateSite } from '../adapters/storage-adapter.js';

const INDEX_FILES = {
  FOLDER: '.da/media-insights',
  MEDIA_INDEX: 'index.json',
  MEDIA_INDEX_META: 'index-meta.json',
};

const SHEET_NAMES = {
  MEDIA: 'media',
};

/**
 * List folder contents
 * Based on da-nx/nx/blocks/media-library/indexing/admin-api.js::listFolder
 *
 * @param {string} folderPath - Folder path
 * @param {string} org - Organization
 * @param {string} repo - Repository
 * @returns {Promise<Array>} - Array of file items
 */
async function listFolder(folderPath, org, repo) {
  try {
    const listUrl = `${DA_ORIGIN}/list${folderPath}`;
    const response = await daFetch(listUrl, org, repo);

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('[indexing-runner] Error listing folder:', error);
    return [];
  }
}

/**
 * Get index status (exists, lastModified)
 * Based on da-nx/nx/blocks/media-library/indexing/index-status.js::getIndexStatus
 * and admin-api.js::checkIndex
 *
 * This checks the ACTUAL file timestamp from folder listing, not meta.lastFetchTime
 *
 * @param {string} sitePath - Site path
 * @param {string} org - Organization
 * @param {string} repo - Repository
 * @returns {Promise<object>} - {indexExists, indexLastModified}
 */
async function getIndexStatus(sitePath, org, repo) {
  try {
    const folderPath = `${sitePath}/${INDEX_FILES.FOLDER}`;
    const metaPath = `${folderPath}/${INDEX_FILES.MEDIA_INDEX_META}`;

    // Load meta to check if chunked
    const metaResponse = await daFetch(`${DA_ORIGIN}/source${metaPath}`, org, repo);

    if (!metaResponse.ok) {
      return { indexExists: false, indexLastModified: null };
    }

    const metaResult = await metaResponse.json();
    const meta = metaResult.data?.[0] || metaResult;

    // List folder to get actual file timestamps
    const items = await listFolder(folderPath, org, repo);

    if (meta?.chunked === true) {
      // For chunked indexes, use meta file timestamp
      // (matches da-nx logic to avoid alignment issues)
      const metaFile = items.find(
        (item) => (item.name === 'index-meta' && item.ext === 'json')
          || (item.path && item.path.endsWith(`/${INDEX_FILES.MEDIA_INDEX_META}`))
      );

      const lastMod = metaFile?.lastModified ?? metaFile?.props?.lastModified ?? null;

      return {
        indexExists: true,
        indexLastModified: lastMod
      };
    }

    // Non-chunked: check for single index.json
    const indexFile = items.find(
      (item) => (item.name === 'media-index' && item.ext === 'json')
        || (item.path && item.path.endsWith(`/${INDEX_FILES.MEDIA_INDEX}`))
    );

    if (!indexFile) {
      return { indexExists: false, indexLastModified: null };
    }

    const lastMod = indexFile.lastModified ?? indexFile.props?.lastModified ?? null;

    return {
      indexExists: true,
      indexLastModified: lastMod
    };
  } catch (error) {
    console.error('[indexing-runner] Error getting index status:', error);
    return { indexExists: false, indexLastModified: null };
  }
}

/**
 * Load media index if it has been updated
 * Based on da-nx/nx/blocks/media-library/ui/data.js::loadMediaIfUpdated
 *
 * @param {string} sitePath - Site path (e.g., '/org/repo')
 * @param {string} org - Organization
 * @param {string} repo - Repository
 * @returns {Promise<object>} - {hasChanged, mediaData, indexMissing}
 */
export async function loadMediaIfUpdated(sitePath, org, repo) {
  try {
    // Get index status once
    const status = await getIndexStatus(sitePath, org, repo);

    if (!status.indexExists) {
      console.log('[indexing-runner] Index missing');
      return { hasChanged: true, mediaData: [], indexMissing: true };
    }

    // Get last known timestamp from site object
    const site = await getSite(sitePath);
    const lastKnown = site?.lastIndexed || null;

    const hasChanged = !lastKnown || status.indexLastModified > lastKnown;

    if (!hasChanged) {
      console.log('[indexing-runner] No changes detected');
      return { hasChanged: false, mediaData: null, indexMissing: false };
    }

    console.log('[indexing-runner] Changes detected, loading index...');

    // Update site's lastIndexed timestamp
    if (site && status.indexLastModified) {
      site.lastIndexed = status.indexLastModified;
      await updateSite(site);
    }

    console.log('[indexing-runner] Index loaded, timestamp updated');

    return {
      hasChanged: true,
      mediaData: [], // We don't load full data in extension
      indexMissing: false
    };
  } catch (error) {
    console.error('[indexing-runner] Error in loadMediaIfUpdated:', error);
    throw error;
  }
}

/**
 * TODO: Trigger index build
 *
 * For now, we only detect changes. Actual building requires:
 * 1. Check locks
 * 2. Fetch audit log / medialog / status API
 * 3. Build sheets
 * 4. Save to DA storage
 *
 * This will be implemented in future tasks.
 */
