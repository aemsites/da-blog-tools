/**
 * Popup script
 * Displays indexing stats and status
 */

import { getSites, getSite, updateSite } from './adapters/storage-adapter.js';

/**
 * Format timestamp as relative time
 */
function formatRelativeTime(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * Render current site view
 */
async function renderCurrentSite(sitePath) {
  const site = await getSite(sitePath);

  if (!site) {
    return `
      <div class="site-info">
        <div class="site-path">${sitePath}</div>
        <p style="color: #666; margin-top: 8px;">Not tracking this site yet.</p>
        <p style="color: #999; font-size: 12px; margin-top: 4px;">Right-click → "Add this site for indexing"</p>
      </div>
    `;
  }

  // Fetch fresh stats if mediaCount is missing and index should exist
  if ((site.mediaCount === 0 || site.mediaCount === undefined)
    && site.status === 'ok'
    && !site.needsFullIndex) {
    try {
      const indexStatusModule = await import('./lib/indexing/index-status.js');
      const meta = await indexStatusModule.loadIndexMeta(sitePath, site.org, site.repo);

      if (meta?.entriesCount > 0) {
        site.mediaCount = meta.entriesCount;
        await updateSite(site);
      }
    } catch (error) {
      console.warn('[popup] Could not fetch fresh count:', error);
    }
  }

  let statusClass;
  if (site.status === 'ok') {
    statusClass = 'status-ok';
  } else if (site.status === 'indexing') {
    statusClass = 'status-indexing';
  } else if (site.status === 'auth_required') {
    statusClass = 'status-warning';
  } else {
    statusClass = 'status-error';
  }

  const lastIndexed = site.lastIndexed
    ? formatRelativeTime(site.lastIndexed)
    : 'Never';

  // Read media count from cached value (updated during indexing)
  const mediaCount = site.mediaCount || 0;

  // Format sitePath: /org/repo → org > repo
  const formattedPath = site.sitePath.substring(1).replace('/', ' > ');

  // Format status display
  let statusDisplay;
  if (site.status === 'ok') {
    statusDisplay = 'OK';
  } else if (site.status === 'auth_required') {
    statusDisplay = 'AUTH NEEDED';
  } else {
    statusDisplay = site.status.toUpperCase();
  }

  return `
    <div class="site-info">
      <div class="site-path">${formattedPath}</div>

      <div class="stat">
        <span class="stat-label">Indexing Status:</span>
        <span class="stat-value ${statusClass}">${statusDisplay}</span>
      </div>

      <div class="stat">
        <span class="stat-label">Last indexed:</span>
        <span class="stat-value">${lastIndexed}</span>
      </div>

      <div class="stat">
        <span class="stat-label">Total media:</span>
        <span class="stat-value">${mediaCount}</span>
      </div>
    </div>
  `;
}

/**
 * Render all sites view
 */
async function renderAllSites() {
  const sites = await getSites();

  if (sites.length === 0) {
    return `
      <div class="empty">
        <p>No sites tracked yet.</p>
        <p style="margin-top: 8px; font-size: 12px;">Navigate to da.live and add sites via right-click menu.</p>
      </div>
    `;
  }

  // Use cached media counts from site objects
  const items = sites.map((site) => {
    const lastActive = formatRelativeTime(site.lastActive);
    const mediaCount = site.mediaCount || 0;
    return `
      <li class="site-item">
        <div>
          <div class="site-item-path">${site.sitePath}</div>
          <div class="site-item-stats">${site.status} · ${mediaCount} items · ${lastActive}</div>
        </div>
      </li>
    `;
  }).join('');

  return `
    <div style="margin-bottom: 8px; color: #666; font-size: 12px;">
      Tracked sites (${sites.length}):
    </div>
    <ul class="site-list">
      ${items}
    </ul>
  `;
}

/**
 * Get current tab's sitePath if on da.live
 */
async function getCurrentSitePath() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.url?.includes('da.live')) {
    return null;
  }

  const hash = tab.url.split('#')[1];
  const match = hash?.match(/^\/([^/]+)\/([^/]+)/);

  if (!match) return null;

  return `/${match[1]}/${match[2]}`;
}

/**
 * Initialize popup
 */
async function init() {
  const contentEl = document.getElementById('content');

  try {
    const currentSitePath = await getCurrentSitePath();

    let html;
    if (currentSitePath) {
      html = await renderCurrentSite(currentSitePath);
    } else {
      html = await renderAllSites();
    }

    contentEl.innerHTML = html;
  } catch (error) {
    console.error('[popup] Failed to initialize:', error);
    contentEl.innerHTML = `
      <div class="empty">
        <p style="color: #d32f2f;">Error loading popup</p>
        <p style="margin-top: 8px; font-size: 12px; color: #666;">${error.message}</p>
      </div>
    `;
  }
}

// Run on load
init();
