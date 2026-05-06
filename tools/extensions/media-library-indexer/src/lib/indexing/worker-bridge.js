/**
 * Bridge between Chrome extension service worker and da-nx indexing functions
 * Directly imports indexing functions from da.live (no web worker needed)
 */

// Direct imports from da.live CDN
import { buildFullIndex as buildFullIndexDaNx } from 'https://da.live/nx/blocks/media-library/indexing/worker/full.js';
import { buildIncrementalIndex as buildIncrementalIndexDaNx } from 'https://da.live/nx/blocks/media-library/indexing/worker/incremental.js';
import { getImsToken } from '../../adapters/auth-adapter.js';

const DA_ORIGIN = 'https://admin.da.live';
const DA_ETC_ORIGIN = 'https://da-etc.adobeaem.workers.dev';
const AEM_ORIGIN = 'https://admin.hlx.page';

/**
 * Build full index using da-nx functions directly (no worker)
 *
 * @param {string} org - Organization name
 * @param {string} repo - Repository name
 * @param {Function} onProgress - Progress callback (optional)
 * @returns {Promise<Array>} Media entries (98 entries with complete implementation)
 */
export async function buildFullIndex(org, repo, onProgress) {
  const imsToken = await getImsToken(org, repo);

  if (!imsToken) {
    throw new Error('[worker-bridge] No IMS token available');
  }

  // eslint-disable-next-line no-console
  console.log(`[worker-bridge] Starting full index build for ${org}/${repo}`);

  const sitePath = `/${org}/${repo}`;

  // Read debug setting from storage
  const { debugPerf = false } = await chrome.storage.local.get('debugPerf');

  // Prepare context for da-nx function
  const context = {
    imsToken,
    siteToken: null,
    daOrigin: DA_ORIGIN,
    daEtcOrigin: DA_ETC_ORIGIN, // CORS proxy needed for .aem.page fetches
    aemOrigin: AEM_ORIGIN,
    isPerfEnabled: debugPerf, // Controlled by user setting (matches da-nx ?debug=perf)
    IndexConfig: {
      API_PAGE_SIZE: 1000,
      STATUS_POLL_INTERVAL_MS: 1000,
      STATUS_POLL_MAX_DURATION_MS: 600000, // 10 minutes
      MAX_CONCURRENT_PAGE_FETCHES: 10,
      USAGE_MAP_PROGRESSIVE_BATCH_SIZE: 2000,
      DISCOVERY_SMALL_SITE_THRESHOLD: 20000,
      DISCOVERY_TARGET_PATHS_PER_JOB: 10000,
      DISCOVERY_MAX_PATHS_PER_JOB: 250,
    },
  };

  // Progress callback wrapper
  const onProgressWrapper = (progressData) => {
    // eslint-disable-next-line no-console
    console.log('[worker-bridge] Progress:', progressData);
    onProgress?.(progressData);
  };

  // Progressive data callback (batches of media during build)
  const onProgressiveData = (mediaData) => {
    // eslint-disable-next-line no-console
    console.log(`[worker-bridge] Progressive: ${mediaData?.length || 0} entries`);
  };

  try {
    const result = await buildFullIndexDaNx(
      sitePath,
      org,
      repo,
      'main',
      onProgressWrapper,
      onProgressiveData,
      context,
    );

    // eslint-disable-next-line no-console
    console.log(`[worker-bridge] Build complete: ${result?.length || 0} entries`);

    return result;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[worker-bridge] Build failed:', error);
    throw error;
  }
}

/**
 * Build incremental index using da-nx functions directly (no worker)
 * Note: Incremental reads lastFetchTime from index-meta.json internally
 *
 * @param {string} org - Organization name
 * @param {string} repo - Repository name
 * @param {Function} onProgress - Progress callback (optional)
 * @returns {Promise<Array>} Media entries
 */
export async function buildIncrementalIndex(org, repo, onProgress) {
  const imsToken = await getImsToken(org, repo);

  if (!imsToken) {
    throw new Error('[worker-bridge] No IMS token available');
  }

  // eslint-disable-next-line no-console
  console.log(`[worker-bridge] Starting incremental build for ${org}/${repo}`);

  const sitePath = `/${org}/${repo}`;

  // Read debug setting from storage
  const { debugPerf = false } = await chrome.storage.local.get('debugPerf');

  const context = {
    imsToken,
    siteToken: null,
    daOrigin: DA_ORIGIN,
    daEtcOrigin: DA_ETC_ORIGIN, // CORS proxy needed for .aem.page fetches
    aemOrigin: AEM_ORIGIN,
    isPerfEnabled: debugPerf, // Controlled by user setting (matches da-nx ?debug=perf)
    IndexConfig: {
      API_PAGE_SIZE: 1000,
      STATUS_POLL_INTERVAL_MS: 1000,
      STATUS_POLL_MAX_DURATION_MS: 600000,
      MAX_CONCURRENT_PAGE_FETCHES: 10,
    },
  };

  const onProgressWrapper = (progressData) => {
    // eslint-disable-next-line no-console
    console.log('[worker-bridge] Progress:', progressData);
    onProgress?.(progressData);
  };

  const onLog = (message) => {
    // eslint-disable-next-line no-console
    console.log('[worker-bridge] Log:', message);
  };

  const onProgressiveData = (mediaData) => {
    // eslint-disable-next-line no-console
    console.log(`[worker-bridge] Progressive: ${mediaData?.length || 0} entries`);
  };

  try {
    // Incremental signature:
    // (sitePath, org, repo, ref, onProgress, onLog, onProgressiveData, context)
    const result = await buildIncrementalIndexDaNx(
      sitePath,
      org,
      repo,
      'main',
      onProgressWrapper,
      onLog,
      onProgressiveData,
      context,
    );

    // eslint-disable-next-line no-console
    console.log(`[worker-bridge] Incremental build complete: ${result?.length || 0} entries`);

    return result;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[worker-bridge] Incremental build failed:', error);
    throw error;
  }
}

/**
 * Terminate worker (no-op since we're not using a worker anymore)
 */
export async function terminateWorker() {
  // No-op - not using worker anymore
  // eslint-disable-next-line no-console
  console.log('[worker-bridge] terminateWorker called (no-op without worker)');
}
