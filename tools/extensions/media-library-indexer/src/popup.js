/**
 * Popup script
 * Displays indexing stats and status
 */

import { getSites, getSite } from './adapters/storage-adapter.js';

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

  const statusClass = site.status === 'ok' ? 'status-ok' :
                      site.status === 'indexing' ? 'status-indexing' :
                      'status-error';

  const lastIndexed = site.lastIndexed
    ? formatRelativeTime(site.lastIndexed)
    : 'Never';

  return `
    <div class="site-info">
      <div class="site-path">${site.sitePath}</div>
      <div class="status ${statusClass}">${site.status}</div>

      <div class="stat">
        <span class="stat-label">Last indexed:</span>
        <span class="stat-value">${lastIndexed}</span>
      </div>

      <div class="stat">
        <span class="stat-label">Total media:</span>
        <span class="stat-value">${site.stats.mediaCount}</span>
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

  const items = sites.map(site => {
    const lastActive = formatRelativeTime(site.lastActive);
    return `
      <li class="site-item">
        <div>
          <div class="site-item-path">${site.sitePath}</div>
          <div class="site-item-stats">${site.status} · ${site.stats.mediaCount} items · ${lastActive}</div>
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

  const currentSitePath = await getCurrentSitePath();

  let html;
  if (currentSitePath) {
    html = await renderCurrentSite(currentSitePath);
  } else {
    html = await renderAllSites();
  }

  contentEl.innerHTML = html;
}

// Run on load
init();
