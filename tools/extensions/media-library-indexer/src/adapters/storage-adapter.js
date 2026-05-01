/**
 * Storage adapter for Chrome extension
 * Wraps chrome.storage.local to match localStorage interface
 */

/**
 * Get item from chrome.storage.local
 * @param {string} key - Storage key
 * @returns {Promise<string|null>} - Stored value or null
 */
export async function getItem(key) {
  if (!key) throw new Error('Storage key is required');

  try {
    const result = await chrome.storage.local.get(key);
    return result[key] ?? null;
  } catch (error) {
    console.error('[storage-adapter] getItem failed:', error);
    return null;
  }
}

/**
 * Set item in chrome.storage.local
 * @param {string} key - Storage key
 * @param {string} value - Value to store
 * @returns {Promise<void>}
 */
export async function setItem(key, value) {
  if (!key) throw new Error('Storage key is required');

  try {
    await chrome.storage.local.set({ [key]: value });
  } catch (error) {
    console.error('[storage-adapter] setItem failed:', error);
    throw error;
  }
}

/**
 * Remove item from chrome.storage.local
 * @param {string} key - Storage key
 * @returns {Promise<void>}
 */
export async function removeItem(key) {
  if (!key) throw new Error('Storage key is required');

  try {
    await chrome.storage.local.remove(key);
  } catch (error) {
    console.error('[storage-adapter] removeItem failed:', error);
    throw error;
  }
}

/**
 * Get all sites from storage
 * @returns {Promise<Array<object>>} - Array of site objects
 */
export async function getSites() {
  try {
    const { sites } = await chrome.storage.local.get('sites');
    return Array.isArray(sites) ? sites : [];
  } catch (error) {
    console.error('[storage-adapter] getSites failed:', error);
    return [];
  }
}

/**
 * Save all sites to storage
 * @param {Array<object>} sites - Array of site objects
 * @returns {Promise<void>}
 */
export async function setSites(sites) {
  if (!Array.isArray(sites)) throw new Error('Sites must be an array');

  try {
    await chrome.storage.local.set({ sites });
  } catch (error) {
    console.error('[storage-adapter] setSites failed:', error);
    throw error;
  }
}

/**
 * Get single site by sitePath
 * @param {string} sitePath - Site path (e.g., '/org/repo')
 * @returns {Promise<object|null>} - Site object or null
 */
export async function getSite(sitePath) {
  if (!sitePath) throw new Error('Site path is required');

  const sites = await getSites();
  return sites.find(s => s?.sitePath === sitePath) || null;
}

/**
 * Update single site in storage
 * @param {object} updatedSite - Site object with updates (must have sitePath property)
 * @returns {Promise<void>}
 */
export async function updateSite(updatedSite) {
  if (!updatedSite || !updatedSite.sitePath) {
    throw new Error('Updated site must have sitePath property');
  }

  const sites = await getSites();
  const index = sites.findIndex(s => s?.sitePath === updatedSite.sitePath);

  if (index >= 0) {
    sites[index] = { ...sites[index], ...updatedSite };
  } else {
    sites.push(updatedSite);
  }

  await setSites(sites);
}

/**
 * Remove site from storage
 * @param {string} sitePath - Site path to remove
 * @returns {Promise<void>}
 */
export async function removeSite(sitePath) {
  if (!sitePath) throw new Error('Site path is required');

  const sites = await getSites();
  const filtered = sites.filter(s => s?.sitePath !== sitePath);
  await setSites(filtered);
}
