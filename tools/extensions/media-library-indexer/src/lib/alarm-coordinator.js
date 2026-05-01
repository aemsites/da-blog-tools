/**
 * Alarm coordinator
 * Manages polling intervals and determines when to check sites
 */

import { getActiveSites, updateSite } from './site-manager.js';

const INDEX_CHECK_INTERVAL_MS = 60_000; // 60s
const CONTENT_CHECK_INTERVAL_MS = 120_000; // 120s

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

  // TODO: Import and use loadMediaIfUpdated from da.live CDN
  // For now, just update timestamp

  site.lastIndexCheck = now;
  await updateSite(site);
}

/**
 * Check content changes (120s check)
 * @param {object} site - Site object
 * @param {number} now - Current timestamp
 */
async function checkContentChanges(site, now) {
  console.log(`[alarm] Checking content for ${site.sitePath}`);

  // TODO: Check locks, trigger builds if needed
  // For now, just update timestamp

  site.lastContentCheck = now;
  await updateSite(site);
}
