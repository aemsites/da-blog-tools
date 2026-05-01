/**
 * Service worker background script
 * Coordinates alarms, manages sites, runs indexing
 */

import { addSite, removeSiteFromTracking, updateLastActive, isSiteTracked } from './lib/site-manager.js';

console.log('[background] Media Library Indexer service worker started');

/**
 * Handle extension install
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[background] Extension installed:', details.reason);

  // Create periodic alarm (every 60s)
  await chrome.alarms.create('media-library-poll', {
    periodInMinutes: 1
  });

  console.log('[background] Created polling alarm (60s interval)');

  // Initialize context menus
  await updateContextMenus(null);
});

/**
 * Handle alarm wake
 */
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'media-library-poll') {
    console.log('[background] Alarm fired:', new Date().toISOString());

    // TODO: Check active sites and run polling logic
    // For now, just log
  }
});

/**
 * Handle messages from content scripts
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'TAB_ACTIVE') {
    handleTabActive(msg, sender);
    return false;
  }

  if (msg.type === 'UPDATE_ICON') {
    handleUpdateIcon(msg, sender);
    return false;
  }

  if (msg.type === 'GET_STATS') {
    handleGetStats(msg).then(sendResponse);
    return true; // Async response
  }
});

/**
 * Handle TAB_ACTIVE message from content script
 */
async function handleTabActive(msg, sender) {
  const { org, repo, sitePath } = msg;
  console.log(`[background] Tab active: ${sitePath}`);

  // Update lastActive if site is tracked
  await updateLastActive(sitePath);

  // Update context menus for this tab
  await updateContextMenus(sitePath);
}

/**
 * Handle UPDATE_ICON message
 */
async function handleUpdateIcon(msg, sender) {
  const { state } = msg;
  const tabId = sender.tab?.id;

  if (!tabId) return;

  const iconPath = state === 'active'
    ? 'icons/icon-active-48.png'
    : 'icons/icon-48.png';

  try {
    await chrome.action.setIcon({
      path: iconPath,
      tabId
    });
  } catch (error) {
    console.warn('[background] Icon update failed:', error);
  }
}

/**
 * Handle GET_STATS message from popup
 */
async function handleGetStats(msg) {
  const { sitePath } = msg;

  // TODO: Return actual stats from storage
  return {
    sitePath,
    stats: { mediaCount: 0 }
  };
}

/**
 * Update context menus based on current tab
 */
async function updateContextMenus(sitePath) {
  // Remove all existing menus
  await chrome.contextMenus.removeAll();

  if (!sitePath) {
    // No valid org/site, show nothing
    console.log('[background] No sitePath, skipping context menus');
    return;
  }

  const isTracked = await isSiteTracked(sitePath);

  try {
    if (!isTracked) {
      // Show "Add this site"
      chrome.contextMenus.create({
        id: 'add-site',
        title: 'Add this site for indexing',
        contexts: ['all']
      }, () => {
        if (chrome.runtime.lastError) {
          console.error('[background] Error creating add-site menu:', chrome.runtime.lastError);
        } else {
          console.log('[background] Created "Add this site" menu');
        }
      });
    } else {
      // Show "Remove this site"
      chrome.contextMenus.create({
        id: 'remove-site',
        title: 'Remove this site from indexing',
        contexts: ['all']
      }, () => {
        if (chrome.runtime.lastError) {
          console.error('[background] Error creating remove-site menu:', chrome.runtime.lastError);
        } else {
          console.log('[background] Created "Remove this site" menu');
        }
      });
    }

    // Always show "Open media library app"
    chrome.contextMenus.create({
      id: 'open-app',
      title: 'Open media library app',
      contexts: ['all']
    }, () => {
      if (chrome.runtime.lastError) {
        console.error('[background] Error creating open-app menu:', chrome.runtime.lastError);
      } else {
        console.log('[background] Created "Open app" menu');
      }
    });
  } catch (error) {
    console.error('[background] Error updating context menus:', error);
  }
}

/**
 * Handle context menu clicks
 */
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // Parse sitePath from tab URL
  const hash = tab.url?.split('#')[1];
  const match = hash?.match(/^\/([^/]+)\/([^/]+)/);

  if (!match) {
    console.warn('[background] Could not parse org/site from URL');
    return;
  }

  const org = match[1];
  const repo = match[2];
  const sitePath = `/${org}/${repo}`;

  if (info.menuItemId === 'add-site') {
    console.log(`[background] Adding site: ${sitePath}`);
    const site = await addSite(org, repo);

    // TODO: Trigger immediate check

    // Update context menus
    await updateContextMenus(sitePath);
  }

  if (info.menuItemId === 'remove-site') {
    console.log(`[background] Removing site: ${sitePath}`);
    await removeSiteFromTracking(sitePath);

    // Update context menus
    await updateContextMenus(sitePath);
  }

  if (info.menuItemId === 'open-app') {
    const appUrl = `https://da.live/apps/media-library#${sitePath}`;
    chrome.tabs.create({ url: appUrl });
  }
});
