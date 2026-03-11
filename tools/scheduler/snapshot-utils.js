/**
 * AEM Snapshot API utilities - same APIs as snapshot-admin tool
 * @see https://www.aem.live/docs/admin.html#tag/snapshot
 */

const AEM_ORIGIN = 'https://admin.hlx.page';
const SNAPSHOT_SCHEDULER_API = 'https://helix-snapshot-scheduler-ci.adobeaem.workers.dev';
const CORS_PROXY = 'https://da-etc.adobeaem.workers.dev/cors';

const { daFetch } = await import('https://da.live/nx/utils/daFetch.js');

/**
 * @param {string} org - Organization name
 * @param {string} site - Site/repo name
 * @param {string} [token] - Optional auth token for DA context
 */
function getOpts(token) {
  const opts = { credentials: 'include' };
  if (token) {
    opts.headers = { Authorization: `Bearer ${token}` };
  }
  return opts;
}

/**
 * List snapshots
 * GET /snapshot/{org}/{site}/main
 */
export async function fetchSnapshots(org, site, token) {
  const resp = await fetch(`${AEM_ORIGIN}/snapshot/${org}/${site}/main`, getOpts(token));
  if (!resp.ok) return { error: resp.statusText, status: resp.status };
  const json = await resp.json();
  return { snapshots: json.snapshots || [], status: resp.status };
}

/**
 * Get snapshot manifest
 * GET /snapshot/{org}/{site}/main/{snapshotId}
 */
export async function fetchManifest(org, site, snapshotId, token) {
  const resp = await fetch(`${AEM_ORIGIN}/snapshot/${org}/${site}/main/${snapshotId}`, getOpts(token));
  if (!resp.ok) return { error: resp.statusText, status: resp.status };
  const { manifest } = await resp.json();
  return { manifest, status: resp.status };
}

/**
 * Update snapshot manifest (create or update)
 * POST /snapshot/{org}/{site}/main/{snapshotId}
 */
export async function saveManifest(org, site, snapshotId, manifestToSave, token) {
  const baseOpts = getOpts(token);
  const opts = {
    ...baseOpts,
    method: 'POST',
    headers: {
      ...(baseOpts.headers || {}),
      'Content-Type': 'application/json',
    },
  };
  if (manifestToSave) {
    opts.body = JSON.stringify(manifestToSave);
  }
  const resp = await fetch(`${AEM_ORIGIN}/snapshot/${org}/${site}/main/${snapshotId}`, opts);
  if (!resp.ok) return { error: resp.statusText, status: resp.status };
  const { manifest } = await resp.json();
  return { manifest, status: resp.status };
}

/**
 * Update preview - fetches latest content from source and stores in preview.
 * Required before adding a page to a snapshot.
 * POST /preview/{org}/{site}/main/{path}
 * Uses daFetch + CORS proxy (matches publish-requests-inbox) for reliable auth.
 */
export async function previewPage(org, site, path) {
  const pathForUrl = path.startsWith('/') ? path : `/${path}`;
  const targetUrl = `${AEM_ORIGIN}/preview/${org}/${site}/main${pathForUrl}`;
  const url = `${CORS_PROXY}?url=${encodeURIComponent(targetUrl)}`;
  const resp = await daFetch(url, { method: 'POST' });
  return resp;
}

/**
 * Add resources to snapshot (bulk)
 * POST /snapshot/{org}/{site}/main/{snapshotId}/*
 */
export async function addToSnapshot(org, site, snapshotId, paths, token) {
  const baseOpts = getOpts(token);
  const resp = await fetch(`${AEM_ORIGIN}/snapshot/${org}/${site}/main/${snapshotId}/*`, {
    ...baseOpts,
    method: 'POST',
    headers: {
      ...(baseOpts.headers || {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ paths }),
  });
  return resp;
}

/**
 * Change snapshot review state (request=lock, approve=publish, reject=unlock)
 * POST /snapshot/{org}/{site}/main/{snapshotId}?review=request|approve|reject
 * Matches snapshot-admin: sends body with review and message (API may require it)
 */
export async function reviewSnapshot(org, site, snapshotId, state, token) {
  const baseOpts = getOpts(token);
  const message = `Snapshot ${snapshotId} review ${state}`;
  const resp = await fetch(
    `${AEM_ORIGIN}/snapshot/${org}/${site}/main/${snapshotId}?review=${state}`,
    {
      ...baseOpts,
      method: 'POST',
      headers: {
        ...(baseOpts.headers || {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ review: state, message }),
    },
  );
  if (!resp.ok) return { error: resp.statusText, status: resp.status };
  return { success: true, status: resp.status };
}

/**
 * Publish snapshot
 * POST /snapshot/{org}/{site}/main/{snapshotId}?publish=true
 */
export async function publishSnapshot(org, site, snapshotId, token) {
  const resp = await fetch(
    `${AEM_ORIGIN}/snapshot/${org}/${site}/main/${snapshotId}?publish=true`,
    {
      ...getOpts(token),
      method: 'POST',
    },
  );
  return resp;
}

/**
 * Update scheduled publish time in helix-snapshot-scheduler
 * POST /schedule with body { org, site, snapshotId }
 */
export async function updateScheduledPublish(org, site, snapshotId, token) {
  const body = { org, site, snapshotId };
  const opts = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
  if (token) {
    opts.headers.Authorization = `Bearer ${token}`;
  }
  const resp = await fetch(`${SNAPSHOT_SCHEDULER_API}/schedule`, opts);
  const result = resp.headers.get('X-Error');
  return { status: resp.status, text: result };
}

/**
 * Check if org/site is registered for snapshot scheduler
 * GET /register/{org}/{site}
 */
export async function isRegisteredForSnapshotScheduler(org, site) {
  try {
    const resp = await fetch(`${SNAPSHOT_SCHEDULER_API}/register/${org}/${site}`);
    return resp.status === 200;
  } catch (error) {
    console.error('Error checking snapshot scheduler registration', error);
    return false;
  }
}

/**
 * Delete snapshot resources (use '/*' to clear all)
 * DELETE /snapshot/{org}/{site}/main/{snapshotId}/{path}
 */
export async function deleteSnapshotPaths(org, site, snapshotId, paths, token) {
  const baseOpts = getOpts(token);
  const results = await Promise.all(paths.map(async (path) => {
    const resp = await fetch(
      `${AEM_ORIGIN}/snapshot/${org}/${site}/main/${snapshotId}${path}`,
      { ...baseOpts, method: 'DELETE' },
    );
    return { ok: resp.ok, status: resp.status };
  }));
  return results;
}

/**
 * Delete a snapshot
 * DELETE /snapshot/{org}/{site}/main/{snapshotId}
 * Snapshot must be empty and unlocked.
 */
export async function deleteSnapshot(org, site, snapshotId, token) {
  const resp = await fetch(
    `${AEM_ORIGIN}/snapshot/${org}/${site}/main/${snapshotId}`,
    { ...getOpts(token), method: 'DELETE' },
  );
  return { ok: resp.ok, status: resp.status };
}

/**
 * Get scheduled publishes for org/site
 * GET /schedule/{org}/{site}
 */
export async function getScheduledPublishes(org, site, token) {
  try {
    const opts = token ? { headers: { Authorization: `Bearer ${token}` } } : {};
    const resp = await fetch(`${SNAPSHOT_SCHEDULER_API}/schedule/${org}/${site}`, opts);
    if (!resp.ok) return [];
    const data = await resp.json();
    const orgSiteKey = `${org}--${site}`;
    // API returns { "org--site": { snapshotId: { scheduledPublish: "ISO8601", ... } } } or { snapshotId: "ISO8601" }
    const scheduleObj = data[orgSiteKey] ?? (typeof data === 'object' && data !== null && !Array.isArray(data) ? data : {});
    return Object.entries(scheduleObj).flatMap(([snapshotId, v]) => {
      const scheduledTime = typeof v === 'string' ? v : v?.scheduledPublish;
      return scheduledTime ? [{ snapshotId, scheduledTime }] : [];
    });
  } catch (error) {
    console.error('Error fetching scheduled publishes', error);
    return [];
  }
}
