/**
 * TradingView Widget Plugin for AEM Sidekick
 *
 * Allows users to inject TradingView widgets (https://www.tradingview.com/widget/)
 * originating as HTML code into documents
 */

/* eslint-disable */
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { DA_ORIGIN } from 'https://da.live/nx/public/utils/constants.js';
import createElement from '/scripts/utils.js';

/**
 * Constants for TradingView widget plugin
 */
const CONSTANTS = {
  TRADINGVIEW: {
    HOST: 's3.tradingview.com',
    BASE_URL: 'https://s3.tradingview.com/external-embedding/',
    WIDGET_TYPE_PREFIX: 'embed-widget-',
    DEFAULT_CONFIG: {  // Default config
      "chartOnly": true,
      "width": "100%"
    },
    DEFAULT_HEIGHT: '500px'
  }
};

/**
 * Initializes the tradingview plugin interface and sets up event handlers
 */
(async function init() {
  try {
    // Import DA SDK components
    const { context, token, actions } = await DA_SDK;
    const { daFetch } = actions;

    // Set current document/page path
    const pageInput = document.getElementById('current-path');
    pageInput.textContent = context.path;

    // Get UI elements
    const elements = {
      container: document.querySelector('.course-container'),
      applyBtn: document.getElementById('apply-button'),
      pathDisplay: document.getElementById('current-path')
    };

    // Set up event listeners
    setupEventListeners(elements, actions);

  } catch (error) {
    handleError(error.message);
  }
}());

/**
 * Sets up all event listeners
 * @param {Object} elements - UI elements
 * @param {Object} actions - SDK actions
 */
function setupEventListeners(elements, actions) {
  const { applyBtn } = elements;

  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      insertBlock(actions);
    });
  }
}

/**
 * Generates TradingView widget block markup to be injected into document
 * @param {string} scriptSrc - The widget script source
 * @param {string} height - The widget height
 * @param {Object} config - The widget configuration
 * @returns {string} HTML table string
 */
function generateConfigTable(scriptSrc, height, config) {
  return `
    <table style="min-width: 221px;">
      <colgroup><col style="width: 196px;"><col></colgroup>
      <tbody>
        <tr><td colspan="2" data-colwidth="196,0"><p>tradingview</p></td></tr>
        <tr><td data-colwidth="196"><p>script</p></td><td><p>${scriptSrc}</p></td></tr>
        <tr><td data-colwidth="196"><p>height</p></td><td><p>${height}</p></td></tr>
        <tr><td data-colwidth="196"><p>config</p></td><td><pre><code>${JSON.stringify(config, null, 2)}</code></pre></td></tr>
      </tbody>
    </table>`;
}

/**
 * Validates TradingView widget source URL
 * @param {string} srcValue - The source URL to validate
 * @returns {string|null} The extracted script name if valid, null if invalid
 */
function getWidgetStriptFromFullyQaulifiedSrcValue(srcValue) {
  if (!srcValue) {
    handleError('No widget source URL found');
    return null;
  }

  try {
    const url = new URL(srcValue);

    // Validate the host
    if (url.host !== CONSTANTS.TRADINGVIEW.HOST) {
      handleError('Invalid widget source: must be from s3.tradingview.com');
      return null;
    }

    const pathParts = url.pathname.split('/');
    const scriptSrc = pathParts[pathParts.length - 1];

    // Validate the script source is not empty
    if (!scriptSrc) {
      handleError('Invalid widget source: empty script name');
      return null;
    }

    // Validate that the script starts with the widget type prefix
    if (!scriptSrc.startsWith(CONSTANTS.TRADINGVIEW.WIDGET_TYPE_PREFIX)) {
      handleError(`Invalid widget type: ${scriptSrc}.`);
      return null;
    }

    return scriptSrc;
  } catch (e) {
    handleError('Invalid widget source URL: ' + e.message);
    return null;
  }
}

/**
 * Parses TradingView widget HTML code from textarea
 * @returns {Object} Object containing script source and config
 */
function parseUserProvidedWidgetHTML() {
  // Parse the user provided widget HTML code into a DOM object
  const textarea = document.getElementById('widgetHTMLCode');
  const widgetHTMLCode = textarea.value;
  const parser = new DOMParser();
  const doc = parser.parseFromString(widgetHTMLCode, 'text/html');

  // Extract the script element from the DOM object
  const scriptElement = doc.querySelector('script');

  // Set the default script source and config
  let scriptSrc = 'embed-widget-symbol-overview.js';
  let config = CONSTANTS.TRADINGVIEW.DEFAULT_CONFIG;

  if (scriptElement) {
    // Extract and validate the src attribute
    const srcValue = scriptElement.getAttribute('src');
    const validatedScriptSrc = getWidgetStriptFromFullyQaulifiedSrcValue(srcValue);

    if (validatedScriptSrc) {
      scriptSrc = validatedScriptSrc;
      console.log('srcValue:', srcValue);
      console.log('extracted filename:', scriptSrc);
    } else {
      return null;
    }

    // Extract and parse the JSON config inside the script
    const scriptContent = scriptElement.textContent.trim();
    try {
      const configJson = JSON.parse(scriptContent);
      if (configJson) {
        config = configJson;
      }
      console.log('Parsed JSON config:', configJson);
    } catch (e) {
      handleError.error('Failed to parse JSON config:', e);
    }
  } else {
    handleError('No widget script found in widget HTML code.');
    return null;
  }

  return { scriptSrc, config };
}

function insertBlock(actions) {
  // Parse the widget HTML and extract configuration
  const widgetConfig = parseUserProvidedWidgetHTML();
  if (!widgetConfig) { // If no widget config is found, return
    return;
  }

  // Inject the TradingView widget into the document
  try {
    if (actions && actions.sendHTML) {
      const { scriptSrc: injectedBlockScriptSrc, config: injectedBlockConfig } = widgetConfig;
      const injectedBlockHeight = CONSTANTS.TRADINGVIEW.DEFAULT_HEIGHT;

      const configHTML = generateConfigTable(injectedBlockScriptSrc, injectedBlockHeight, injectedBlockConfig);

      actions.sendHTML(configHTML);
      actions.closeLibrary();
    } else {
      handleError('Cannot inject TradingView widget : Document editor actions not available');
    }
  } catch (err) {
    handleError('Failed to inject TradingView widget into document: ' + err.message);
  }
}

/**
 * Handles initialization error
 * @param {Error} error - Error object
 */
function handleError(error) {
  console.error('Error:', error);
  const container = document.getElementById('tradingview-msg');
  if (container) {
    container.innerHTML = `
      <div class="tradingview-error">
        <p>${error}</p>
      </div>
    `;
  }
}
