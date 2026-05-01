/**
 * AEM Token Adapter
 * Handles token exchange for admin.hlx.page APIs (status, audit, medialog)
 */

import { getImsToken } from './auth-adapter.js';

const AEM_ORIGIN = 'https://admin.hlx.page';

// Token cache: key = 'org/site/ref', value = {siteToken, siteTokenExpiry}
const tokenCache = new Map();

/**
 * Get cache key for AEM site token
 * @param {string} org - Organization
 * @param {string} site - Site (repo)
 * @param {string} ref - Git ref (default: 'main')
 * @returns {string} - Cache key
 */
function getCacheKey(org, site, ref = 'main') {
  return `${org}/${site}/${ref}`;
}

/**
 * Fetch AEM site token by exchanging IMS token
 * @param {string} org - Organization
 * @param {string} site - Site (repo)
 * @param {string} ref - Git ref (default: 'main')
 * @returns {Promise<object>} - {siteToken, siteTokenExpiry} or {error}
 */
async function fetchAemSiteToken(org, site, ref = 'main') {
  const imsToken = await getImsToken(org, site);

  if (!imsToken) {
    return { error: 'Missing IMS access token' };
  }

  try {
    const body = JSON.stringify({
      org,
      site,
      ref,
      accessToken: imsToken,
    });

    console.log('[aem-token] Exchange request:', { org, site, ref, imsTokenLength: imsToken?.length });

    const resp = await fetch(`${AEM_ORIGIN}/auth/adobe/exchange`, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
    });

    console.log('[aem-token] Exchange response status:', resp.status, resp.statusText);

    if (!resp.ok) {
      const errorText = await resp.text();
      console.error('[aem-token] Exchange error response:', errorText);
      return { error: `Error fetch AEM Site Token ${resp.status}: ${errorText}` };
    }

    const responseText = await resp.text();
    console.log('[aem-token] Exchange response body:', responseText);

    const data = responseText ? JSON.parse(responseText) : {};
    console.log('[aem-token] Exchange response parsed:', data);

    const siteToken = data.siteToken || data.token;
    const siteTokenExpiry = data.siteTokenExpiry || data.tokenExpiry || 0;

    if (!siteToken) {
      console.error('[aem-token] Response data:', JSON.stringify(data));
      return { error: 'AEM Site Token missing from exchange response' };
    }

    return { siteToken, siteTokenExpiry };
  } catch (error) {
    return { error: `Exchange request failed: ${error.message}` };
  }
}

/**
 * Get AEM site token (cached with expiry check)
 * @param {string} org - Organization
 * @param {string} site - Site (repo)
 * @param {string} ref - Git ref (default: 'main')
 * @returns {Promise<string|null>} - Site token or null
 */
export async function getAemSiteToken(org, site, ref = 'main') {
  const key = getCacheKey(org, site, ref);
  const cached = tokenCache.get(key);

  // Check if cached token is still valid (expires in 1 hour, check with 5min buffer)
  if (cached?.siteToken && cached.siteTokenExpiry) {
    const now = Date.now();
    const expiresAt = cached.siteTokenExpiry;
    const buffer = 5 * 60 * 1000; // 5 minutes

    if (now < (expiresAt - buffer)) {
      console.log('[aem-token] Using cached AEM site token');
      return cached.siteToken;
    }
  }

  // Fetch new token
  console.log('[aem-token] Fetching new AEM site token');
  const result = await fetchAemSiteToken(org, site, ref);

  if (result.error) {
    console.error('[aem-token] Token exchange error:', result.error);
    tokenCache.delete(key);
    return null;
  }

  // Cache the token
  tokenCache.set(key, result);
  console.log('[aem-token] Cached new AEM site token');

  return result.siteToken;
}

/**
 * Clear cached AEM site token (on auth errors)
 * @param {string} org - Organization
 * @param {string} site - Site (repo)
 * @param {string} ref - Git ref (default: 'main')
 */
export function clearAemSiteToken(org, site, ref = 'main') {
  const key = getCacheKey(org, site, ref);
  tokenCache.delete(key);
  console.log('[aem-token] Cleared cached AEM site token');
}
