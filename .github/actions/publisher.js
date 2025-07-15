import fetch from 'node-fetch';
import { format } from 'date-fns';
import { FormData } from 'formdata-node';

/**
 * Throws if the required environment variable is not set.
 * @param {string} name - The environment variable name.
 * @returns {string} The environment variable value.
 */
function requireEnv(name) {
  if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`);
  return process.env[name];
}

// const DA_TOKEN = requireEnv('DA_TOKEN');
const HELIX_TOKEN = requireEnv('HELIX_TOKEN');
const AEM_PAGE_PATH = requireEnv('AEM_PAGE_PATH');
const HLX_ORG = requireEnv('HLX_ORG');
const HLX_SITE = requireEnv('HLX_SITE');
const SITE_CONFIG_JSON = requireEnv('SITE_CONFIG');
const VALID_PREFIXES_JSON = requireEnv('VALID_PREFIXES');

// DA items
const IMS_CLIENT_ID = requireEnv('IMS_CLIENT_ID');
const IMS_CLIENT_SECRET = requireEnv('IMS_CLIENT_SECRET');
// these are the scopes we need for the DA API - they are the cloud manager scopes
const IMS_SCOPE = 'openid, AdobeID, read_organizations, additional_info.projectedProductContext, read_pc.dma_aem_ams';

// Parse site configuration
let SITE_CONFIG;
try {
  SITE_CONFIG = JSON.parse(SITE_CONFIG_JSON);
} catch (err) {
  throw new Error(`Invalid SITE_CONFIG JSON: ${err.message}`);
}

// Parse valid prefixes
let VALID_PREFIXES;
try {
  VALID_PREFIXES = JSON.parse(VALID_PREFIXES_JSON);
  if (!Array.isArray(VALID_PREFIXES)) {
    throw new Error('VALID_PREFIXES must be an array');
  }
} catch (err) {
  throw new Error(`Invalid VALID_PREFIXES JSON: ${err.message}`);
}

// Validate HLX_SITE and get corresponding SITE_ROOT
const SITE_ROOT = SITE_CONFIG[HLX_SITE];

const PUBLISH_ROOT = `/${HLX_ORG}/${HLX_SITE}/${SITE_ROOT}/`;

const DA_URL = 'https://admin.da.live';
const HELIX_URL = 'https://admin.hlx.page';

/**
 * Logs messages with a consistent prefix.
 * @param {'info'|'error'} level
 * @param {string} msg
 */
function log(level, msg) {
  const prefix = '[publisher]';
  if (level === 'error') {
    console.error(`${prefix} ERROR: ${msg}`);
  } else {
    console.log(`${prefix} ${msg}`);
  }
}

/**
 * Removes the first matching prefix from the path.
 * @param {string} path
 * @param {string[]} prefixes
 * @returns {string}
 */
function stripPrefix(path, prefixes) {
  for (const prefix of prefixes) {
    if (path.startsWith(prefix)) {
      return path.slice(prefix.length);
    }
  }
  return path;
}

/**
 * Replaces the .md extension with .html
 * @param {string} path
 * @returns {string}
 */
function mdToHtml(path) {
  return path.endsWith('.md') ? path.slice(0, -3) + '.html' : path;
}

/**
 * Gets a new IMS token from Adobe IMS
 * @returns {Promise<string>} The access token
 */
async function getImsToken() {
  log('info', 'Getting new IMS token...');
  
  const params = new URLSearchParams();
  params.append('client_id', IMS_CLIENT_ID);
  params.append('client_secret', IMS_CLIENT_SECRET);
  params.append('grant_type', 'client_credentials');

  try {
    const response = await fetch('https://ims-na1.adobelogin.com/ims/token/v4', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: params,
    });

    if (response.ok) {
      const data = await response.json();
      log('info', 'IMS token retrieved successfully');
      return data.access_token;
    } else {
      log('error', `IMS token request failed with status ${response.status}`);
      const errorText = await response.text();
      log('error', `IMS error response: ${errorText}`);
      throw new Error(`Failed to get IMS token: ${response.status}`);
    }
  } catch (err) {
    log('error', `Error getting IMS token: ${err}`);
    throw err;
  }
}

/**
 * Main entry point
 */
async function main() {
  // log('info', `DEBUG_EVENT_PAYLOAD: ${process.env.DEBUG_EVENT_PAYLOAD}`); // uncomment to debug event payload (see what gh sends)
  log('info', `AEM_PAGE_PATH: ${AEM_PAGE_PATH}`);
  log('info', `HLX_ORG: ${HLX_ORG}`);
  log('info', `HLX_SITE: ${HLX_SITE}`);
  log('info', `SITE_ROOT: ${SITE_ROOT || 'NOT_CONFIGURED'}`);

  // Check if site is configured
  if (!SITE_ROOT) {
    log('info', `HLX_SITE "${HLX_SITE}" not configured. Available sites: ${Object.keys(SITE_CONFIG).join(', ')}`);
    return;
  }

  // Get fresh DA token
  const DA_TOKEN = await getImsToken();

  const hasValidPrefix =
    AEM_PAGE_PATH && VALID_PREFIXES.some(prefix => AEM_PAGE_PATH.startsWith(prefix));

  if (hasValidPrefix && AEM_PAGE_PATH.endsWith('.md')) {
    log('info', 'AEM_PAGE_PATH starts with a valid prefix and ends with .md');

    // step 1: unpublish page from helix live
    await unpublishPage(AEM_PAGE_PATH, 'live');

    // step 2: unpublish page from preview
    await unpublishPage(AEM_PAGE_PATH, 'preview');

    // step 3: move da page to date structure
    const dirPath = await movePageToDateStructure(AEM_PAGE_PATH, DA_TOKEN);
    log('info', `new path: ${dirPath}`);

    // step 4: publish page to preview
    await publishPage(dirPath, 'preview');

    // step 5: publish page to helix live
    await publishPage(dirPath, 'live');

  } else {
    log('info', 'AEM_PAGE_PATH does not match the required pattern');
    return;
  }
}

/**
 * Unpublishes a page from helix.
 * @param {string} pagePath
 * @param {string} environment
 */
async function unpublishPage(pagePath, environment) {
  log('info', `Unpublishing page from helix ${environment}: ${pagePath}`);

  try {
    const response = await fetch(`${HELIX_URL}/${environment}/${HLX_ORG}/${HLX_SITE}/main/${pagePath}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${HELIX_TOKEN}`,
        'Accept': 'application/json',
      },
    });
    if (response.status === 204) {
      log('info', 'Unpublish successful: No Content (204)');
    } else if (response.ok) {
      log('info', 'Unpublish response: ' + (await response.text()));
    } else {
      log('error', `Unpublish failed with status ${response.status}`);
      process.exit(1);
    }
  } catch (err) {
    log('error', `Error unpublishing: ${err}`);
    process.exit(1);
  }
}

/**
 * Publishes a page to helix.
 * @param {string} pagePath
 * @param {string} environment
 */
async function publishPage(pagePath, environment) {
  log('info', `Publishing page to helix ${environment}: ${pagePath}`);

  try {
    const response = await fetch(`${HELIX_URL}/${environment}/${HLX_ORG}/${HLX_SITE}/main/${pagePath}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HELIX_TOKEN}`,
        'Accept': 'application/json',
      },
    });
    if (response.ok) {
      log('info', `Publish to ${environment} successful`);
    } else {
      log('error', `Publish failed with status ${response.status}`);
      process.exit(1);
    }
  } catch (err) {
    log('error', `Error publishing: ${err}`);
    process.exit(1);
  }
}

/**
 * Moves a page to a date-based directory structure.
 * @param {string} pagePath
 * @param {string} DA_TOKEN
 * @returns {Promise<string>} The new path
 */
async function movePageToDateStructure(pagePath, DA_TOKEN) {
  // Use date-fns for formatting
  const datePath = format(new Date(), 'yyyy/MM/dd');

  // Prepare the destination path (prefix stripped, .md replaced with .html)
  let destinationPath = stripPrefix(pagePath, VALID_PREFIXES);
  destinationPath = mdToHtml(destinationPath);
  const dirPath = `${PUBLISH_ROOT}${datePath}/${destinationPath}`;
  log('info', `Target: ${dirPath}`);

  // Prepare the source path for the fetch URL (retain prefix, but .md -> .html)
  let sourcePath = mdToHtml(pagePath);

  // Prepare multipart/form-data body
  const form = new FormData();
  form.set('destination', dirPath);

  try {
    const response = await fetch(`${DA_URL}/move/${HLX_ORG}/${HLX_SITE}/${sourcePath}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DA_TOKEN}`,
        'Accept': 'application/json',
        ...form.headers, // Add multipart headers
      },
      body: form,
    });
    if (response.status === 204) {
      log('info', 'move successful');
      return `/${SITE_ROOT}/${datePath}/${destinationPath}`;
    } else if (response.ok) {
      // log('info', 'Response JSON: ' + JSON.stringify(await response.json()));
      return `/${SITE_ROOT}/${datePath}/${destinationPath}`;
    } else {
      log('error', `Move failed with status ${response.status}`);
      process.exit(1);
    }
  } catch (err) {
    log('error', `Error moving page: ${err}`);
    process.exit(1);
  }
}

main();