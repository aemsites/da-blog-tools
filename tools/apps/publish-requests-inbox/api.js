/* eslint-disable import/no-unresolved, no-console, no-restricted-syntax */
/* eslint-disable no-continue, no-await-in-loop, prefer-destructuring */
// Worker URLs by environment
const WORKER_URLS = {
  local: 'http://localhost:8787',
  dev: 'https://publish-requests.aem-poc-lab.workers.dev',
  prod: 'https://publish-requests.aem-poc-lab.workers.dev',
};

const { getDaAdmin } = await import('https://da.live/nx/public/utils/constants.js');
const DA_ADMIN = getDaAdmin();

// DA sheet path for requests (read/written via Source API)
const REQUESTS_SHEET_PATH = '/.da/publish-workflow-requests.json';

// Config is read from the root repo/org config via DA Config API
// The publish-workflow-config and groups-to-email tabs live inside
// the root config at GET /config/{org}/{repo}/
// See: https://docs.da.live/developers/api/config#get-config

/**
 * Detect the current environment from URL or hostname
 * @returns {string} 'local', 'dev', or 'prod'
 */
function getEnvironment() {
  const hostname = window.location.hostname;

  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'local';
  }

  if (hostname.startsWith('main--')) {
    return 'prod';
  }

  return 'dev';
}

/**
 * Get the Worker URL for the current environment
 * @returns {string} Worker URL
 */
export function getWorkerUrl() {
  const env = getEnvironment();
  return WORKER_URLS[env] || WORKER_URLS.dev;
}

/**
 * Get request options with authorization header
 * @param {string} token - The authorization token
 * @param {string} method - HTTP method
 * @param {Object} body - Optional request body
 * @returns {Object} Fetch options object
 */
function getOpts(token, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) {
    opts.body = JSON.stringify(body);
  }
  return opts;
}

/**
 * Calculate the specificity of a pattern match against a path.
 * Higher values indicate a more specific (closer) match.
 * Matching priority: exact path > closest wildcard prefix > parent > root wildcard.
 * @param {string} path - The content path
 * @param {string} pattern - The pattern to score
 * @returns {number} Specificity score, or -1 if no match
 */
function getPatternSpecificity(path, pattern) {
  // Root-level wildcard — matches everything, lowest specificity
  if (pattern === '/*' || pattern === '*') return 0;

  // Wildcard prefix match (e.g., /drafts/rama/*)
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -2);
    if (path.startsWith(prefix)) {
      // Score by the number of segments in the prefix (more segments = more specific)
      return prefix.split('/').filter(Boolean).length;
    }
    return -1; // No match
  }

  // Exact match — highest specificity
  if (path === pattern) return 1000;

  return -1; // No match
}

/**
 * Find the best (most specific) matching rule for a given path.
 * Prioritizes closest match → parent match → root-level match.
 * @param {string} path - The content path
 * @param {Array} rules - Array of rule objects with Pattern/pattern fields
 * @returns {Object|null} The best matching rule, or null if none match
 */
function findBestMatchingRule(path, rules) {
  let bestRule = null;
  let bestSpecificity = -1;

  for (const rule of rules) {
    const pattern = rule.Pattern || rule.pattern;
    if (!pattern) continue;

    const specificity = getPatternSpecificity(path, pattern);
    if (specificity > bestSpecificity) {
      bestSpecificity = specificity;
      bestRule = rule;
    }
  }

  return bestRule;
}

/**
 * Resolve approvers list by expanding distribution list (DL) groups to individual
 * emails using the groups-to-email mapping from the config sheet.
 * @param {string[]} approversList - Raw approver entries (may include DL names)
 * @param {Array<{group: string, email: string}>} groupsData - Group-to-email mappings
 * @returns {string[]} Deduplicated list of individual email addresses
 */
function resolveApproversWithGroups(approversList, groupsData) {
  const resolved = [];
  for (const approver of approversList) {
    const group = groupsData.find(
      (g) => g.group?.toLowerCase() === approver.toLowerCase(),
    );
    if (group) {
      // This is a DL — expand to individual emails
      const emails = group.email.split(',').map((e) => e.trim()).filter(Boolean);
      resolved.push(...emails);
    } else {
      // Direct email address
      resolved.push(approver);
    }
  }
  // Deduplicate (case-insensitive)
  const seen = new Set();
  return resolved.filter((email) => {
    const lower = email.toLowerCase();
    if (seen.has(lower)) return false;
    seen.add(lower);
    return true;
  });
}

/**
 * Fetch the workflow config via the DA Config API.
 * Tries repo-level first: GET /config/{org}/{repo}/publish-workflow-config
 * Falls back to org-level: GET /config/{org}/publish-workflow-config
 * See: https://docs.da.live/developers/api/config#get-config
 * @param {string} org - Organization
 * @param {string} repo - Repository
 * @param {string} token - Authorization token
 * @returns {Promise<Object|null>} Config data or null on failure
 */
async function fetchWorkflowConfig(org, repo, token) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };

  // 1. Try repo-level root config (contains publish-workflow-config & groups-to-email tabs)
  const repoUrl = `${DA_ADMIN}/config/${org}/${repo}/`;
  const repoResp = await fetch(repoUrl, { headers });
  if (repoResp.ok) {
    const config = await repoResp.json();
    // Only use this config if it actually has the publish-workflow-config tab
    if (config['publish-workflow-config']) return config;
  }

  // 2. Fallback to org-level root config
  const orgUrl = `${DA_ADMIN}/config/${org}/`;
  const orgResp = await fetch(orgUrl, { headers });
  if (orgResp.ok) {
    const config = await orgResp.json();
    if (config['publish-workflow-config']) return config;
  }

  return null;
}

/**
 * Publish content via Helix Admin API
 * POST https://admin.hlx.page/live/{org}/{repo}/main/{path}
 * @param {string} org - Organization
 * @param {string} repo - Repository
 * @param {string} path - Content path
 * @param {string} token - Authorization token
 * @returns {Promise<Object>} Result
 */
export async function publishContent(org, repo, path, token) {
  try {
    // Ensure path starts with /
    const cleanPath = path.startsWith('/') ? path : `/${path}`;

    const publishUrl = `https://da-etc.adobeaem.workers.dev/cors?url=https://admin.hlx.page/live/${org}/${repo}/main${cleanPath}`;

    const response = await fetch(publishUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Publish failed:', response.status, errorText);
      return {
        success: false,
        error: `Publish failed: ${response.status} ${errorText}`,
      };
    }

    const result = await response.json();
    return {
      success: true,
      data: result,
    };
  } catch (error) {
    console.error('Error publishing content:', error);
    return {
      success: false,
      error: error.message || 'An error occurred during publish',
    };
  }
}

/**
 * Send rejection notification via Worker
 * @param {Object} data - Rejection data
 * @param {string} token - Authorization token
 * @returns {Promise<Object>} Result
 */
export async function notifyRejection(data, token) {
  try {
    const opts = getOpts(token, 'POST', data);
    const response = await fetch(`${getWorkerUrl()}/api/notify-rejection`, opts);

    const result = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: result.error || 'Failed to send rejection notification',
      };
    }

    return {
      success: true,
      message: result.message,
      recipients: result.recipients,
    };
  } catch (error) {
    console.error('Error sending rejection notification:', error);
    return {
      success: false,
      error: error.message || 'An error occurred',
    };
  }
}

/**
 * Notify author(s) that their content has been published.
 * Sends a consolidated email per author via the Worker.
 * @param {Object} data - { org, repo, paths: [{ path, authorEmail }],
 *                         approverEmail, approverName? }
 * @param {string} token - Authorization token
 * @returns {Promise<Object>} Result
 */
export async function notifyPublished(data, token) {
  try {
    const opts = getOpts(token, 'POST', data);
    const response = await fetch(`${getWorkerUrl()}/api/notify-published`, opts);

    const result = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: result.error || 'Failed to send publish notification',
      };
    }

    return {
      success: true,
      message: result.message,
      notifiedAuthors: result.notifiedAuthors,
    };
  } catch (error) {
    console.error('Error sending publish notification:', error);
    return {
      success: false,
      error: error.message || 'An error occurred',
    };
  }
}

/**
 * Get the list of resolved approvers for a given content path.
 * Reads the config sheet and resolves DL groups to individual emails
 * using the groups-to-email tab.
 * @param {string} org - Organization
 * @param {string} repo - Repository
 * @param {string} path - Content path
 * @param {string} token - Authorization token
 * @returns {Promise<string[]>} Array of resolved approver emails (empty if none found)
 */
export async function getApproversForPath(org, repo, path, token) {
  const config = await fetchWorkflowConfig(org, repo, token);
  if (!config) {
    throw new Error(
      'Publish workflow configuration not found. Please ensure the "publish-workflow-config" tab '
      + `exists in the DA config for repo "${org}/${repo}" or org "${org}".`,
    );
  }

  const rules = config['publish-workflow-config']?.data || config.data || [];
  const groupsData = config['groups-to-email']?.data || [];

  // Find the best (most specific) matching rule for this path
  const rule = findBestMatchingRule(path, rules);
  if (rule) {
    let approvers = rule.Approvers || rule.approvers || [];
    if (typeof approvers === 'string') {
      approvers = approvers.split(',').map((a) => a.trim()).filter(Boolean);
    }
    return resolveApproversWithGroups(approvers, groupsData);
  }

  return [];
}

/**
 * Get both the resolved approvers and CC recipients for a given content path.
 * Reads the same config as getApproversForPath but also resolves the CC column.
 * @param {string} org - Organization
 * @param {string} repo - Repository
 * @param {string} path - Content path
 * @param {string} token - Authorization token
 * @returns {Promise<{ approvers: string[], cc: string[] }>}
 */
async function getApproversAndCCForPath(org, repo, path, token) {
  const config = await fetchWorkflowConfig(org, repo, token);
  if (!config) {
    throw new Error(
      'Publish workflow configuration not found. Please ensure the "publish-workflow-config" tab '
      + `exists in the DA config for repo "${org}/${repo}" or org "${org}".`,
    );
  }

  const rules = config['publish-workflow-config']?.data || config.data || [];
  const groupsData = config['groups-to-email']?.data || [];

  const rule = findBestMatchingRule(path, rules);
  if (!rule) return { approvers: [], cc: [] };

  let approvers = rule.Approvers || rule.approvers || [];
  if (typeof approvers === 'string') {
    approvers = approvers.split(',').map((a) => a.trim()).filter(Boolean);
  }

  let cc = rule.CC || rule.cc || [];
  if (typeof cc === 'string') {
    cc = cc.split(',').map((c) => c.trim()).filter(Boolean);
  }

  return {
    approvers: resolveApproversWithGroups(approvers, groupsData),
    cc: cc.length > 0 ? resolveApproversWithGroups(cc, groupsData) : [],
  };
}

/**
 * Check if a pending publish request exists for the given path in the requests sheet
 * @param {string} org - Organization
 * @param {string} repo - Repository
 * @param {string} path - Content path
 * @param {string} token - Authorization token
 * @returns {Promise<Object|null>} The matching pending request row, or null if not found
 */
export async function checkPublishRequest(org, repo, path, token) {
  try {
    const sheetUrl = `${DA_ADMIN}/source/${org}/${repo}${REQUESTS_SHEET_PATH}`;
    const opts = getOpts(token, 'GET');
    const resp = await fetch(sheetUrl, opts);
    if (!resp.ok) return null;

    const sheet = await resp.json();
    const requests = sheet.data || [];

    return requests.find(
      (r) => r.path === path && r.status === 'pending',
    ) || null;
  } catch (error) {
    console.error('Error checking publish request:', error);
    return null;
  }
}

/**
 * Remove a pending publish request from the requests sheet (after approve or reject)
 * @param {string} org - Organization
 * @param {string} repo - Repository
 * @param {string} path - Content path to remove
 * @param {string} token - Authorization token
 * @returns {Promise<Object>} Result
 */
export async function removePublishRequest(org, repo, path, token) {
  try {
    const sheetUrl = `${DA_ADMIN}/source/${org}/${repo}${REQUESTS_SHEET_PATH}`;
    const opts = getOpts(token, 'GET');
    const resp = await fetch(sheetUrl, opts);
    if (!resp.ok) {
      throw new Error(`Failed to read requests sheet: ${resp.status}`);
    }

    const sheet = await resp.json();
    const requests = sheet.data || [];

    // First row defines the column keys — extract them to preserve sheet structure
    const keys = requests.length > 0 ? Object.keys(requests[0]) : [];
    const emptyRow = Object.fromEntries(keys.map((k) => [k, '']));
    const dataRows = requests.slice(1);

    // Remove the pending request matching this path (only from data rows)
    const filteredData = dataRows.filter(
      (r) => !(r.path === path && r.status === 'pending'),
    );

    // If nothing was removed, nothing to update
    if (filteredData.length === dataRows.length) {
      return { success: true, message: 'No matching request found to remove' };
    }

    // Rebuild with an empty first row to preserve column keys
    const filtered = [emptyRow, ...filteredData];

    // Update sheet data (single-sheet format)
    sheet.total = filtered.length;
    sheet.offset = 0;
    sheet.limit = filtered.length;
    sheet.data = filtered;

    // Write back to DA as multipart/form-data
    const blob = new Blob([JSON.stringify(sheet)], { type: 'application/json' });
    const formData = new FormData();
    formData.append('data', blob);

    const writeResp = await fetch(sheetUrl, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    if (!writeResp.ok) {
      throw new Error(`Failed to update requests sheet: ${writeResp.status}`);
    }

    return { success: true };
  } catch (error) {
    console.error('Error removing publish request from sheet:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get ALL pending requests that the given user is authorized to approve.
 * Fetches both the config sheet (for approver rules + group resolution) and
 * the requests sheet, then filters to only those paths where the user is
 * a resolved approver.
 * @param {string} org - Organization
 * @param {string} repo - Repository
 * @param {string} userEmail - The logged-in user's email
 * @param {string} token - Authorization token
 * @returns {Promise<Object[]>} Array of pending request objects the user can approve
 */
export async function getAllPendingRequestsForUser(org, repo, userEmail, token) {
  // Fetch config and requests in parallel
  const [config, requestsResp] = await Promise.all([
    fetchWorkflowConfig(org, repo, token),
    fetch(
      `${DA_ADMIN}/source/${org}/${repo}${REQUESTS_SHEET_PATH}`,
      getOpts(token, 'GET'),
    ),
  ]);

  if (!config) {
    throw new Error(
      'Publish workflow configuration not found. Please ensure the "publish-workflow-config" tab '
      + `exists in the DA config for repo "${org}/${repo}" or org "${org}".`,
    );
  }

  if (!requestsResp.ok) return [];

  const requestsSheet = await requestsResp.json();
  const allRequests = requestsSheet.data || [];
  const pendingRequests = allRequests.filter((r) => r.status === 'pending' && r.path);

  if (pendingRequests.length === 0) return [];

  const rules = config['publish-workflow-config']?.data || config.data || [];
  const groupsData = config['groups-to-email']?.data || [];
  const normalizedUser = userEmail.toLowerCase();

  // Filter to only requests this user can approve (using best-match rule per path)
  return pendingRequests.filter((request) => {
    const rule = findBestMatchingRule(request.path, rules);
    if (!rule) return false;

    let approvers = rule.Approvers || rule.approvers || [];
    if (typeof approvers === 'string') {
      approvers = approvers.split(',').map((a) => a.trim()).filter(Boolean);
    }
    const resolved = resolveApproversWithGroups(approvers, groupsData);
    return resolved.some((a) => a.toLowerCase() === normalizedUser);
  });
}

/**
 * Bulk publish multiple content paths via Helix Admin API
 * POST https://admin.hlx.page/live/{org}/{repo}/main/*
 * Uses the bulk publish job API to publish all paths in a single request.
 * See: https://www.aem.live/docs/admin.html#tag/publish/operation/bulkPublish
 * @param {string} org - Organization
 * @param {string} repo - Repository
 * @param {string[]} paths - Array of content paths to publish
 * @param {string} token - Authorization token
 * @returns {Promise<Object>} Result with job info or error
 */
export async function bulkPublishContent(org, repo, paths, token) {
  try {
    // Normalize paths — ensure each starts with /
    const cleanPaths = paths.map((p) => (p.startsWith('/') ? p : `/${p}`));

    const bulkUrl = `https://admin.hlx.page/live/${org}/${repo}/main/*`;

    const response = await fetch(bulkUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ paths: cleanPaths }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Bulk publish failed:', response.status, errorText);
      return {
        success: false,
        error: `Bulk publish failed: ${response.status} ${errorText}`,
      };
    }

    const result = await response.json();
    return {
      success: true,
      data: result,
      job: result.job,
      links: result.links,
    };
  } catch (error) {
    console.error('Error during bulk publish:', error);
    return {
      success: false,
      error: error.message || 'An error occurred during bulk publish',
    };
  }
}

/**
 * Poll a bulk job until it completes or times out.
 * Appends /details to the job's self link returned in the bulk publish response.
 * @param {string} jobSelfUrl - The links.self URL from the bulk publish response
 * @param {string} token - Authorization token
 * @param {number} maxWaitMs - Maximum time to wait in milliseconds (default: 60s)
 * @param {number} intervalMs - Polling interval in milliseconds (default: 2s)
 * @returns {Promise<Object>} Final job status
 */
export async function pollJobStatus(jobSelfUrl, token, maxWaitMs = 60000, intervalMs = 2000) {
  const jobUrl = `${jobSelfUrl}/details`;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const resp = await fetch(jobUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!resp.ok) {
        console.warn('Job status check failed:', resp.status);
        break;
      }

      const job = await resp.json();
      const { state } = job;

      // Terminal states
      if (state === 'stopped' || state === 'completed') {
        return { success: true, job };
      }

      // Still running — wait before polling again
      await new Promise((resolve) => { setTimeout(resolve, intervalMs); });
    } catch (error) {
      console.warn('Job poll error:', error);
      break;
    }
  }

  return { success: false, error: 'Job polling timed out or encountered an error' };
}

/**
 * Remove multiple pending publish requests from the requests sheet in a single write.
 * More efficient than calling removePublishRequest() per path when doing bulk approvals.
 * @param {string} org - Organization
 * @param {string} repo - Repository
 * @param {string[]} paths - Array of content paths to remove
 * @param {string} token - Authorization token
 * @returns {Promise<Object>} Result
 */
export async function removeMultiplePublishRequests(org, repo, paths, token) {
  try {
    const sheetUrl = `${DA_ADMIN}/source/${org}/${repo}${REQUESTS_SHEET_PATH}`;
    const opts = getOpts(token, 'GET');
    const resp = await fetch(sheetUrl, opts);
    if (!resp.ok) {
      throw new Error(`Failed to read requests sheet: ${resp.status}`);
    }

    const sheet = await resp.json();
    const requests = sheet.data || [];

    // First row defines the column keys — extract them to preserve sheet structure
    const keys = requests.length > 0 ? Object.keys(requests[0]) : [];
    const emptyRow = Object.fromEntries(keys.map((k) => [k, '']));
    const dataRows = requests.slice(1);

    const pathSet = new Set(paths);
    const filteredData = dataRows.filter(
      (r) => !(pathSet.has(r.path) && r.status === 'pending'),
    );

    if (filteredData.length === dataRows.length) {
      return { success: true, message: 'No matching requests found to remove' };
    }

    // Rebuild with an empty first row to preserve column keys
    const filtered = [emptyRow, ...filteredData];

    // Update sheet data (single-sheet format)
    sheet.total = filtered.length;
    sheet.offset = 0;
    sheet.limit = filtered.length;
    sheet.data = filtered;

    const blob = new Blob([JSON.stringify(sheet)], { type: 'application/json' });
    const formData = new FormData();
    formData.append('data', blob);

    const writeResp = await fetch(sheetUrl, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    if (!writeResp.ok) {
      throw new Error(`Failed to update requests sheet: ${writeResp.status}`);
    }

    return { success: true, removedCount: requests.length - filtered.length };
  } catch (error) {
    console.error('Error removing publish requests from sheet:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Resend the publish request notification email to approvers for a given path.
 * Resolves the approvers from the workflow config, then calls the worker's
 * /api/request-publish endpoint to re-send the email. Does NOT modify the
 * requests sheet (the existing pending row is preserved).
 * @param {string} org - Organization
 * @param {string} repo - Repository
 * @param {string} path - Content path
 * @param {string} requesterEmail - The requester's email
 * @param {string} token - Authorization token
 * @returns {Promise<Object>} Result
 */
export async function resendPublishRequest(org, repo, path, requesterEmail, token) {
  try {
    const { approvers, cc } = await getApproversAndCCForPath(org, repo, path, token);
    if (!approvers || approvers.length === 0) {
      return { success: false, error: 'No approvers found for this content path.' };
    }

    const previewUrl = `https://main--${repo}--${org}.aem.page${path}`;

    const opts = getOpts(token, 'POST', {
      org,
      repo,
      path,
      previewUrl,
      authorEmail: requesterEmail,
      approvers,
      cc,
    });
    const response = await fetch(`${getWorkerUrl()}/api/request-publish`, opts);
    const result = await response.json();

    if (!response.ok) {
      return { success: false, error: result.error || 'Failed to resend publish request' };
    }

    return { success: true, message: result.message || 'Publish request re-sent to approvers' };
  } catch (error) {
    console.error('Error resending publish request:', error);
    return { success: false, error: error.message || 'An error occurred' };
  }
}

/**
 * Get ALL pending requests that were submitted by the given user (requester).
 * Fetches the requests sheet and filters to rows where the requester matches
 * the current user's email. No approver-rule checking is performed.
 * @param {string} org - Organization
 * @param {string} repo - Repository
 * @param {string} userEmail - The logged-in user's email
 * @param {string} token - Authorization token
 * @returns {Promise<Object[]>} Array of pending request objects submitted by the user
 */
export async function getAllPendingRequestsByRequester(org, repo, userEmail, token) {
  const sheetUrl = `${DA_ADMIN}/source/${org}/${repo}${REQUESTS_SHEET_PATH}`;
  const resp = await fetch(sheetUrl, getOpts(token, 'GET'));

  if (!resp.ok) return [];

  const requestsSheet = await resp.json();
  const allRequests = requestsSheet.data || [];
  const normalizedUser = userEmail.toLowerCase();

  return allRequests.filter(
    (r) => r.status === 'pending' && r.path && r.requester
      && r.requester.toLowerCase() === normalizedUser,
  );
}

/**
 * Fetch the current user's email from Adobe IMS profile
 * @param {string} token - The authorization token
 * @returns {Promise<string>} User email or empty string if unavailable
 */
export async function getUserEmail(token) {
  try {
    const resp = await fetch('https://ims-na1.adobelogin.com/ims/profile/v1', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return '';
    const profile = await resp.json();
    return profile?.email || '';
  } catch {
    console.warn('Could not fetch user profile');
    return '';
  }
}

export { getEnvironment };
