/**
 * Content script for da.live pages
 * Detects org/site from URL hash and provides auth tokens
 */

/**
 * Parse org/site from URL hash
 * @returns {object|null} - { org, repo, sitePath } or null
 */
function parseOrgSiteFromHash() {
  const hash = window.location.hash;
  const match = hash.match(/^#\/([^/]+)\/([^/]+)/);

  if (!match) return null;

  const org = match[1];
  const repo = match[2];

  return {
    org,
    repo,
    sitePath: `/${org}/${repo}`
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
      sitePath: parsed.sitePath
    });

    // Also update icon state
    chrome.runtime.sendMessage({
      type: 'UPDATE_ICON',
      state: 'active'
    });
  } else {
    chrome.runtime.sendMessage({
      type: 'UPDATE_ICON',
      state: 'inactive'
    });
  }
}

/**
 * Listen for auth token requests from service worker
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'REQUEST_AUTH') {
    // Import IMS module from da.live and get token
    import('https://da.live/nx/utils/ims.js')
      .then(async ({ loadIms }) => {
        try {
          const imsDetails = await loadIms();
          const token = imsDetails?.accessToken?.token;

          sendResponse({
            type: 'AUTH_TOKEN',
            token: token || null,
            org: msg.org,
            repo: msg.repo
          });
        } catch (error) {
          console.error('[content] IMS load error:', error);
          sendResponse({
            type: 'AUTH_TOKEN',
            token: null,
            org: msg.org,
            repo: msg.repo
          });
        }
      })
      .catch(error => {
        console.error('[content] IMS import error:', error);
        sendResponse({
          type: 'AUTH_TOKEN',
          token: null,
          org: msg.org,
          repo: msg.repo
        });
      });

    return true; // Keep channel open for async response
  }
});

// Notify on load
notifyTabActive();

// Notify on hash change
window.addEventListener('hashchange', notifyTabActive);

console.log('[content] Media Library Indexer content script loaded');
