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
import { getSite, updateSite } from './site-manager.js';

const INDEX_FILES = {
  FOLDER: '.da/media-insights',
  MEDIA_INDEX: 'index.json',
  MEDIA_INDEX_META: 'index-meta.json',
};

const SHEET_NAMES = {
  MEDIA: 'media',
};

/**
 * Get index status (exists, lastModified)
 * Based on da-nx/nx/blocks/media-library/indexing/index-status.js
 *
 * @param {string} sitePath - Site path
 * @param {string} org - Organization
 * @param {string} repo - Repository
 * @returns {Promise<object>} - {indexExists, indexLastModified}
 */
async function getIndexStatus(sitePath, org, repo) {
  try {
    const basePath = `${sitePath}/${INDEX_FILES.FOLDER}`;
    const metaUrl = `${DA_ORIGIN}/source${basePath}/${INDEX_FILES.MEDIA_INDEX_META}`;

    const response = await daFetch(metaUrl, org, repo);

    if (!response.ok) {
      return { indexExists: false, indexLastModified: null };
    }

    // DA admin API returns sheet format
    const result = await response.json();
    const meta = result.data?.[0] || result;

    return {
      indexExists: true,
      indexLastModified: meta.lastFetchTime || null
    };
  } catch (error) {
    console.error('[indexing-runner] Error getting index status:', error);
    return { indexExists: false, indexLastModified: null };
  }
}

/**
 * Check if media sheet has changed
 * Based on da-nx/nx/blocks/media-library/ui/data.js::hasMediaSheetChanged
 *
 * @param {string} sitePath - Site path
 * @param {string} org - Organization
 * @param {string} repo - Repository
 * @returns {Promise<object>} - {hasChanged, fileTimestamp}
 */
async function hasMediaSheetChanged(sitePath, org, repo) {
  try {
    const status = await getIndexStatus(sitePath, org, repo);

    if (!status.indexExists) {
      return { hasChanged: true, fileTimestamp: null };
    }

    // Get last known timestamp from site object
    const site = await getSite(sitePath);
    const lastKnown = site?.lastIndexed || null;

    const hasChanged = !lastKnown || status.indexLastModified > lastKnown;

    return {
      hasChanged,
      fileTimestamp: status.indexLastModified
    };
  } catch (error) {
    console.error('[indexing-runner] Error checking sheet changes:', error);
    return { hasChanged: true, fileTimestamp: null };
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
    const { hasChanged, fileTimestamp } = await hasMediaSheetChanged(sitePath, org, repo);

    if (!hasChanged) {
      console.log('[indexing-runner] No changes detected');
      return { hasChanged: false, mediaData: null, indexMissing: false };
    }

    console.log('[indexing-runner] Changes detected, loading index...');

    // Load the index (simplified - we don't need full data, just stats)
    const status = await getIndexStatus(sitePath, org, repo);

    if (!status.indexExists) {
      console.log('[indexing-runner] Index missing');
      return { hasChanged: true, mediaData: [], indexMissing: true };
    }

    // Update site's lastIndexed timestamp
    const site = await getSite(sitePath);
    if (site && fileTimestamp) {
      site.lastIndexed = fileTimestamp;
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
