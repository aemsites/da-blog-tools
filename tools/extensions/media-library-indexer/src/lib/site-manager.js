/**
 * Site manager - CRUD operations for tracked sites
 */

import {
  getSites, setSites, getSite, updateSite, removeSite,
} from '../adapters/storage-adapter.js';
import { checkIfIndexExists, daFetch } from '../adapters/fetch-adapter.js';

/**
 * Create site object with defaults
 * @param {string} org - Organization
 * @param {string} repo - Repository
 * @param {boolean} needsFullIndex - Whether full index needed
 * @returns {object} - Site object
 */
function createSiteObject(org, repo, needsFullIndex) {
  const now = Date.now();
  return {
    org,
    repo,
    sitePath: `/${org}/${repo}`,
    addedAt: now,
    lastActive: now,
    lastIndexCheck: 0,
    lastContentCheck: 0,
    needsFullIndex,
    status: 'ok',
    stats: {
      mediaCount: 0,
      images: 0,
      videos: 0,
      documents: 0,
      fragments: 0,
    },
    lastError: null,
    consecutiveFailures: 0,
  };
}

/**
 * Fetch index stats from index-meta.json
 * @param {string} sitePath - Site path
 * @param {string} org - Organization
 * @param {string} repo - Repository
 * @returns {Promise<object|null>} - Stats object or null
 */
async function fetchIndexStats(sitePath, org, repo) {
  try {
    const metaUrl = `https://admin.da.live/source${sitePath}/.da/media-insights/index-meta.json`;
    const response = await daFetch(metaUrl, org, repo);

    if (!response.ok) {
      console.warn(`[site-manager] Could not fetch index-meta for ${sitePath}: ${response.status}`);
      return null;
    }

    const result = await response.json();

    if (!result) {
      console.warn(`[site-manager] Empty JSON response for ${sitePath}`);
      return null;
    }

    // DA admin API returns sheet format: {data: [{...actual meta...}]}
    const meta = result.data?.[0] || result;
    console.log('[site-manager] Fetched index-meta:', meta);

    return {
      mediaCount: meta.mediaCount || 0,
      usageCount: meta.usageCount || 0,
      lastIndexed: meta.lastFetchTime || null,
      chunkCount: meta.chunkCount || 0,
    };
  } catch (error) {
    console.error(`[site-manager] Error fetching index stats for ${sitePath}:`, error);
    return null;
  }
}

/**
 * Add site to tracking list
 * @param {string} org - Organization
 * @param {string} repo - Repository
 * @returns {Promise<object>} - Created site object
 */
export async function addSite(org, repo) {
  const sitePath = `/${org}/${repo}`;

  // Check if already exists
  const existing = await getSite(sitePath);
  if (existing) {
    console.log(`[site-manager] Site ${sitePath} already tracked`);
    return existing;
  }

  // Check if index exists in DA storage
  const indexExists = await checkIfIndexExists(sitePath, org, repo);

  const site = createSiteObject(org, repo, !indexExists);

  // If index exists, fetch current stats
  if (indexExists) {
    const stats = await fetchIndexStats(sitePath, org, repo);
    if (stats) {
      site.stats.mediaCount = stats.mediaCount;
      site.mediaCount = stats.mediaCount; // Cache for popup
      site.lastIndexed = stats.lastIndexed;
      console.log(`[site-manager] Loaded stats: ${stats.mediaCount} media items`);
    }
  }

  const sites = await getSites();
  sites.push(site);
  await setSites(sites);

  console.log(`[site-manager] Added site ${sitePath}, needsFullIndex: ${!indexExists}`);

  return site;
}

/**
 * Remove site from tracking list
 * @param {string} sitePath - Site path to remove
 * @returns {Promise<void>}
 */
export async function removeSiteFromTracking(sitePath) {
  await removeSite(sitePath);
  console.log(`[site-manager] Removed site ${sitePath}`);
}

/**
 * Update site's lastActive timestamp
 * @param {string} sitePath - Site path
 * @returns {Promise<void>}
 */
export async function updateLastActive(sitePath) {
  const site = await getSite(sitePath);
  if (site) {
    site.lastActive = Date.now();
    await updateSite(site);
  }
}

/**
 * Get all tracked sites
 * Note: With tab-required mode, we process ALL tracked sites when da.live tabs are open.
 * The tab check in alarm-coordinator handles stopping when no tabs are open.
 * @returns {Promise<Array>} - Array of all tracked site objects
 */
export async function getActiveSites() {
  return getSites();
}

/**
 * Check if site is tracked
 * @param {string} sitePath - Site path
 * @returns {Promise<boolean>} - True if tracked
 */
export async function isSiteTracked(sitePath) {
  const site = await getSite(sitePath);
  return !!site;
}

/**
 * Update site status
 * @param {string} sitePath - Site path
 * @param {string} status - New status ('ok', 'indexing', 'auth_required', etc.)
 * @param {object|null} error - Error object or null
 * @returns {Promise<void>}
 */
export async function updateSiteStatus(sitePath, status, error = null) {
  const site = await getSite(sitePath);
  if (site) {
    site.status = status;
    site.lastError = error;
    await updateSite(site);
  }
}

/**
 * Update site stats from index data
 * @param {string} sitePath - Site path
 * @param {object} stats - Stats object { mediaCount, images, videos, etc. }
 * @returns {Promise<void>}
 */
export async function updateSiteStats(sitePath, stats) {
  const site = await getSite(sitePath);
  if (site) {
    site.stats = { ...site.stats, ...stats };
    site.lastIndexed = Date.now();
    await updateSite(site);
  }
}
