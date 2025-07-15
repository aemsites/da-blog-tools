// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
// eslint-disable-next-line import/no-unresolved
import { DA_ORIGIN } from 'https://da.live/nx/public/utils/constants.js';

// change this prefix to something like '.your-prefix/ghost-links.json'. Using .da might result in
// the sheet being inaccessible to the tool at some point.
const GHOST_LINKS_SHEET = '.da/ghost-links.json';
// change this to the url of the site you are working on
const GHOST_LINK_BASE = '/blogs/';

// eslint-disable-next-line no-use-before-define
function generateGhostId() {
  // Generate a random 6-digit number
  const random = Math.floor(Math.random() * 900000) + 100000; // 100000 to 999999
  return random.toString();
}

async function updateSheet(path, token, org, repo, actions) {
  const response = await actions.daFetch(`${DA_ORIGIN}/source/${org}/${repo}/${GHOST_LINKS_SHEET}`);

  if (response.ok) {
    const json = await response.json();
    // eslint-disable-next-line no-console
    console.log('Fetched JSON:', json);

    // Check if the JSON has a data array with items containing destination field
    if (json.data && Array.isArray(json.data)) {
      // Look for any item in the data array where destination matches the path
      const matchingItem = json.data.find((item) => item.destination === path);

      if (matchingItem) {
        // eslint-disable-next-line no-console
        console.log(`✅ Found matching destination field: ${path} -> ${matchingItem.source}`);
        return matchingItem.source;
      }

      // eslint-disable-next-line no-console
      console.log(`❌ No item found with destination field matching: ${path}`);
      // eslint-disable-next-line no-console
      console.log('Available destinations:', json.data.map((item) => item.destination));

      // Generate a new Ghost ID
      const ghostId = generateGhostId();

      // Add a new row to the data array
      const newRow = {
        source: ghostId,
        destination: path,
      };

      json.data.push(newRow);
      // eslint-disable-next-line no-console
      console.log(`➕ Added new row: ${ghostId} -> ${path}`);

      // Save the updated JSON back to the sheet
      try {
        const body = new FormData();
        body.append('data', new Blob([JSON.stringify(json)], { type: 'application/json' }));
        const updateResponse = await actions.daFetch(`${DA_ORIGIN}/source/${org}/${repo}/${GHOST_LINKS_SHEET}`, {
          method: 'POST',
          body,
        });

        if (updateResponse.ok) {
          // eslint-disable-next-line no-console
          console.log('✅ Successfully updated ghost-links sheet');
          return ghostId;
        }

        // eslint-disable-next-line no-console
        console.log(`❌ Failed to update sheet: ${updateResponse.status} ${updateResponse.statusText}`);
        return null;
      } catch (error) {
        // eslint-disable-next-line no-console
        console.log('❌ Error updating sheet:', error);
        return null;
      }
    }

    // eslint-disable-next-line no-console
    console.log('❌ JSON does not contain a data array');
    return null;
  }

  // eslint-disable-next-line no-console
  console.log(`❌ Failed to fetch sheet: ${response.status} ${response.statusText}`);
  return null;
}

async function init() {
  const { context, token, actions } = await DA_SDK;

  const ghostLink = `https://main--${context.repo}--${context.org}.aem.page${GHOST_LINK_BASE}`;

  // Create UI elements
  const container = document.createElement('div');
  container.style.padding = '20px';

  const generateButton = document.createElement('sl-button');
  generateButton.innerHTML = 'Get Ghost ID';
  generateButton.addEventListener('click', async () => {
    try {
      // eslint-disable-next-line no-console
      console.log(context);
      const ghostId = await updateSheet(context.path, token, context.org, context.repo, actions);
      if (ghostId) {
        const ghostUrl = `${ghostLink}?p=${ghostId}`;

        // Create a container for the result
        const resultContainer = document.createElement('div');
        resultContainer.className = 'result-container';

        // Create the URL display
        const urlDisplay = document.createElement('p');
        urlDisplay.innerHTML = ghostUrl;
        urlDisplay.className = 'url-display';

        // Create copy button
        const copyButton = document.createElement('sl-button');
        copyButton.innerHTML = 'Copy URL';
        copyButton.size = 'small';
        copyButton.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(ghostUrl);
            copyButton.innerHTML = 'Copied!';
            copyButton.disabled = true;
            setTimeout(() => {
              copyButton.innerHTML = 'Copy URL';
              copyButton.disabled = false;
            }, 2000);
          } catch (error) {
            // eslint-disable-next-line no-console
            console.error('Failed to copy to clipboard:', error);
            copyButton.innerHTML = 'Copy Failed';
            setTimeout(() => {
              copyButton.innerHTML = 'Copy URL';
            }, 2000);
          }
        });

        resultContainer.appendChild(urlDisplay);
        resultContainer.appendChild(copyButton);
        generateButton.parentElement.appendChild(resultContainer);

        // Also copy to clipboard automatically
        try {
          await navigator.clipboard.writeText(ghostUrl);
          // eslint-disable-next-line no-console
          console.log('URL copied to clipboard automatically');
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error('Failed to copy to clipboard automatically:', error);
        }
      } else {
        actions.sendText('Error occurred while generating Ghost ID');
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error:', error);
      actions.sendText('Error occurred while generating Ghost ID');
    }
  });

  const contextButton = document.createElement('sl-button');
  contextButton.innerHTML = 'Show Context Info';
  contextButton.style.marginTop = '10px';
  contextButton.addEventListener('click', () => {
    const contextInfo = JSON.stringify(context, null, 2);
    // eslint-disable-next-line no-console
    console.log('Full Context:', contextInfo);
    actions.sendText(`Context keys: ${Object.keys(context).join(', ')}`);
  });

  const pathButton = document.createElement('sl-button');
  pathButton.innerHTML = 'Send Document Path';
  pathButton.style.marginTop = '10px';
  pathButton.addEventListener('click', () => {
    const pathInfo = `Document: ${context.path} | Org: ${context.org} | Repo: ${context.repo}`;
    actions.sendText(pathInfo);
  });

  container.appendChild(generateButton);
  // container.appendChild(contextButton);
  // container.appendChild(pathButton);
  document.body.replaceChildren(container);
}

init();
