/**
 * Alarm coordinator
 * Manages polling intervals and determines when to check sites
 */

import { getSite, updateSite } from '../adapters/storage-adapter.js';
import { getActiveSites } from './site-manager.js';
import { checkForContentChanges } from './content-checker.js';
import { buildFullIndex, buildIncrementalIndex } from './indexing/worker-bridge.js';
import {
  checkIndexLock,
  createIndexLock,
  removeIndexLock,
  isFreshIndexLock,
  refreshIndexLock,
  getIndexLockOwnerId,
} from './indexing/locks.js';
import { determineIndexMode, loadIndexMeta } from './indexing/index-status.js';

const INDEX_CHECK_INTERVAL_MS = 60_000; // 60s
const CONTENT_CHECK_INTERVAL_MS = 80_000; // 80s

// Track last processed site index for rotation across alarm cycles
let lastProcessedIndex = 0;

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
 * Internal alarm processing function (without timeout)
 * @returns {Promise<void>}
 */
async function processAlarmWakeInternal() {
  const now = Date.now();
  const allSites = await getActiveSites();

  if (allSites.length === 0) {
    console.log('[alarm] No active sites to process');
    return;
  }

  // Early exit: check if any da.live tabs are open
  // If no tabs are open and tokens might be expired, skip processing
  const daliveTabs = await chrome.tabs.query({ url: 'https://da.live/*' });
  if (daliveTabs.length === 0) {
    console.warn('[alarm] No da.live tabs open - auth tokens cannot be refreshed. Skipping processing cycle.');
    console.warn('[alarm] Open https://da.live in a browser tab to resume indexing.');
    return;
  }

  // Limit concurrent processing to 5 sites per alarm cycle with rotation
  const MAX_SITES_PER_CYCLE = 5;
  const sitesToProcess = [];

  for (let i = 0; i < Math.min(MAX_SITES_PER_CYCLE, allSites.length); i += 1) {
    const siteIndex = (lastProcessedIndex + i) % allSites.length;
    sitesToProcess.push(allSites[siteIndex]);
  }

  lastProcessedIndex = (lastProcessedIndex + sitesToProcess.length) % allSites.length;

  console.log(`[alarm] Processing ${sitesToProcess.length} of ${allSites.length} active sites`);

  for (let site of sitesToProcess) {
    try {
      console.log(`[alarm] Processing site ${site.sitePath}, needsFullIndex: ${site.needsFullIndex}`);

      // Determine index mode by reading actual meta file
      const indexMode = await determineIndexMode(site.sitePath, site.org, site.repo);
      console.log(`[alarm] Index mode for ${site.sitePath}:`, indexMode);

      // Force full build if needed
      if (site.needsFullIndex || indexMode.needsFullBuild) {
        const reason = site.needsFullIndex ? 'needsFullIndex flag set' : indexMode.reason;
        console.log(`[alarm] Full build required for ${site.sitePath}: ${reason}`);
        await buildFullIndexForSite(site, now);
        // Reload site to get updated state after build
        site = await getSite(site.sitePath);
      } else if (indexMode.canUseIncremental) {
        // Index exists, check for existing lock first (da-nx pattern)
        const existingLock = await checkIndexLock(site.sitePath, site.org, site.repo);

        if (existingLock.exists && isFreshIndexLock(existingLock, now)) {
          // Check if we own this lock
          if (existingLock.ownerId === getIndexLockOwnerId()) {
            console.log(`[alarm] Refreshing our own lock for ${site.sitePath}`);
            await refreshIndexLock(site.sitePath, existingLock, site.org, site.repo);
          } else {
            console.log(`[alarm] Fresh lock detected for ${site.sitePath}, skipping (owner: ${existingLock.ownerId})`);
          }
          return; // Skip build either way
        }

        // No fresh lock, proceed with content check
        if (shouldCheckContent(site, now)) {
          await checkContentChanges(site, now);
          // Reload site after content check
          site = await getSite(site.sitePath);

          // If content changes detected, run incremental build
          if (site.pendingChanges > 0) {
            console.log(`[alarm] ${site.pendingChanges} pending changes, running incremental build for ${site.sitePath}`);
            await buildIncrementalIndexForSite(site, now, indexMode.lastFetchTime);
            // Reload site after incremental build
            site = await getSite(site.sitePath);
          }
        }
      }
    } catch (error) {
      console.error(`[alarm] Error processing site ${site.sitePath}:`, error);

      site.consecutiveFailures = (site.consecutiveFailures || 0) + 1;

      // Detect auth errors
      if (error.message.includes('No IMS token')
        || error.message.includes('401')
        || error.message.includes('403')) {
        site.status = 'auth_required';
        site.lastError = {
          code: 'AUTH_ERROR',
          message: 'Authentication required. Please open da.live in a tab.',
          timestamp: now,
        };
      } else {
        site.lastError = {
          code: 'PROCESSING_ERROR',
          message: error.message,
          timestamp: now,
        };

        if (site.consecutiveFailures >= 3) {
          site.status = 'network_error';
        }
      }

      await updateSite(site);
    }
  }
}

/**
 * Build full index for site with lock management
 * @param {object} site - Site object
 * @param {number} now - Current timestamp
 */
async function buildFullIndexForSite(site, now) {
  console.log(`[alarm] Building full index for ${site.sitePath}`);

  // Check for existing lock
  const existingLock = await checkIndexLock(site.sitePath, site.org, site.repo);

  if (existingLock.exists && isFreshIndexLock(existingLock, now)) {
    console.warn(`[alarm] Index build already in progress for ${site.sitePath} (owner: ${existingLock.ownerId})`);
    // Don't throw error, just skip this build
    return;
  }

  // Create lock before starting
  let lockData;
  try {
    await createIndexLock(site.sitePath, site.org, site.repo, 'full');

    // Capture lock data for heartbeat
    const lockCheck = await checkIndexLock(site.sitePath, site.org, site.repo);
    lockData = lockCheck;
  } catch (error) {
    console.error(`[alarm] Failed to create lock for ${site.sitePath}:`, error);
    throw error;
  }

  // Start heartbeat to refresh lock during long builds
  const heartbeatInterval = setInterval(async () => {
    try {
      await refreshIndexLock(site.sitePath, lockData, site.org, site.repo);
      console.log(`[alarm] Lock heartbeat refreshed for ${site.sitePath}`);
    } catch (error) {
      console.error('[alarm] Heartbeat refresh failed:', error);
    }
  }, 60000); // Every 60s

  try {
    const result = await buildFullIndex(
      site.org,
      site.repo,
      (progress) => {
        console.log(`[alarm] ${site.sitePath} - ${progress.message}`);
      },
    );

    console.log(`[alarm] Full index built for ${site.sitePath}: ${result?.length || 0} entries`);

    // Clear the flag and update site
    site.needsFullIndex = false;
    site.lastIndexed = now;
    site.pendingChanges = 0;
    site.consecutiveFailures = 0;
    site.mediaCount = result?.length || 0; // Cache media count for popup
    await updateSite(site);

    // Stop heartbeat and remove lock on success
    clearInterval(heartbeatInterval);
    await removeIndexLock(site.sitePath, site.org, site.repo);
  } catch (error) {
    console.error(`[alarm] Error building index for ${site.sitePath}:`, error);

    // Stop heartbeat and remove lock on failure
    clearInterval(heartbeatInterval);
    try {
      await removeIndexLock(site.sitePath, site.org, site.repo);
    } catch (lockError) {
      console.error('[alarm] Failed to remove lock after error:', lockError);
    }

    throw error;
  }
}

/**
 * Build incremental index for site with lock management
 * @param {object} site - Site object
 * @param {number} now - Current timestamp
 * @param {number} lastFetchTime - Timestamp from index-meta.json (when index was last built)
 */
async function buildIncrementalIndexForSite(site, now, lastFetchTime) {
  console.log(`[alarm] Building incremental index for ${site.sitePath} since ${new Date(lastFetchTime).toISOString()}`);

  // Check for existing lock
  const existingLock = await checkIndexLock(site.sitePath, site.org, site.repo);

  if (existingLock.exists && isFreshIndexLock(existingLock, now)) {
    console.warn(`[alarm] Index build already in progress for ${site.sitePath} (owner: ${existingLock.ownerId})`);
    return;
  }

  // Create lock before starting
  let lockData;
  try {
    await createIndexLock(site.sitePath, site.org, site.repo, 'incremental');

    // Capture lock data for heartbeat
    const lockCheck = await checkIndexLock(site.sitePath, site.org, site.repo);
    lockData = lockCheck;
  } catch (error) {
    console.error(`[alarm] Failed to create lock for ${site.sitePath}:`, error);
    throw error;
  }

  // Start heartbeat to refresh lock during long builds
  const heartbeatInterval = setInterval(async () => {
    try {
      await refreshIndexLock(site.sitePath, lockData, site.org, site.repo);
      console.log(`[alarm] Lock heartbeat refreshed for ${site.sitePath}`);
    } catch (error) {
      console.error('[alarm] Heartbeat refresh failed:', error);
    }
  }, 60000); // Every 60s

  try {
    // Note: lastFetchTime is read from index-meta.json internally by buildIncrementalIndex
    // We don't pass it as a parameter (matches da-nx behavior)
    const result = await buildIncrementalIndex(
      site.org,
      site.repo,
      (progress) => {
        console.log(`[alarm] ${site.sitePath} - ${progress.message}`);
      },
    );

    console.log(`[alarm] Incremental index built for ${site.sitePath}: ${result?.length || 0} changed entries`);

    // Read actual total from index-meta.json (incremental returns only changed entries)
    const meta = await loadIndexMeta(site.sitePath, site.org, site.repo);

    // Update site state
    site.lastIndexed = now;
    site.pendingChanges = 0;
    site.consecutiveFailures = 0;
    site.mediaCount = meta?.entriesCount || 0; // Use meta total, not result length
    await updateSite(site);

    // Stop heartbeat and remove lock on success
    clearInterval(heartbeatInterval);
    await removeIndexLock(site.sitePath, site.org, site.repo);
  } catch (error) {
    console.error(`[alarm] Error building incremental index for ${site.sitePath}:`, error);

    // Stop heartbeat
    clearInterval(heartbeatInterval);

    // If incremental build fails, fall back to full rebuild
    console.warn('[alarm] Incremental build failed, marking for full rebuild');
    site.needsFullIndex = true;
    await updateSite(site);

    // Remove lock on failure
    try {
      await removeIndexLock(site.sitePath, site.org, site.repo);
    } catch (lockError) {
      console.error('[alarm] Failed to remove lock after error:', lockError);
    }

    throw error;
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
    // Use lastContentCheckTimestamp as baseline (not lastIndexed)
    const lastContentCheckTimestamp = site.lastContentCheckTimestamp || site.addedAt || 0;

    const result = await checkForContentChanges(
      site.sitePath,
      site.org,
      site.repo,
      lastContentCheckTimestamp,
    );

    // Reload site to get latest data
    const updatedSite = await getSite(site.sitePath);

    if (result.hasChanges) {
      console.log(`[alarm] Content changes detected for ${updatedSite.sitePath}:`, {
        changeCount: result.changeCount,
        latestTimestamp: result.latestTimestamp,
      });

      // Set pending changes (will trigger incremental build)
      updatedSite.pendingChanges = result.changeCount;

      // Update baseline to the latest entry timestamp we just processed
      if (result.latestTimestamp) {
        updatedSite.lastContentCheckTimestamp = result.latestTimestamp;
      }
    } else {
      console.log(`[alarm] No content changes for ${updatedSite.sitePath}`);

      // Update baseline to latest entry we checked, or now if logs empty
      updatedSite.lastContentCheckTimestamp = result.latestTimestamp || now;
      updatedSite.pendingChanges = 0;
    }

    updatedSite.lastContentCheck = now;
    await updateSite(updatedSite);
  } catch (error) {
    console.error(`[alarm] Error checking content for ${site.sitePath}:`, error);
    throw error;
  }
}

/**
 * Process alarm wake with timeout protection (exported)
 * Wraps processAlarmWakeInternal with 55-second timeout to prevent Chrome alarm issues
 * @returns {Promise<void>}
 */
export async function processAlarmWake() {
  const ALARM_TIMEOUT_MS = 55000; // 55 seconds (Chrome allows 60s max)

  return Promise.race([
    processAlarmWakeInternal(),
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error('[alarm] Processing timeout after 55 seconds'));
      }, ALARM_TIMEOUT_MS);
    }),
  ]);
}
