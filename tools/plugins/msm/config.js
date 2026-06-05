/* eslint-disable import/no-unresolved */

// Thin adapter over the shared MSM core. The dialog runs in a cross-origin
// iframe and must route fetches through the host's `actions.daFetch`, which it
// injects via `setSdkFetch` (re-exported as the core fetch setter).

export { setDaFetch as setSdkFetch } from '../../apps/msm/core/fetch.js';
export {
  getSiteConfig,
  getLinkedTree,
  getSubtreeLinked,
  getLinkedSites,
  getSourceSite,
  clearMsmCache,
} from '../../apps/msm/core/config.js';
export { getPageTimestamp } from '../../apps/msm/core/status.js';
