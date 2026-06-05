/* eslint-disable import/no-unresolved */
import {
  daFetch, DA_ORIGIN, AEM_ADMIN, PUBLISH_LAG_MS, cleanPath,
} from './fetch.js';

// HEAD a source file to learn whether it exists and its last-modified time.
export async function getPageTimestamp(org, site, pagePath, ext = 'html') {
  const clean = cleanPath(pagePath, ext);
  const resp = await daFetch(`${DA_ORIGIN}/source/${org}/${site}${clean}.${ext}`, { method: 'HEAD', cache: 'no-store' });
  return { exists: resp.ok, lastModified: resp.headers?.get('Last-Modified') || null };
}

// Rich publish status for a single page. `editLastModified` is the source
// timestamp used to decide whether the published preview/live copies are
// current or behind.
export async function getPageStatus(org, site, pagePath, editLastModified = null, ext = 'html') {
  const clean = cleanPath(pagePath, ext);
  const aemPath = ext === 'html' ? clean : `${clean}.${ext}`;
  const resp = await daFetch(`${AEM_ADMIN}/status/${org}/${site}/main${aemPath}`, { cache: 'no-store' });
  if (!resp.ok) {
    return {
      previewState: 'not-published', liveState: 'not-published', previewDate: null, liveDate: null,
    };
  }
  const json = await resp.json();

  const toTime = (v) => (v ? new Date(v).getTime() : null);
  const editTime = toTime(editLastModified);
  const previewTime = toTime(json.preview?.lastModified);
  const liveTime = toTime(json.live?.lastModified);

  let previewState;
  if (json.preview?.status !== 200) {
    previewState = 'not-published';
  } else if (editTime !== null && previewTime !== null && editTime > previewTime + PUBLISH_LAG_MS) {
    previewState = 'behind';
  } else {
    previewState = 'current';
  }

  let liveState;
  if (json.live?.status !== 200) {
    liveState = 'not-published';
  } else if (
    (previewTime !== null && liveTime !== null && previewTime > liveTime)
    || (editTime !== null && liveTime !== null && editTime > liveTime + PUBLISH_LAG_MS)
  ) {
    liveState = 'behind';
  } else {
    liveState = 'current';
  }

  return {
    previewState,
    liveState,
    previewDate: json.preview?.lastModified || null,
    liveDate: json.live?.lastModified || null,
  };
}

// Maps link + publish state to a status icon. Returns { name, color, tip }.
export function getStatusConfig({
  isDetached, outOfSync, previewState, liveState,
}) {
  const green = (tip) => ({ name: 'S2_Icon_CheckmarkCircle_20_N', color: 'var(--s2-green-700,#0ba45d)', tip });
  const amber = (tip) => ({ name: 'S2_Icon_AlertTriangle_20_N', color: 'var(--s2-yellow-700,#e68619)', tip });
  const orange = (tip) => ({ name: 'S2_Icon_AlertTriangle_20_N', color: 'var(--s2-orange-600,#fc7d00)', tip });
  const red = (tip) => ({ name: 'S2_Icon_AlertDiamond_20_N', color: 'var(--s2-red-700,#ff513d)', tip });

  if (!isDetached) {
    if (liveState === 'current') return green('Live and current');
    if (previewState === 'current') return amber('Previewed — not yet published to live');
    if (liveState === 'not-published' && previewState === 'not-published') return red('Not published');
    return red('Source changed — publish needed');
  }

  if (outOfSync) {
    if (liveState === 'current') return orange('Behind source — changed since last sync');
    return red('Behind source — needs sync and publish');
  }
  if (liveState === 'current') return green('Live and current');
  if (previewState === 'current') return amber('Previewed — not yet published to live');
  return red('Not yet previewed or published');
}
