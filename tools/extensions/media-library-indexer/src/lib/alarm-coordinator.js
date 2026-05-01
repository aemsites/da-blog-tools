/**
 * Alarm coordinator
 * Manages polling intervals and determines when to check sites
 */

import { getActiveSites } from './site-manager.js';
import { getSite, updateSite } from '../adapters/storage-adapter.js';
import { loadMediaIfUpdated } from './indexing-runner.js';
import { checkForContentChanges } from './content-checker.js';

const INDEX_CHECK_INTERVAL_MS = 60_000; // 60s
const CONTENT_CHECK_INTERVAL_MS = 80_000; // 80s

/**
 * Check if site needs index check (60s interval)
 * @param {object} site - Site object
 * @param {number} now - Current timestamp
 * @returns {boolean} - True if check needed
 */
export function shouldCheckIndex(site, now) {
  const lastCheck = site.lastIndexCheck || 0;
  return (now - lastCheck) >= INDEX_CHECK_INTERVAL_MS;
}

/**
 * Check if site needs content check (120s interval)
 * @param {object} site - Site object
 * @param {number} now - Current timestamp
 * @returns {boolean} - True if check needed
 */
export function shouldCheckContent(site, now) {
  const lastCheck = site.lastContentCheck || 0;
  return (now - lastCheck) >= CONTENT_CHECK_INTERVAL_MS;
}

/**
 * Process alarm wake - check all active sites
 * @returns {Promise<void>}
 */
export async function processAlarmWake() {
  const now = Date.now();
  const sites = await getActiveSites();

  console.log(`[alarm] Processing ${sites.length} active sites`);

  for (const site of sites) {
    try {
      if (shouldCheckIndex(site, now)) {
        await checkIndexChanges(site, now);
      }

      if (shouldCheckContent(site, now)) {
        await checkContentChanges(site, now);
      }
    } catch (error) {
      console.error(`[alarm] Error processing site ${site.sitePath}:`, error);

      site.consecutiveFailures = (site.consecutiveFailures || 0) + 1;
      site.lastError = {
        code: 'PROCESSING_ERROR',
        message: error.message,
        timestamp: now
      };

      if (site.consecutiveFailures >= 3) {
        site.status = 'network_error';
      }

      await updateSite(site);
    }
  }
}

/**
 * Check index changes (60s check)
 * @param {object} site - Site object
 * @param {number} now - Current timestamp
 */
async function checkIndexChanges(site, now) {
  console.log(`[alarm] Checking index for ${site.sitePath}`);

  try {
    const result = await loadMediaIfUpdated(site.sitePath, site.org, site.repo);

    if (result.hasChanged) {
      console.log(`[alarm] Index changed for ${site.sitePath}`);
      // Index was updated, reload site to get updated lastIndexed
      site = await getSite(site.sitePath);
    }

    if (result.indexMissing) {
      console.warn(`[alarm] Index missing for ${site.sitePath}, may need full rebuild`);
      site.needsFullIndex = true;
    }

    site.lastIndexCheck = now;
    site.consecutiveFailures = 0; // Reset on success
    await updateSite(site);
  } catch (error) {
    console.error(`[alarm] Error checking index for ${site.sitePath}:`, error);
    throw error; // Let processAlarmWake handle the error
  }
}

/**
 * Check content changes (120s check)
 * @param {object} site - Site object
 * @param {number} now - Current timestamp
 */
async function checkContentChanges(site, now) {
  console.log(`[alarm] Checking content for ${site.sitePath}`);

  try {
    const result = await checkForContentChanges(
      site.sitePath,
      site.org,
      site.repo,
      site.lastIndexed
    );

    if (result.hasChanges) {
      console.log(`[alarm] Content changes detected for ${site.sitePath}:`, {
        changeCount: result.changeCount,
        latestTimestamp: result.latestTimestamp
      });

      // Reload site to get latest data
      site = await getSite(site.sitePath);
      site.needsFullIndex = true; // Flag for rebuild
      site.pendingChanges = result.changeCount;
    } else {
      console.log(`[alarm] No content changes for ${site.sitePath}`);
    }

    site.lastContentCheck = now;
    await updateSite(site);
  } catch (error) {
    console.error(`[alarm] Error checking content for ${site.sitePath}:`, error);
    throw error;
  }
}
