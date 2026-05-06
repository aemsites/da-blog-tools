/**
 * Content Change Detection
 * Checks for new uploads/changes that require index rebuilding
 */

import { getImsToken } from '../adapters/auth-adapter.js';

const AEM_ORIGIN = 'https://admin.hlx.page';

/**
 * Check if there are new content changes since last index
 *
 * @param {string} sitePath - Site path
 * @param {string} org - Organization
 * @param {string} repo - Repository
 * @param {number} lastIndexed - Last indexed timestamp
 * @param {string} ref - Git ref (default: 'main')
 * @returns {Promise<object>} - {hasChanges, changeCount, latestTimestamp}
 */
export async function checkForContentChanges(sitePath, org, repo, lastContentCheckTimestamp, ref = 'main') {
  if (!lastContentCheckTimestamp) {
    // No baseline, assume changes exist
    return { hasChanges: true, changeCount: 0, latestTimestamp: null };
  }

  try {
    // Check medialog and auditlog for recent changes
    // Use 5-minute buffer to catch delayed entries
    const bufferMs = 5 * 60 * 1000;
    const since = lastContentCheckTimestamp - bufferMs;

    const [medialogChanges, auditlogChanges] = await Promise.all([
      checkMedialogChanges(org, repo, ref, since),
      checkAuditlogChanges(org, repo, ref, since),
    ]);

    const totalChanges = medialogChanges.count + auditlogChanges.count;

    console.log('[content-checker] Change detection:', {
      since: new Date(since).toISOString(),
      medialogCount: medialogChanges.count,
      auditlogCount: auditlogChanges.count,
      totalChanges,
      hasChanges: totalChanges > 0,
    });

    return {
      hasChanges: totalChanges > 0,
      changeCount: totalChanges,
      latestTimestamp: Math.max(
        medialogChanges.latestTimestamp || 0,
        auditlogChanges.latestTimestamp || 0,
      ) || null,
    };
  } catch (error) {
    console.error('[content-checker] Error checking content changes:', error);
    // On error, assume no changes to avoid unnecessary rebuilds
    return { hasChanges: false, changeCount: 0, latestTimestamp: null };
  }
}

/**
 * Check medialog for new entries since timestamp
 *
 * @param {string} org - Organization
 * @param {string} repo - Repository
 * @param {string} ref - Git ref
 * @param {number} since - Timestamp to check from
 * @returns {Promise<object>} - {count, latestTimestamp}
 */
async function checkMedialogChanges(org, repo, ref, since) {
  try {
    // Get IMS token for authentication
    const imsToken = await getImsToken(org, repo);

    if (!imsToken) {
      console.warn('[content-checker] No IMS token available');
      return { count: 0, latestTimestamp: null };
    }

    // Fetch recent medialog entries
    // Medialog endpoint accepts IMS token directly (no site token needed)
    const url = `${AEM_ORIGIN}/medialog/${org}/${repo}/${ref}/`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${imsToken}`,
        'x-content-source-authorization': `Bearer ${imsToken}`,
      },
    });

    if (!response.ok) {
      console.warn('[content-checker] Medialog fetch failed:', response.status);
      return { count: 0, latestTimestamp: null };
    }

    const data = await response.json();
    // Handle multiple API response formats:
    // - Direct array: [entry1, entry2, ...]
    // - Object with 'log' property: {log: [entry1, entry2, ...]}
    // - Object with 'entries' property: {entries: [entry1, entry2, ...]}
    const entries = Array.isArray(data) ? data : (data.log || data.entries || []);

    console.log('[content-checker] Medialog response:', {
      totalEntries: entries.length,
      firstEntry: entries[0],
      dataStructure: Object.keys(data),
    });

    // Filter entries newer than 'since'
    const newEntries = entries.filter((entry) => {
      const entryTime = entry.timestamp || entry.time || 0;
      return entryTime > since;
    });

    if (newEntries.length > 0) {
      console.log('[content-checker] New medialog entries:', newEntries);
    }

    const latestTimestamp = newEntries.length > 0
      ? Math.max(...newEntries.map((e) => e.timestamp || e.time || 0))
      : null;

    return {
      count: newEntries.length,
      latestTimestamp,
    };
  } catch (error) {
    console.error('[content-checker] Medialog check error:', error);
    return { count: 0, latestTimestamp: null };
  }
}

/**
 * Check auditlog for new entries since timestamp
 *
 * @param {string} org - Organization
 * @param {string} repo - Repository
 * @param {string} ref - Git ref
 * @param {number} since - Timestamp to check from
 * @returns {Promise<object>} - {count, latestTimestamp}
 */
async function checkAuditlogChanges(org, repo, ref, since) {
  try {
    // Get IMS token for authentication
    const imsToken = await getImsToken(org, repo);

    if (!imsToken) {
      console.warn('[content-checker] No IMS token available for auditlog');
      return { count: 0, latestTimestamp: null };
    }

    // Fetch recent auditlog entries
    // Auditlog endpoint: /log/{org}/{repo}/{ref}
    const url = `${AEM_ORIGIN}/log/${org}/${repo}/${ref}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${imsToken}`,
        'x-content-source-authorization': `Bearer ${imsToken}`,
      },
    });

    if (!response.ok) {
      console.warn('[content-checker] Auditlog fetch failed:', response.status);
      return { count: 0, latestTimestamp: null };
    }

    const data = await response.json();
    // Handle multiple API response formats:
    // - Direct array: [entry1, entry2, ...]
    // - Object with 'log' property: {log: [entry1, entry2, ...]}
    // - Object with 'entries' property: {entries: [entry1, entry2, ...]}
    const entries = Array.isArray(data) ? data : (data.log || data.entries || []);

    console.log('[content-checker] Auditlog response:', {
      totalEntries: entries.length,
      firstEntry: entries[0],
      dataStructure: Object.keys(data),
    });

    // Filter entries newer than 'since'
    const newEntries = entries.filter((entry) => {
      const entryTime = entry.timestamp || entry.time || 0;
      return entryTime > since;
    });

    if (newEntries.length > 0) {
      console.log('[content-checker] New auditlog entries:', newEntries);
    }

    const latestTimestamp = newEntries.length > 0
      ? Math.max(...newEntries.map((e) => e.timestamp || e.time || 0))
      : null;

    return {
      count: newEntries.length,
      latestTimestamp,
    };
  } catch (error) {
    console.error('[content-checker] Auditlog check error:', error);
    return { count: 0, latestTimestamp: null };
  }
}
