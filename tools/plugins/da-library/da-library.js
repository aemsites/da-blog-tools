// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
// eslint-disable-next-line import/no-unresolved
import { DA_ORIGIN } from 'https://da.live/nx/public/utils/constants.js';

const REPLACE_CONTENT = 'CONTENT';

function getQueryParam(param) {
  const urlParams = new URLSearchParams(window.location.search);
  const value = urlParams.get(param);
  return value ? decodeURIComponent(value) : value;
}

function formatData(data, format) {
  const dataArr = data.data || data;
  const result = dataArr.reduce((acc, item) => {
    if (item.key) {
      const toParse = format ? format.replace(REPLACE_CONTENT, item.key) : item.key;
      const parsed = { text: toParse };
      acc.push({ ...item, parsed });
    }
    return acc;
  }, []);
  return result;
}

function renderItems(items, listName, iconType = '') {
  return `
    <ul class="da-library-type-list da-library-type-list-${listName}">
      ${items.map((item) => {
    const name = item.value || item.name || item.key; // Display name
    if (!name) return '';
    return `
          <li class="da-library-type-item">
            <button class="da-library-type-item-btn ${iconType}"
              onclick="handleItemClick(${JSON.stringify(item).replace(/"/g, '&quot;')})">
              <div class="da-library-type-item-detail">
                ${item.icon && !item.url ? `<span class="icon-placeholder">${item.icon}</span>` : ''}
                <span>${name}</span>
                <svg class="icon">
                  <use href="#spectrum-AddCircle"/>
                </svg>
              </div>
            </button>
          </li>`;
  }).join('')}
    </ul>`;
}

async function handleItemClick(item) {
  try {
    const { actions } = await DA_SDK;
    if (item.parsed && item.parsed.text) {
      await actions.sendText(item.parsed.text);
    } else if (item.key) {
      await actions.sendText(item.key);
    }
    await actions.closeLibrary();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error sending text:', error);
  }
}

window.handleItemClick = handleItemClick;

async function displayListValue() {
  const contentPath = getQueryParam('content');
  const format = getQueryParam('format');
  const resultDiv = document.getElementById('result');

  if (contentPath) {
    try {
      resultDiv.innerHTML = `
        <div class="result">
          <div class="loading-spinner">
            <div class="spinner"></div>
            <p>Loading...</p>
          </div>
        </div>
      `;
      const { context, actions } = await DA_SDK;
      
      // Check if contentPath is a full URL or relative path
      const isFullUrl = contentPath.startsWith('http://') || contentPath.startsWith('https://');
      const adminApiUrl = isFullUrl ? contentPath : `${DA_ORIGIN}/source/${context.org}/${context.repo}${contentPath}`;
      
      // Use regular fetch for full URLs, daFetch for relative paths
      const response = isFullUrl ? await fetch(adminApiUrl) : await actions.daFetch(adminApiUrl);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const jsonData = await response.json();
      const rawItems = Array.isArray(jsonData) ? jsonData : (jsonData.items || jsonData.data || []);
      if (rawItems && rawItems.length > 0) {
        const rawUrl = window.location.href;
        const hasComma = rawUrl.includes('CONTENT%2C') || rawUrl.includes('CONTENT,');
        const effectiveFormat = format || 'CONTENT';
        // Only add comma if the format doesn't already end with one
        const finalFormat = hasComma && !effectiveFormat.endsWith(',') ? `${effectiveFormat},` : effectiveFormat;
        const items = finalFormat ? formatData(jsonData, finalFormat) : rawItems;
        resultDiv.innerHTML = `
          <div class="result">
            ${renderItems(items, 'default')}
          </div>
        `;
      } else {
        resultDiv.innerHTML = `
          <div class="result">
            <pre>${JSON.stringify(jsonData, null, 2)}</pre>
          </div>
        `;
      }
    } catch (error) {
      resultDiv.innerHTML = `
        <div class="no-value">
          <h3>Error Fetching JSON:</h3>
          <p><strong>Path: "${contentPath}"</strong></p>
          <p>Error: ${error.message}</p>
        </div>
      `;
    }
  } else {
    resultDiv.innerHTML = `
      <div class="no-value">
        <h3>No Content Path Found</h3>
        <p>No "content" parameter found in the URL query string.</p>
        <p>Try adding <code>?content=/docs/library/authors.json</code> to the URL.</p>
      </div>
    `;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  displayListValue();
});
