/* eslint-disable import/no-unresolved */
import { DA_ORIGIN } from 'https://da.live/nx/public/utils/constants.js';

const AEM_ADMIN = 'https://admin.hlx.page';

// NX origin used to dynamically load the `mergeCopy` function. Kept as a
// runtime constant so the plugin can be repointed at a different NX build
// (e.g. for staging) without code changes elsewhere.
const NX = 'https://da.live/nx';

// SDK plumbing. The plugin runs inside an iframe served from a different
// origin than da.live, so it can't use IMS-backed fetch directly. The host
// page hands us `actions.daFetch` via DA_SDK and we route every authenticated
// request through it. `setSdkFetch` is called once during plugin init.
let sdkFetch;
export function setSdkFetch(fn) { sdkFetch = fn; }
function daFetch(url, opts) {
  if (!sdkFetch) throw new Error('MSM plugin: SDK daFetch not initialised');
  return sdkFetch(url, opts);
}

export async function previewSatellite(org, satellite, pagePath) {
  const aemPath = pagePath.replace('.html', '');
  const url = `${AEM_ADMIN}/preview/${org}/${satellite}/main${aemPath}`;
  const resp = await daFetch(url, { method: 'POST' });
  if (!resp.ok) {
    const xError = resp.headers?.get('x-error') || `Preview failed (${resp.status})`;
    return { error: xError };
  }
  return resp.json();
}

export async function publishSatellite(org, satellite, pagePath) {
  const aemPath = pagePath.replace('.html', '');
  const url = `${AEM_ADMIN}/live/${org}/${satellite}/main${aemPath}`;
  const resp = await daFetch(url, { method: 'POST' });
  if (!resp.ok) {
    const xError = resp.headers?.get('x-error') || `Publish failed (${resp.status})`;
    return { error: xError };
  }
  return resp.json();
}

export async function createOverride(org, base, satellite, pagePath) {
  const basePath = `${DA_ORIGIN}/source/${org}/${base}${pagePath}.html`;
  const resp = await daFetch(basePath);
  if (!resp.ok) return { error: `Failed to fetch base content (${resp.status})` };

  const html = await resp.text();
  const blob = new Blob([html], { type: 'text/html' });
  const formData = new FormData();
  formData.append('data', blob);

  const satPath = `${DA_ORIGIN}/source/${org}/${satellite}${pagePath}.html`;
  const saveResp = await daFetch(satPath, { method: 'PUT', body: formData });
  if (!saveResp.ok) return { error: `Failed to create override (${saveResp.status})` };
  return { ok: true };
}

export async function getSatellitePageStatus(org, satellite, pagePath, editLastModified = null) {
  const aemPath = pagePath.replace('.html', '');
  const resp = await daFetch(`${AEM_ADMIN}/status/${org}/${satellite}/main${aemPath}`);

  if (!resp.ok) return { previewState: 'not-rolled-out', liveState: 'not-rolled-out' };
  const json = await resp.json();

  const editTime = editLastModified ? new Date(editLastModified).getTime() : null;
  const previewTime = json.preview?.lastModified
    ? new Date(json.preview.lastModified).getTime() : null;
  const liveTime = json.live?.lastModified
    ? new Date(json.live.lastModified).getTime() : null;

  let previewState;
  if (json.preview?.status !== 200) {
    previewState = 'not-rolled-out';
  } else if (editTime !== null && previewTime !== null && editTime > previewTime) {
    previewState = 'behind';
  } else {
    previewState = 'current';
  }

  let liveState;
  if (json.live?.status !== 200) {
    liveState = 'not-rolled-out';
  } else if (previewTime !== null && liveTime !== null && previewTime > liveTime) {
    liveState = 'behind';
  } else {
    liveState = 'current';
  }

  return { previewState, liveState };
}

export async function deleteOverride(org, satellite, pagePath) {
  const satPath = `${DA_ORIGIN}/source/${org}/${satellite}${pagePath}.html`;
  const resp = await daFetch(satPath, { method: 'DELETE' });
  if (!resp.ok) return { error: `Failed to delete override (${resp.status})` };
  return { ok: true };
}

let mergeCopyFn;
export function setMergeCopy(fn) { mergeCopyFn = fn; }

// `editUrlOrigin` is the origin used to build the in-editor deep link returned
// to the UI. In the OOTB da-live build it was `window.location.origin`, but
// the plugin's iframe is served from a different origin, so the caller (or
// init code) sets this to the actual da.live host the user is editing on.
let editUrlOrigin = 'https://da.live';
export function setEditUrlOrigin(origin) {
  if (origin) editUrlOrigin = origin;
}
export function getEditUrlOrigin() { return editUrlOrigin; }

export async function mergeFromBase(org, base, satellite, pagePath) {
  try {
    const mergeCopy = mergeCopyFn
      || (await import(`${NX}/blocks/loc/project/index.js`)).mergeCopy;

    const url = {
      source: `/${org}/${base}${pagePath}.html`,
      destination: `/${org}/${satellite}${pagePath}.html`,
    };

    const result = await mergeCopy(url, 'MSM Merge');
    if (!result?.ok) return { error: 'Merge failed' };

    const editUrl = `${editUrlOrigin}/edit#/${org}/${satellite}${pagePath}`;
    return { ok: true, editUrl };
  } catch (e) {
    return { error: e.message || 'Merge failed' };
  }
}
