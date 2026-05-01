/**
 * Fetch adapter for Chrome extension
 * Wraps fetch with auth injection and error handling
 */

import { getImsToken, clearToken } from './auth-adapter.js';

/**
 * Get DA_ORIGIN based on environment
 * @returns {string} - DA admin origin
 */
function getDaOrigin() {
  // For extension, always use prod unless localStorage override
  // Note: localStorage not available in service worker, use chrome.storage if needed
  return 'https://admin.da.live';
}

export const DA_ORIGIN = getDaOrigin();

/**
 * Fetch with auth token injection (like daFetch)
 * @param {string} url - URL to fetch
 * @param {string} org - Organization
 * @param {string} repo - Repository
 * @param {object} opts - Fetch options
 * @returns {Promise<Response>} - Fetch response
 */
export async function daFetch(url, org, repo, opts = {}) {
  opts.headers ||= {};

  const token = await getImsToken(org, repo);

  if (token) {
    opts.headers.Authorization = `Bearer ${token}`;

    // For admin.hlx.page URLs, add x-content-source-authorization header
    if (url.startsWith('https://admin.hlx.page')) {
      opts.headers['x-content-source-authorization'] = `Bearer ${token}`;
    }
  }

  let resp;
  try {
    resp = await fetch(url, opts);
  } catch (err) {
    console.error('[daFetch] Network error:', err);
    resp = new Response(null, { status: 500, statusText: err.message });
  }

  // Handle 401 - clear token and let caller retry
  if (resp.status === 401 || resp.status === 403) {
    console.warn(`[daFetch] Auth error ${resp.status} for ${url}`);
    clearToken(org, repo);
  }

  return resp;
}

/**
 * Check if index exists at sitePath
 * @param {string} sitePath - Site path (e.g., '/org/repo')
 * @param {string} org - Organization
 * @param {string} repo - Repository
 * @returns {Promise<boolean>} - True if index exists
 */
export async function checkIfIndexExists(sitePath, org, repo) {
  try {
    const metaPath = `${sitePath}/.da/media-insights/index-meta.json`;
    const resp = await daFetch(`${DA_ORIGIN}/source${metaPath}`, org, repo);
    return resp.ok;
  } catch {
    return false;
  }
}
