/* eslint-disable import/no-unresolved */

// Shared authenticated-fetch shim for MSM core.
//
// Two consumers, two fetch sources:
//   - The MSM app runs on da.live and can import da.live's `daFetch` directly.
//     It needs no setup — the lazy default below loads it on first use.
//   - The MSM dialog runs in a cross-origin iframe and must route requests
//     through the host-provided `actions.daFetch`. It calls `setDaFetch` once
//     during init to inject that function.
let daFetchFn = null;

export function setDaFetch(fn) {
  daFetchFn = fn;
}

export async function daFetch(url, opts) {
  if (!daFetchFn) {
    const { daFetch: fn } = await import('https://da.live/nx/utils/daFetch.js');
    daFetchFn = fn;
  }
  return daFetchFn(url, opts);
}

export const DA_ORIGIN = 'https://admin.da.live';
export const AEM_ADMIN = 'https://admin.hlx.page';

// Publishing bumps a page's lastModified after its publish timestamp is
// recorded, producing a spurious "out of sync" signal. This absorbs that lag.
export const PUBLISH_LAG_MS = 5000;

// Normalize a page path for use in API URLs: add leading slash, strip the
// given extension. Called by status and operations before building URLs.
export function cleanPath(pagePath, ext) {
  const withSlash = pagePath.startsWith('/') ? pagePath : `/${pagePath}`;
  return withSlash.replace(new RegExp(`\\.${ext}$`), '');
}
