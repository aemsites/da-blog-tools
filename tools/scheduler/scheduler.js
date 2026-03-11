/* eslint-disable import/no-absolute-path */
/* eslint-disable no-console */
/* eslint-disable eol-last */
/* eslint-disable import/no-unresolved */

// Import SDK for Document Authoring
import DA_SDK from 'https://da.live/nx/utils/sdk.js';

import {
  fetchSnapshots,
  fetchManifest,
  saveManifest,
  previewPage,
  addToSnapshot,
  reviewSnapshot,
  updateScheduledPublish,
  getScheduledPublishes,
  deleteSnapshotPaths,
  deleteSnapshot,
} from './snapshot-utils.js';

// Combine message handling into a single utility
const messageUtils = {
  container: document.querySelector('.message-wrapper'),
  show(text, isError = false) {
    const message = this.container.querySelector('.message');
    message.innerHTML = text.replace(/\r?\n/g, '<br>');
    message.classList.toggle('error', isError);
  },
  setLoading(loading) {
    this.container.classList.toggle('loading', loading);
    this.container.classList.toggle('regular', !loading);
  },
};

/**
 * Generates a unique snapshot ID for scheduled publish
 * @param {string} path - Page path
 * @param {Date} scheduleDate - Scheduled date
 * @returns {string}
 */
function generateSnapshotId(path, scheduleDate) {
  const pathSlug = path.replace(/^\/|\/$/g, '').replace(/[/.]/g, '-') || 'page';
  const timestamp = scheduleDate.getTime();
  return `da-schedule-${pathSlug}-${timestamp}`;
}

/**
 * Schedules a publish via the AEM Snapshot API
 * @param {string} org - Organization
 * @param {string} site - Site/repo
 * @param {string} path - Page path
 * @param {Date} scheduleDate - When to publish
 * @param {string} token - Auth token
 * @returns {Promise<boolean>}
 */
async function schedulePublishViaSnapshot(org, site, path, scheduleDate, token) {
  const snapshotId = generateSnapshotId(path, scheduleDate);

  // 1. Create snapshot with empty manifest
  const createResult = await saveManifest(org, site, snapshotId, {
    title: `Scheduled publish: ${path}`,
    description: `Auto-created by Scheduler for ${path} at ${scheduleDate.toISOString()}`,
    resources: [],
    metadata: {
      scheduledPublish: scheduleDate.toISOString(),
    },
  }, token);

  if (createResult.error) {
    messageUtils.show(`Failed to create snapshot: ${createResult.error}`, true);
    return false;
  }

  // 2. Preview the page (required before adding to snapshot)
  const previewResp = await previewPage(org, site, path);
  if (!previewResp.ok) {
    messageUtils.show(`Failed to preview page: ${previewResp.status}. Ensure the page is saved and try again.`, true);
    return false;
  }

  // 3. Add the page path to the snapshot
  const addResp = await addToSnapshot(org, site, snapshotId, [path], token);
  if (!addResp.ok) {
    messageUtils.show(`Failed to add page to snapshot: ${addResp.status}`, true);
    return false;
  }

  // 4. Lock the snapshot (request review) so it's ready for publish
  const reviewResult = await reviewSnapshot(org, site, snapshotId, 'request', token);
  if (reviewResult.error && reviewResult.status !== 409) {
    messageUtils.show(`Failed to lock snapshot: ${reviewResult.error}`, true);
    return false;
  }
  // 409 = already locked (e.g. retry) - desired state, continue

  // 5. Register with helix-snapshot-scheduler (metadata.scheduledPublish is already in manifest from step 1)
  const scheduleResult = await updateScheduledPublish(org, site, snapshotId, token);
  if (scheduleResult.status !== 200) {
    messageUtils.show(`Failed to register schedule: ${scheduleResult.text || scheduleResult.status}`, true);
    return false;
  }

  return true;
}

/**
 * Shows current schedules (from snapshot scheduler) for the site
 * @param {string} _path - Current page path (unused; we show all site schedules)
 * @param {Array} schedules - Array of { snapshotId, scheduledTime }
 */
function showCurrentSchedule(_path, schedules) {
  const content = document.querySelector('.schedule-content');

  if (!schedules || schedules.length === 0) {
    content.textContent = 'No active schedules found';
    return;
  }

  content.innerHTML = '';
  schedules.forEach((schedule) => {
    const row = document.createElement('div');
    row.className = 'schedule-row';

    const scheduleDate = new Date(schedule.scheduledTime);
    const timeFormatter = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    const dateFormatter = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

    row.textContent = `Publish at ${timeFormatter.format(scheduleDate)} on ${dateFormatter.format(scheduleDate)}`;
    content.appendChild(row);
  });
}

/**
 * Deletes scheduler-created snapshots whose scheduled publish time has passed
 */
async function cleanupOldScheduledSnapshots(org, site, token) {
  const snapshotsResult = await fetchSnapshots(org, site, token);
  if (snapshotsResult.error || !snapshotsResult.snapshots?.length) return;

  const now = new Date();
  const toDelete = snapshotsResult.snapshots.filter((name) => name.startsWith('da-schedule-'));

  for (const snapshotId of toDelete) {
    const manifestResult = await fetchManifest(org, site, snapshotId, token);
    if (manifestResult.error) continue;

    const scheduledPublish = manifestResult.manifest?.metadata?.scheduledPublish;
    if (!scheduledPublish || new Date(scheduledPublish) > now) continue;

    try {
      // Unlock first (reject). If 400/409, snapshot may already be approved/unlocked by scheduler
      const reviewResult = await reviewSnapshot(org, site, snapshotId, 'reject', token);
      if (reviewResult.error && reviewResult.status !== 400 && reviewResult.status !== 409) {
        console.error(`Failed to unlock snapshot ${snapshotId}:`, reviewResult.error);
        continue;
      }
      const deletePathsResult = await deleteSnapshotPaths(org, site, snapshotId, ['/*'], token);
      if (deletePathsResult.some((r) => !r.ok)) continue;
      await deleteSnapshot(org, site, snapshotId, token);
    } catch (err) {
      console.error(`Failed to delete old snapshot ${snapshotId}:`, err);
    }
  }
}

/**
 * Initializes the scheduler interface
 */
async function init() {
  const { context, token } = await DA_SDK;

  const org = context.org;
  const site = context.repo; // DA uses "repo", AEM snapshot API uses "site"

  await cleanupOldScheduledSnapshots(org, site, token);

  // Set page path
  const pageInput = document.getElementById('page-path');
  pageInput.value = context.path;

  const datetimeInput = document.getElementById('datetime-input');
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  datetimeInput.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const scheduleButton = document.querySelector('.schedule-button');
  scheduleButton.addEventListener('click', async (e) => {
    e.preventDefault();

    datetimeInput.classList.remove('input-empty');

    if (!datetimeInput.value) {
      datetimeInput.classList.add('input-empty');
      messageUtils.show('Please select a date and time', true);
      return;
    }

    const scheduleDate = new Date(datetimeInput.value);
    if (scheduleDate <= new Date()) {
      datetimeInput.classList.add('input-empty');
      messageUtils.show('Please select a future date and time', true);
      return;
    }

    // Snapshot scheduler requires at least 5 minutes from now
    const minSchedule = new Date(Date.now() + 5 * 60 * 1000);
    if (scheduleDate < minSchedule) {
      datetimeInput.classList.add('input-empty');
      messageUtils.show('Scheduled publish must be at least 5 minutes from now', true);
      return;
    }

    messageUtils.show('Scheduling publish...');
    messageUtils.setLoading(true);

    const success = await schedulePublishViaSnapshot(org, site, context.path, scheduleDate, token);

    messageUtils.setLoading(false);
    if (success) {
      messageUtils.show('');
      const schedules = await getScheduledPublishes(org, site, token);
      showCurrentSchedule(context.path, schedules);
    }
  });

  // Load and display existing schedules
  const schedules = await getScheduledPublishes(org, site, token);
  showCurrentSchedule(context.path, schedules);
}

init();
