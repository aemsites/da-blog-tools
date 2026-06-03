/* eslint-disable import/no-unresolved */
import { daFetch, DA_ORIGIN, AEM_ADMIN } from './fetch.js';

const NX = 'https://da.live/nx';

const EXT_MIME_TYPES = {
  html: 'text/html',
  json: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

function cleanPath(pagePath, ext) {
  const withSlash = pagePath.startsWith('/') ? pagePath : `/${pagePath}`;
  return withSlash.replace(new RegExp(`\\.${ext}$`), '');
}

// `editUrlOrigin` builds the in-editor deep link returned to the UI. The dialog
// runs in a cross-origin iframe, so its init sets this to the real da.live host.
let editUrlOrigin = 'https://da.live';
export function setEditUrlOrigin(origin) { if (origin) editUrlOrigin = origin; }
export function getEditUrlOrigin() { return editUrlOrigin; }

let mergeCopyFn;
export function setMergeCopy(fn) { mergeCopyFn = fn; }
async function ensureMergeCopy() {
  if (!mergeCopyFn) {
    const mod = await import(`${NX}/blocks/loc/project/index.js`);
    mergeCopyFn = mod.mergeCopy;
  }
  return mergeCopyFn;
}

export async function previewSatellite(org, site, pagePath, ext = 'html') {
  const clean = cleanPath(pagePath, ext);
  const aemPath = ext === 'html' ? clean : `${clean}.${ext}`;
  const resp = await daFetch(`${AEM_ADMIN}/preview/${org}/${site}/main${aemPath}`, { method: 'POST' });
  if (!resp.ok) return { error: resp.headers?.get('x-error') || `Preview failed (${resp.status})` };
  return resp.json();
}

export async function publishSatellite(org, site, pagePath, ext = 'html') {
  const clean = cleanPath(pagePath, ext);
  const aemPath = ext === 'html' ? clean : `${clean}.${ext}`;
  const resp = await daFetch(`${AEM_ADMIN}/live/${org}/${site}/main${aemPath}`, { method: 'POST' });
  if (!resp.ok) return { error: resp.headers?.get('x-error') || `Publish failed (${resp.status})` };
  return resp.json();
}

export async function createOverride(org, baseSite, satellite, pagePath, ext = 'html') {
  const clean = cleanPath(pagePath, ext);
  const baseUrl = `${DA_ORIGIN}/source/${org}/${baseSite}${clean}.${ext}`;
  const resp = await daFetch(baseUrl);
  if (!resp.ok) return { error: `Failed to fetch base content (${resp.status})` };

  const content = await resp.blob();
  const mimeType = EXT_MIME_TYPES[ext] || 'application/octet-stream';
  const formData = new FormData();
  formData.append('data', new Blob([content], { type: mimeType }));

  const satUrl = `${DA_ORIGIN}/source/${org}/${satellite}${clean}.${ext}`;
  const saveResp = await daFetch(satUrl, { method: 'PUT', body: formData });
  if (!saveResp.ok) return { error: `Failed to create override (${saveResp.status})` };
  return { ok: true };
}

export async function deleteOverride(org, satellite, pagePath, ext = 'html') {
  const clean = cleanPath(pagePath, ext);
  const resp = await daFetch(`${DA_ORIGIN}/source/${org}/${satellite}${clean}.${ext}`, { method: 'DELETE' });
  if (!resp.ok) return { error: `Failed to delete override (${resp.status})` };
  return { ok: true };
}

export async function mergeFromBase(org, baseSite, satellite, pagePath, ext = 'html') {
  try {
    const clean = cleanPath(pagePath, ext);
    const mergeCopy = await ensureMergeCopy();
    const url = {
      source: `/${org}/${baseSite}${clean}.${ext}`,
      destination: `/${org}/${satellite}${clean}.${ext}`,
    };
    const result = await mergeCopy(url, 'MSM Merge');
    if (!result?.ok) return { error: 'Merge failed' };
    return { ok: true, editUrl: `${editUrlOrigin}/edit#/${org}/${satellite}${clean}` };
  } catch (e) {
    return { error: e.message || 'Merge failed' };
  }
}
