/**
 * Content script for da.live pages
 * Detects org/site from URL hash and provides auth tokens
 */

/**
 * Parse org/site from URL hash
 * @returns {object|null} - { org, repo, sitePath } or null
 */
function parseOrgSiteFromHash() {
  const { hash } = window.location;
  const match = hash.match(/^#\/([^/]+)\/([^/]+)/);

  if (!match) return null;

  const org = match[1];
  const repo = match[2];

  return {
    org,
    repo,
    sitePath: `/${org}/${repo}`,
  };
}

/**
 * Notify service worker that tab is active on org/site
 */
function notifyTabActive() {
  const parsed = parseOrgSiteFromHash();

  if (parsed) {
    chrome.runtime.sendMessage({
      type: 'TAB_ACTIVE',
      org: parsed.org,
      repo: parsed.repo,
      sitePath: parsed.sitePath,
    });

    // Also update icon state
    chrome.runtime.sendMessage({
      type: 'UPDATE_ICON',
      state: 'active',
    });
  } else {
    chrome.runtime.sendMessage({
      type: 'UPDATE_ICON',
      state: 'inactive',
    });
  }
}

/**
 * Get IMS token from localStorage
 * @returns {string|null} - Token or null
 */
function getImsTokenFromStorage() {
  try {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith('adobeid_ims_access_token'));

    if (keys.length === 0) {
      console.warn('[content] No IMS token keys found in localStorage');
      return null;
    }

    // Find first valid token
    for (const key of keys) {
      const data = JSON.parse(localStorage.getItem(key));
      if (data?.valid && data?.tokenValue) {
        console.log('[content] Found valid IMS token');
        return data.tokenValue;
      }
    }

    console.warn('[content] No valid IMS token found');
    return null;
  } catch (error) {
    console.error('[content] Error reading IMS token from localStorage:', error);
    return null;
  }
}

/**
 * Listen for auth token requests from service worker
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'REQUEST_AUTH') {
    const token = getImsTokenFromStorage();

    sendResponse({
      type: 'AUTH_TOKEN',
      token,
      org: msg.org,
      repo: msg.repo,
    });

    return false; // Synchronous response
  }

  return false; // Return false for unhandled messages
});

// Notify on load
notifyTabActive();

// Notify on hash change
window.addEventListener('hashchange', notifyTabActive);

console.log('[content] Media Library Indexer content script loaded');
