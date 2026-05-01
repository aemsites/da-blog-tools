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
  const result = await chrome.storage.local.get(key);
  return result[key] ?? null;
}

/**
 * Set item in chrome.storage.local
 * @param {string} key - Storage key
 * @param {string} value - Value to store
 * @returns {Promise<void>}
 */
export async function setItem(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

/**
 * Remove item from chrome.storage.local
 * @param {string} key - Storage key
 * @returns {Promise<void>}
 */
export async function removeItem(key) {
  await chrome.storage.local.remove(key);
}

/**
 * Get all sites from storage
 * @returns {Promise<Array>} - Array of site objects
 */
export async function getSites() {
  const { sites } = await chrome.storage.local.get('sites');
  return sites || [];
}

/**
 * Save all sites to storage
 * @param {Array} sites - Array of site objects
 * @returns {Promise<void>}
 */
export async function setSites(sites) {
  await chrome.storage.local.set({ sites });
}

/**
 * Get single site by sitePath
 * @param {string} sitePath - Site path (e.g., '/org/repo')
 * @returns {Promise<object|null>} - Site object or null
 */
export async function getSite(sitePath) {
  const sites = await getSites();
  return sites.find(s => s.sitePath === sitePath) || null;
}

/**
 * Update single site in storage
 * @param {object} updatedSite - Site object with updates
 * @returns {Promise<void>}
 */
export async function updateSite(updatedSite) {
  const sites = await getSites();
  const index = sites.findIndex(s => s.sitePath === updatedSite.sitePath);

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
  const sites = await getSites();
  const filtered = sites.filter(s => s.sitePath !== sitePath);
  await setSites(filtered);
}
