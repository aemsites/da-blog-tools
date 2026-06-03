/* eslint-disable import/no-unresolved */

// Thin adapter over the shared MSM core. See config.js for the fetch-injection
// rationale.

export { setDaFetch as setSdkFetch } from '../../apps/msm/core/fetch.js';
export {
  previewPage,
  publishPage,
  copyFromSource,
  deleteCopy,
  mergeFromSource,
  setEditUrlOrigin,
  getEditUrlOrigin,
  setMergeCopy,
} from '../../apps/msm/core/operations.js';
export { getPageStatus, getStatusConfig } from '../../apps/msm/core/status.js';
