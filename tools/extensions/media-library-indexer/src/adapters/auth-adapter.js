/**
 * Auth adapter for Chrome extension
 * Requests IMS tokens from active da.live tabs
 */

// Token cache: { sitePath: { token, expiresAt, tabId } }
const tokenCache = new Map();

// Token TTL: 1 hour (conservative, IMS tokens valid 24hrs)
const TOKEN_TTL_MS = 60 * 60 * 1000;

/**
 * Get IMS token for org/repo, request from tabs if needed
 * @param {string} org - Organization
 * @param {string} repo - Repository
 * @returns {Promise<string|null>} - IMS token or null
 */
export async function getImsToken(org, repo) {
  const sitePath = `/${org}/${repo}`;

  // Check cache first
  const cached = tokenCache.get(sitePath);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.token;
  }

  // Request fresh token from tabs
  const token = await requestTokenFromTabs(org, repo);

  if (token) {
    tokenCache.set(sitePath, {
      token,
      expiresAt: Date.now() + TOKEN_TTL_MS
    });
  }

  return token;
}

/**
 * Clear cached token (on 401/403 errors)
 * @param {string} org - Organization
 * @param {string} repo - Repository
 */
export function clearToken(org, repo) {
  const sitePath = `/${org}/${repo}`;
  tokenCache.delete(sitePath);
}

/**
 * Request token from active tabs via messaging
 * @param {string} org - Organization
 * @param {string} repo - Repository
 * @returns {Promise<string|null>} - Token or null
 */
async function requestTokenFromTabs(org, repo) {
  // Query for all da.live tabs
  const tabs = await chrome.tabs.query({ url: 'https://da.live/*' });

  if (tabs.length === 0) {
    console.warn('[auth-adapter] No da.live tabs open');
    return null;
  }

  // Try each tab until we get a token
  for (const tab of tabs) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'REQUEST_AUTH',
        org,
        repo
      });

      if (response?.type === 'AUTH_TOKEN' && response?.token) {
        console.log('[auth-adapter] Got token from tab', tab.id);
        return response.token;
      }
    } catch (error) {
      // Tab might not have content script, try next
      console.warn(`[auth-adapter] Failed to get token from tab ${tab.id}:`, error.message);
    }
  }

  console.warn('[auth-adapter] No token received from any tab');
  return null;
}

/**
 * Check if token is expired (for proactive refresh)
 * @param {string} org - Organization
 * @param {string} repo - Repository
 * @returns {boolean} - True if token needs refresh
 */
export function isTokenExpired(org, repo) {
  const sitePath = `/${org}/${repo}`;
  const cached = tokenCache.get(sitePath);

  if (!cached) return true;

  // Refresh if < 4 hours left (proactive)
  const hoursLeft = (cached.expiresAt - Date.now()) / (60 * 60 * 1000);
  return hoursLeft < 4;
}
