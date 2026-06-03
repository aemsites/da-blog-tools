/* eslint-disable import/no-unresolved */

// Thin adapter over the shared MSM core. See config.js for the fetch-injection
// rationale. `getSatellitePageStatus` is the core's rich `getPageStatus`.

export { setDaFetch as setSdkFetch } from '../../apps/msm/core/fetch.js';
export {
  previewSatellite,
  publishSatellite,
  createOverride,
  deleteOverride,
  mergeFromBase,
  setEditUrlOrigin,
  getEditUrlOrigin,
  setMergeCopy,
} from '../../apps/msm/core/operations.js';
export { getPageStatus as getSatellitePageStatus, getStatusConfig } from '../../apps/msm/core/status.js';
