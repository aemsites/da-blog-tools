/* eslint-disable import/no-unresolved, no-console, no-restricted-syntax */
/* eslint-disable no-continue, prefer-destructuring */
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
 * Detect approvers for a content path by reading the config via DA Config API.
 * Tries repo-level config first, then falls back to org-level.
 * Resolves distribution list groups to individual emails using the groups-to-email tab.
 * @param {string} path - The content path
 * @param {string} org - Organization
 * @param {string} repo - Repository
 * @param {string} token - Authorization token
 * @returns {Promise<Object>} Approvers data
 */
export async function detectApprovers(path, org, repo, token) {
  const config = await fetchWorkflowConfig(org, repo, token);

  if (!config) {
    return {
      approvers: [],
      cc: [],
      pattern: '',
      source: 'error',
      error: 'Publish workflow configuration not found. Please ensure the "publish-workflow-config" tab '
        + `exists in the DA config for repo "${org}/${repo}" or org "${org}".`,
    };
  }

  // Multi-sheet format: tabs are 'publish-workflow-config' and 'groups-to-email'
  const rules = config['publish-workflow-config']?.data || config.data || config.rules || [];
  const groupsData = config['groups-to-email']?.data || [];

  // Find the best (most specific) matching rule for this path
  // Prioritizes closest match → parent match → root-level match
  const rule = findBestMatchingRule(path, rules);

  if (rule) {
    const pattern = rule.Pattern || rule.pattern;

    // Parse approvers - could be comma-separated string or array
    let approvers = rule.Approvers || rule.approvers || [];
    if (typeof approvers === 'string') {
      approvers = approvers.split(',').map((a) => a.trim()).filter(Boolean);
    }

    // Resolve DL groups to individual emails
    const resolvedApprovers = resolveApproversWithGroups(approvers, groupsData);

    // Resolve CC recipients (same DL group resolution)
    let cc = rule.CC || rule.cc || [];
    if (typeof cc === 'string') {
      cc = cc.split(',').map((c) => c.trim()).filter(Boolean);
    }
    const resolvedCC = cc.length > 0 ? resolveApproversWithGroups(cc, groupsData) : [];

    return {
      approvers: resolvedApprovers,
      cc: resolvedCC,
      pattern,
      source: 'config',
      digiops: rule.DigiOps || rule.digiops || config.digiops || '',
    };
  }

  // No matching rule found
  return {
    approvers: [],
    cc: [],
    pattern: '*',
    source: 'no-match',
    error: `No approver rule found matching path "${path}". Please add a matching pattern to the "publish-workflow-config" tab.`,
  };
}

/**
 * Add a request entry to the requests sheet in DA.
 * Reads the current sheet, appends the new request row, and writes it back.
 * @param {string} org - Organization
 * @param {string} repo - Repository
 * @param {Object} requestData - The request data (path, authorEmail, approvers)
 * @param {string} token - Authorization token
 * @returns {Promise<Object>} Result
 */
async function addRequestToDASheet(org, repo, requestData, token) {
  try {
    const sheetUrl = `${DA_ADMIN}/source/${org}/${repo}${REQUESTS_SHEET_PATH}`;

    // 1. Read the current sheet
    const readOpts = getOpts(token, 'GET');
    const readResp = await fetch(sheetUrl, readOpts);
    if (!readResp.ok) {
      throw new Error(`Failed to read requests sheet: ${readResp.status}`);
    }
    const sheet = await readResp.json();

    // 2. Append the new request row (single-sheet format)
    const requests = sheet.data || [];
    requests.push({
      requester: requestData.authorEmail || '',
      approver: Array.isArray(requestData.approvers)
        ? requestData.approvers.join(',')
        : requestData.approvers || '',
      path: requestData.path || '',
      status: 'pending',
      created: new Date().toISOString(),
    });

    // 3. Update sheet metadata
    sheet.total = requests.length;
    sheet.offset = 0;
    sheet.limit = requests.length;
    sheet.data = requests;

    // 4. Write the updated sheet back to DA as multipart/form-data
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
    console.error('Error adding request to DA sheet:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Submit a publish request
 * @param {Object} requestData - Request data
 * @param {string} token - Authorization token
 * @returns {Promise<Object>} Result
 */
export async function submitPublishRequest(requestData, token) {
  try {
    const opts = getOpts(token, 'POST', requestData);
    const response = await fetch(`${getWorkerUrl()}/api/request-publish`, opts);

    const result = await response.json();

    if (!response.ok) {
      return {
        success: false,
        message: result.error || 'Failed to submit publish request',
      };
    }

    // After successful submission, add the request to the DA sheet
    const { org, repo } = requestData;
    const sheetResult = await addRequestToDASheet(org, repo, requestData, token);
    if (!sheetResult.success) {
      console.warn('Request sent but failed to update DA sheet:', sheetResult.error);
    }

    return {
      success: true,
      message: result.message || 'Publish request sent to approvers',
      approvers: result.approvers,
    };
  } catch (error) {
    console.error('Error submitting publish request:', error);
    return {
      success: false,
      message: error.message || 'An error occurred',
    };
  }
}

/**
 * Resend the publish request notification email to approvers.
 * Calls the worker's /api/request-publish endpoint again but does NOT add
 * a duplicate row to the DA sheet (the existing row is preserved).
 * @param {Object} requestData - Same shape as submitPublishRequest
 * @param {string} token - Authorization token
 * @returns {Promise<Object>} Result
 */
export async function resendPublishRequest(requestData, token) {
  try {
    const opts = getOpts(token, 'POST', requestData);
    const response = await fetch(`${getWorkerUrl()}/api/request-publish`, opts);

    const result = await response.json();

    if (!response.ok) {
      return {
        success: false,
        message: result.error || 'Failed to resend publish request',
      };
    }

    return {
      success: true,
      message: result.message || 'Publish request re-sent to approvers',
      approvers: result.approvers,
    };
  } catch (error) {
    console.error('Error resending publish request:', error);
    return {
      success: false,
      message: error.message || 'An error occurred',
    };
  }
}

/**
 * Withdraw (remove) a pending publish request from the DA sheet.
 * Reads the sheet, filters out the matching pending request, and writes it back.
 * @param {string} org - Organization
 * @param {string} repo - Repository
 * @param {string} path - Content path
 * @param {string} requesterEmail - The requester's email
 * @param {string} token - Authorization token
 * @returns {Promise<Object>} Result
 */
export async function withdrawPublishRequest(org, repo, path, requesterEmail, token) {
  try {
    const sheetUrl = `${DA_ADMIN}/source/${org}/${repo}${REQUESTS_SHEET_PATH}`;
    const readOpts = getOpts(token, 'GET');
    const resp = await fetch(sheetUrl, readOpts);
    if (!resp.ok) {
      throw new Error(`Failed to read requests sheet: ${resp.status}`);
    }

    const sheet = await resp.json();
    const requests = sheet.data || [];

    // First row defines the column keys — extract them to preserve sheet structure
    const keys = requests.length > 0 ? Object.keys(requests[0]) : [];
    const emptyRow = Object.fromEntries(keys.map((k) => [k, '']));
    const dataRows = requests.slice(1);

    // Remove the matching pending request
    const filteredData = dataRows.filter(
      (r) => !(r.path === path
        && r.requester?.toLowerCase() === requesterEmail.toLowerCase()
        && r.status === 'pending'),
    );

    // If nothing was removed, nothing to update
    if (filteredData.length === dataRows.length) {
      return { success: true, message: 'No matching request found to withdraw' };
    }

    // Rebuild with an empty first row to preserve column keys
    const filtered = [emptyRow, ...filteredData];

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
    console.error('Error withdrawing publish request:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Check if a pending publish request already exists for the given path and requester
 * @param {string} org - Organization
 * @param {string} repo - Repository
 * @param {string} path - Content path
 * @param {string} requesterEmail - The requester's email
 * @param {string} token - Authorization token
 * @returns {Promise<Object|null>} The existing pending request row, or null if none found
 */
export async function checkExistingRequest(org, repo, path, requesterEmail, token) {
  try {
    const sheetUrl = `${DA_ADMIN}/source/${org}/${repo}${REQUESTS_SHEET_PATH}`;
    const opts = getOpts(token, 'GET');
    const resp = await fetch(sheetUrl, opts);
    if (!resp.ok) return null;

    const sheet = await resp.json();
    const requests = sheet.data || [];

    return requests.find(
      (r) => r.path === path
        && r.requester === requesterEmail
        && r.status === 'pending',
    ) || null;
  } catch (error) {
    console.error('Error checking existing request:', error);
    return null;
  }
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
