/**
 * Site manager - CRUD operations for tracked sites
 */

import { getSites, setSites, getSite, updateSite, removeSite } from '../adapters/storage-adapter.js';
import { checkIfIndexExists } from '../adapters/fetch-adapter.js';

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
      fragments: 0
    },
    lastError: null,
    consecutiveFailures: 0
  };
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
 * Get all active sites (lastActive within 24hrs)
 * @returns {Promise<Array>} - Array of active site objects
 */
export async function getActiveSites() {
  const sites = await getSites();
  const now = Date.now();
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

  return sites.filter(site => {
    const inactive = now - site.lastActive > TWENTY_FOUR_HOURS_MS;
    return !inactive;
  });
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
