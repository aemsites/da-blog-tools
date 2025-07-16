// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
// eslint-disable-next-line import/no-unresolved
import { DA_ORIGIN } from 'https://da.live/nx/public/utils/constants.js';

// Key name for the ID field in metadata table
const ID_KEY = 'Post_ID';

/**
 * Generates a unique UUID v4 string
 * @returns {string} A unique UUID v4
 */
function generateMetaId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Downloads the page source and examines it for a "metadata" table
 * @param {string} pagePath - The path of the page to examine
 * @param {string} token - Authentication token
 * @param {string} org - Organization name
 * @param {string} repo - Repository name
 * @param {Object} actions - DA actions object
 * @returns {Promise<Object>} Object containing the source content and metadata table info
 */
async function downloadPageSource(pagePath, token, org, repo, actions) {
  try {
    // Construct the source URL for the page
    const sourceUrl = `${DA_ORIGIN}/source/${org}/${repo}${pagePath}.html`;
    
    // Fetch the page source
    const response = await actions.daFetch(sourceUrl);
    
    if (!response.ok) {
      console.error(`Failed to fetch page source: ${response.status} ${response.statusText}`);
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        source: null,
        hasMetadataTable: false,
        metadataTable: null
      };
    }
    
    // Get the source content
    const sourceContent = await response.text();
    
    // Parse the HTML to look for metadata table
    const parser = new DOMParser();
    const doc = parser.parseFromString(sourceContent, 'text/html');
    
    // Look for metadata div or table
    const metadataElement = doc.querySelector('table[name="metadata"], #metadata, .metadata');
    
    let hasMetadataTable = false;
    let tableData = null;
    
    if (metadataElement) {
      hasMetadataTable = true;
      
      // Check if it's a div with class "metadata" (new structure)
      if (metadataElement.classList.contains('metadata')) {
        
        // Extract key-value pairs from div structure
        // Look for the direct child divs that contain the key-value pairs
        const metadataRows = metadataElement.children;
        tableData = [];
        
        // Process each row div
        Array.from(metadataRows).forEach(rowDiv => {
          // Each row div should contain two child divs: one for key, one for value
          const keyValueDivs = rowDiv.children;
          if (keyValueDivs.length >= 2) {
            const keyDiv = keyValueDivs[0];
            const valueDiv = keyValueDivs[1];
            
            // Get the text content from the p elements within each div
            const keyElement = keyDiv.querySelector('p');
            const valueElement = valueDiv.querySelector('p');
            
            const key = keyElement ? keyElement.textContent.trim() : keyDiv.textContent.trim();
            const value = valueElement ? valueElement.textContent.trim() : valueDiv.textContent.trim();
            
            tableData.push([key, value]);
          }
        });
        
        // Output the metadata div as HTML string
        
      } else {
        // Handle traditional table structure
        const rows = metadataElement.querySelectorAll('tr');
        tableData = Array.from(rows).map(row => {
          const cells = row.querySelectorAll('td, th');
          return Array.from(cells).map(cell => cell.textContent.trim());
        });
      }
      
      // Check if any key contains the expected value (case insensitive)
      if (tableData.length > 0) {
        const allKeys = tableData.map(row => row[0]); // Get all keys (first element of each row)
        const matchingKeys = allKeys.filter(key => key.toLowerCase() === ID_KEY.toLowerCase());
        const hasPostIdColumn = matchingKeys.length > 0;
        const hasMultiplePostIds = matchingKeys.length > 1;
        

        
        // Add this information to the return object
        return {
          success: true,
          error: null,
          source: sourceContent,
          hasMetadataTable,
          metadataTable: tableData,
          pagePath,
          hasPostIdColumn,
          hasMultiplePostIds,
          matchingKeys: matchingKeys.length > 0 ? matchingKeys : [],
          allKeys
        };
      }
    }
    
    return {
      success: true,
      error: null,
      source: sourceContent,
      hasMetadataTable,
      metadataTable: tableData,
      pagePath,
      hasPostIdColumn: false,
      hasMultiplePostIds: false,
      matchingKeys: [],
      allKeys: []
    };
    
  } catch (error) {
    console.error('Error downloading page source:', error);
    return {
      success: false,
      error: error.message,
      source: null,
      hasMetadataTable: false,
      metadataTable: null
    };
  }
}

/**
 * Checks for post_id in the page metadata and displays status
 * @param {Object} context - DA context
 * @param {string} token - Authentication token
 * @param {Object} actions - DA actions object
 * @param {HTMLElement} statusContainer - Container to display status
 */
async function checkPostIdStatus(context, token, actions, statusContainer) {
  try {
    // Show loading state
    statusContainer.innerHTML = '<div style="color: #666; font-style: italic;">Checking for post_id...</div>';
    
    // Download page source and check metadata
    const result = await downloadPageSource(context.path, token, context.org, context.repo, actions);
    
    if (result.success && result.hasMetadataTable) {
      if (result.hasPostIdColumn) {
        if (result.hasMultiplePostIds) {
          // Multiple Post_IDs found - show warning and cleanup option
          const matchingRows = result.metadataTable.filter(row => row[0].toLowerCase() === ID_KEY.toLowerCase());
          const postIdValues = matchingRows.map(row => row[1]);
          
          statusContainer.innerHTML = `
            <div style="background-color: #fff3cd; color: #856404; padding: 12px; border-radius: 6px; border: 1px solid #ffeaa7; margin-bottom: 10px;">
              <div style="font-weight: bold; margin-bottom: 10px;">⚠️ Multiple Post_IDs Found</div>
              <div style="margin-bottom: 10px;">Found ${matchingRows.length} Post_ID entries:</div>
              <div style="font-family: monospace; font-size: 12px; margin-bottom: 10px; background: #f8f9fa; padding: 8px; border-radius: 4px;">
                ${postIdValues.map((value, index) => `${index + 1}. ${value}`).join('<br>')}
              </div>
              <div style="margin-bottom: 10px;">This can cause issues. You should clean up duplicate entries.</div>
              <sl-button id="cleanup-post-ids-btn" variant="warning" size="small">
                Clean Up Duplicates
              </sl-button>
            </div>
          `;
          
          // Add event listener
          const cleanupBtn = statusContainer.querySelector('#cleanup-post-ids-btn');
          cleanupBtn.addEventListener('click', () => cleanupMultiplePostIds(context, token, actions, statusContainer, result));
          
        } else {
          // Single Post_ID found - display the value and offer generate button
          const matchingRow = result.metadataTable.find(row => row[0].toLowerCase() === ID_KEY.toLowerCase());
          const postIdValue = matchingRow[1];
          
          statusContainer.innerHTML = `
            <div style="background-color: #d4edda; color: #155724; padding: 12px; border-radius: 6px; border: 1px solid #c3e6cb; margin-bottom: 10px;">
              <div style="font-weight: bold; margin-bottom: 5px;">✅ Post_ID Found</div>
              <div style="font-family: monospace; font-size: 14px; margin-bottom: 10px;">Value: ${postIdValue}</div>
              <sl-button id="generate-post-id-btn" variant="primary" size="small">
                Generate New Post_ID
              </sl-button>
            </div>
          `;
          
          // Add event listener to generate button
          const generateBtn = statusContainer.querySelector('#generate-post-id-btn');
          generateBtn.addEventListener('click', () => generatePostId(context, token, actions, statusContainer));
        }
      } else {
        // Post_ID not found - show generate button
        statusContainer.innerHTML = `
          <div style="background-color: #f8d7da; color: #721c24; padding: 12px; border-radius: 6px; border: 1px solid #f5c6cb; margin-bottom: 10px;">
            <div style="font-weight: bold; margin-bottom: 10px;">❌ Post_ID Missing</div>
            <sl-button id="generate-post-id-btn" variant="primary" size="small">
              Generate Post_ID
            </sl-button>
          </div>
        `;
        
        // Add event listener to generate button
        const generateBtn = statusContainer.querySelector('#generate-post-id-btn');
        generateBtn.addEventListener('click', () => generatePostId(context, token, actions, statusContainer));
      }
    } else {
      // No metadata table found - show generate button
      statusContainer.innerHTML = `
        <div style="background-color: #f8d7da; color: #721c24; padding: 12px; border-radius: 6px; border: 1px solid #f5c6cb; margin-bottom: 10px;">
          <div style="font-weight: bold; margin-bottom: 10px;">❌ Post_ID Missing</div>
          <sl-button id="generate-post-id-btn" variant="primary" size="small">
            Generate Post_ID
          </sl-button>
        </div>
      `;
      
      // Add event listener to generate button
      const generateBtn = statusContainer.querySelector('#generate-post-id-btn');
      generateBtn.addEventListener('click', () => generatePostId(context, token, actions, statusContainer));
    }
  } catch (error) {
    console.error('Error checking post_id status:', error);
    statusContainer.innerHTML = `
      <div style="background-color: #f8d7da; color: #721c24; padding: 12px; border-radius: 6px; border: 1px solid #f5c6cb; margin-bottom: 10px;">
        <div style="font-weight: bold; margin-bottom: 5px;">❌ Error</div>
        <div>Failed to check post_id status: ${error.message}</div>
      </div>
    `;
  }
}

/**
 * Generates a new Post_ID and updates the metadata
 * @param {Object} context - DA context
 * @param {string} token - Authentication token
 * @param {Object} actions - DA actions object
 * @param {HTMLElement} statusContainer - Container to display status
 */
async function generatePostId(context, token, actions, statusContainer) {
  try {
    // Show generating state
    statusContainer.innerHTML = '<div style="color: #666; font-style: italic;">Generating Post_ID...</div>';
    
    // Generate a new Post_ID
    const newPostId = generateMetaId();
    
    // Get current page source to update it
    const result = await downloadPageSource(context.path, token, context.org, context.repo, actions);
    
    if (!result.success) {
      throw new Error('Failed to download page source for update');
    }
    
    // Parse the HTML to find and update the metadata
    const parser = new DOMParser();
    const doc = parser.parseFromString(result.source, 'text/html');
    let metadataElement = doc.querySelector('.metadata');
    
    if (!metadataElement) {
      // No metadata table exists - create one
      metadataElement = doc.createElement('div');
      metadataElement.className = 'metadata';
      
      // Try to append the new metadata table to the first div within main element
      const main = doc.querySelector('main');
      if (main) {
        const firstDiv = main.querySelector('div');
        if (firstDiv) {
          firstDiv.appendChild(metadataElement);
        } else {
          // Fallback to main if no div exists
          main.appendChild(metadataElement);
        }
      } else {
        // Fallback to body if no main element exists
        const body = doc.querySelector('body');
        if (body) {
          body.appendChild(metadataElement);
        } else {
          throw new Error('No main or body element found to append metadata');
        }
      }
    }
    
    // Check if post_id already exists in the metadata
    const existingRows = metadataElement.children;
    let postIdRow = null;
    
    // Find existing post_id row
    Array.from(existingRows).forEach(rowDiv => {
      const keyValueDivs = rowDiv.children;
      if (keyValueDivs.length >= 2) {
        const keyDiv = keyValueDivs[0];
        const keyElement = keyDiv.querySelector('p');
        const key = keyElement ? keyElement.textContent.trim() : keyDiv.textContent.trim();
        
        if (key.toLowerCase() === ID_KEY.toLowerCase()) {
          postIdRow = rowDiv;
        }
      }
    });
    
    if (postIdRow) {
      // Post_ID exists - update the value
      const valueDiv = postIdRow.children[1];
      const valueElement = valueDiv.querySelector('p');
      if (valueElement) {
        valueElement.textContent = newPostId;
      } else {
        valueDiv.textContent = newPostId;
      }
    } else {
      // Post_ID doesn't exist - create new row
      const newMetadataRow = doc.createElement('div');
      newMetadataRow.innerHTML = `
        <div><p>${ID_KEY}</p></div>
        <div><p>${newPostId}</p></div>
      `;
      
      // Add the new row to the metadata element
      metadataElement.appendChild(newMetadataRow);
    }
    
    // Convert the updated document back to HTML string
    let updatedHtml = doc.documentElement.outerHTML;
    
    // Remove HTML comments
    updatedHtml = updatedHtml.replace(/<!--[\s\S]*?-->/g, '');
    
    // Prepare the form data for the POST request
    const body = new FormData();
    body.append('data', new Blob([updatedHtml], { type: 'text/html' }));
    
    // Send the updated HTML back to the source API
    const sourceUrl = `${DA_ORIGIN}/source/${context.org}/${context.repo}${context.path}.html`;
    
    const updateResponse = await actions.daFetch(sourceUrl, {
      method: 'POST',
      body,
    });
    
    if (!updateResponse.ok) {
      throw new Error(`Failed to update page source: ${updateResponse.status} ${updateResponse.statusText}`);
    }
    
    // Show success message with the new post_id
    statusContainer.innerHTML = `
      <div style="background-color: #d4edda; color: #155724; padding: 12px; border-radius: 6px; border: 1px solid #c3e6cb; margin-bottom: 10px;">
        <div style="font-weight: bold; margin-bottom: 5px;">✅ Post_ID Added Successfully</div>
        <div style="font-family: monospace; font-size: 14px; margin-bottom: 10px;">New Post_ID: ${newPostId}</div>
        <div style="font-size: 12px; color: #666;">The Post_ID has been added to the page metadata.</div>
      </div>
    `;
    
  } catch (error) {
    console.error('Error generating Post_ID:', error);
    statusContainer.innerHTML = `
      <div style="background-color: #f8d7da; color: #721c24; padding: 12px; border-radius: 6px; border: 1px solid #f5c6cb; margin-bottom: 10px;">
        <div style="font-weight: bold; margin-bottom: 5px;">❌ Error</div>
        <div>Failed to generate Post_ID: ${error.message}</div>
      </div>
    `;
  }
}

/**
 * Cleans up multiple Post_ID entries by keeping only the first one
 * @param {Object} context - DA context
 * @param {string} token - Authentication token
 * @param {Object} actions - DA actions object
 * @param {HTMLElement} statusContainer - Container to display status
 * @param {Object} result - Result from downloadPageSource
 */
async function cleanupMultiplePostIds(context, token, actions, statusContainer, result) {
  try {
    // Show cleaning state
    statusContainer.innerHTML = '<div style="color: #666; font-style: italic;">Cleaning up duplicate Post_IDs...</div>';
    
    // Parse the HTML to find and update the metadata
    const parser = new DOMParser();
    const doc = parser.parseFromString(result.source, 'text/html');
    const metadataElement = doc.querySelector('.metadata');
    
    if (!metadataElement) {
      throw new Error('No metadata element found to clean up');
    }
    
    // Find all post_id rows
    const existingRows = Array.from(metadataElement.children);
    const postIdRows = [];
    
    existingRows.forEach((rowDiv, index) => {
      const keyValueDivs = rowDiv.children;
      if (keyValueDivs.length >= 2) {
        const keyDiv = keyValueDivs[0];
        const keyElement = keyDiv.querySelector('p');
        const key = keyElement ? keyElement.textContent.trim() : keyDiv.textContent.trim();
        
        if (key.toLowerCase() === ID_KEY.toLowerCase()) {
          postIdRows.push({ row: rowDiv, index });
        }
      }
    });
    
    if (postIdRows.length <= 1) {
      throw new Error('No duplicate Post_IDs found to clean up');
    }
    
    // Keep the first post_id row, remove the rest
    const firstPostIdRow = postIdRows[0];
    const rowsToRemove = postIdRows.slice(1);
    
    // Remove duplicate rows (in reverse order to maintain indices)
    rowsToRemove.reverse().forEach(({ row }) => {
      row.remove();
    });
    
    // Get the value of the remaining post_id
    const valueDiv = firstPostIdRow.row.children[1];
    const valueElement = valueDiv.querySelector('p');
    const remainingPostId = valueElement ? valueElement.textContent.trim() : valueDiv.textContent.trim();
    
    // Convert the updated document back to HTML string
    let updatedHtml = doc.documentElement.outerHTML;
    
    // Remove HTML comments
    updatedHtml = updatedHtml.replace(/<!--[\s\S]*?-->/g, '');
    
    // Prepare the form data for the POST request
    const body = new FormData();
    body.append('data', new Blob([updatedHtml], { type: 'text/html' }));
    
    // Send the updated HTML back to the source API
    const sourceUrl = `${DA_ORIGIN}/source/${context.org}/${context.repo}${context.path}.html`;
    
    const updateResponse = await actions.daFetch(sourceUrl, {
      method: 'POST',
      body,
    });
    
    if (!updateResponse.ok) {
      throw new Error(`Failed to update page source: ${updateResponse.status} ${updateResponse.statusText}`);
    }
    
    // Show success message
    statusContainer.innerHTML = `
      <div style="background-color: #d4edda; color: #155724; padding: 12px; border-radius: 6px; border: 1px solid #c3e6cb; margin-bottom: 10px;">
        <div style="font-weight: bold; margin-bottom: 5px;">✅ Duplicate Post_IDs Cleaned Up</div>
        <div style="font-family: monospace; font-size: 14px; margin-bottom: 10px;">Remaining Post_ID: ${remainingPostId}</div>
        <div style="font-size: 12px; color: #666;">Removed ${rowsToRemove.length} duplicate entries.</div>
        <sl-button id="generate-post-id-btn" variant="primary" size="small" style="margin-top: 10px;">
          Generate New Post_ID
        </sl-button>
      </div>
    `;
    
    // Add event listener to generate button
    const generateBtn = statusContainer.querySelector('#generate-post-id-btn');
    generateBtn.addEventListener('click', () => generatePostId(context, token, actions, statusContainer));
    
  } catch (error) {
    console.error('Error cleaning up Post_IDs:', error);
    statusContainer.innerHTML = `
      <div style="background-color: #f8d7da; color: #721c24; padding: 12px; border-radius: 6px; border: 1px solid #f5c6cb; margin-bottom: 10px;">
        <div style="font-weight: bold; margin-bottom: 5px;">❌ Error</div>
        <div>Failed to clean up Post_IDs: ${error.message}</div>
      </div>
    `;
  }
}

/**
 * Initializes the metadata ID generator tool
 */
async function init() {
  const { context, token, actions } = await DA_SDK;

  // Create UI elements
  const container = document.createElement('div');
  container.style.padding = '20px';
  container.style.fontFamily = 'Arial, sans-serif';

  // Create header
  const header = document.createElement('h2');
  header.textContent = 'Metadata ID Generator';
  header.style.marginBottom = '20px';
  container.appendChild(header);

  // Create status container
  const statusContainer = document.createElement('div');
  statusContainer.id = 'status-container';
  statusContainer.style.marginBottom = '20px';
  container.appendChild(statusContainer);

  // Check for post_id on init
  await checkPostIdStatus(context, token, actions, statusContainer);

  document.body.replaceChildren(container);
}

init();
