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
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve(null);
    }, 5000); // 5s timeout

    // Broadcast to all tabs
    chrome.runtime.sendMessage(
      {
        type: 'REQUEST_AUTH',
        org,
        repo
      },
      (response) => {
        clearTimeout(timeout);

        if (chrome.runtime.lastError) {
          console.warn('[auth-adapter] No response from tabs:', chrome.runtime.lastError);
          resolve(null);
          return;
        }

        if (response?.type === 'AUTH_TOKEN' && response?.token) {
          resolve(response.token);
        } else {
          resolve(null);
        }
      }
    );
  });
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
