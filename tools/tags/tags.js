// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
// eslint-disable-next-line import/no-unresolved
import { DA_ORIGIN } from 'https://da.live/nx/public/utils/constants.js';

/**
 * Fetches the tagging JSON data from the specified endpoint
 * @param {string} token - Authentication token
 * @param {Object} actions - DA actions object
 * @param {string} org - Organization name
 * @param {string} repo - Repository name
 * @returns {Promise<Object>} The tagging JSON data
 */
async function fetchTaggingData(token, actions, org, repo) {
  try {
    const taggingUrl = `${DA_ORIGIN}/source/${org}/${repo}/docs/library/tagging.json`;

    const response = await actions.daFetch(taggingUrl);

    if (!response.ok) {
      // eslint-disable-next-line no-console
      console.error(`Failed to fetch tagging data: ${response.status} ${response.statusText}`);
      return null;
    }

    const taggingData = await response.json();
    return taggingData;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error fetching tagging data:', error);
    return null;
  }
}

/**
 * Displays the tagging data as a multi-selectable searchable interface
 * @param {Object} taggingData - The tagging JSON data
 * @param {Object} actions - DA actions object
 */
function displayTaggingData(taggingData, actions) {
  if (!taggingData) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = '❌ Failed to load tagging data';
    document.body.appendChild(errorDiv);
    return;
  }

  // Create container for tagging data
  const container = document.createElement('div');
  container.className = 'tags-container';

  // Create header
  const header = document.createElement('h2');
  header.textContent = 'TAGGER';
  header.className = 'tags-header';
  container.appendChild(header);

  // Check if data array exists
  if (!taggingData.data || !Array.isArray(taggingData.data)) {
    const noDataDiv = document.createElement('div');
    noDataDiv.className = 'warning-message';
    noDataDiv.textContent = '⚠️ No tagging data found';
    container.appendChild(noDataDiv);
    document.body.appendChild(container);
    return;
  }

  // Create search container
  const searchContainer = document.createElement('div');
  searchContainer.className = 'search-container';

  // Create search input
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search tags...';
  searchInput.className = 'search-input';

  searchContainer.appendChild(searchInput);
  container.appendChild(searchContainer);

  // Create results container
  const resultsContainer = document.createElement('div');
  resultsContainer.className = 'results-container';
  container.appendChild(resultsContainer);

  // Track selected tags
  const selectedTags = new Set();

  // Create select all button
  const selectAllBtn = document.createElement('button');
  selectAllBtn.textContent = 'Select All';
  selectAllBtn.className = 'btn btn-secondary';

  // Create deselect all button
  const deselectAllBtn = document.createElement('button');
  deselectAllBtn.textContent = 'Deselect All';
  deselectAllBtn.className = 'btn btn-secondary';

  // Create send selected button
  const sendSelectedBtn = document.createElement('button');
  sendSelectedBtn.textContent = 'Send Selected (0)';
  sendSelectedBtn.className = 'btn btn-primary';

  // Function to update send button text and state
  function updateSendButton() {
    const count = selectedTags.size;
    sendSelectedBtn.textContent = `Send Selected (${count})`;

    if (count > 0) {
      sendSelectedBtn.className = 'btn btn-primary';
      sendSelectedBtn.disabled = false;
    } else {
      sendSelectedBtn.className = 'btn btn-secondary';
      sendSelectedBtn.disabled = true;
    }
  }

  // Create tag list function
  function renderTagList(filteredData) {
    resultsContainer.innerHTML = '';

    if (filteredData.length === 0) {
      const noResultsDiv = document.createElement('div');
      noResultsDiv.className = 'no-results';
      noResultsDiv.textContent = 'No tags found matching your search';
      resultsContainer.appendChild(noResultsDiv);
      return;
    }

    filteredData.forEach((item) => {
      if (item.value) {
        const tagItem = document.createElement('div');
        tagItem.className = 'tag-item';

        // Create checkbox
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'tag-checkbox';
        checkbox.checked = selectedTags.has(item.key);

        checkbox.addEventListener('change', (e) => {
          if (e.target.checked) {
            selectedTags.add(item.key);
          } else {
            selectedTags.delete(item.key);
          }
          updateSendButton();
        });

        // Create tag info
        const tagInfo = document.createElement('div');
        tagInfo.className = 'tag-info';

        const tagValue = document.createElement('div');
        tagValue.textContent = item.value;
        tagValue.className = 'tag-value';

        const tagKey = document.createElement('div');
        tagKey.textContent = `Key: ${item.key}`;
        tagKey.className = 'tag-key';

        if (item.comments) {
          const tagComments = document.createElement('div');
          tagComments.textContent = item.comments;
          tagComments.className = 'tag-comments';
          tagInfo.appendChild(tagComments);
        }

        tagInfo.appendChild(tagValue);
        tagInfo.appendChild(tagKey);

        // Make entire tag info clickable to toggle checkbox
        tagInfo.addEventListener('click', () => {
          checkbox.checked = !checkbox.checked;
          checkbox.dispatchEvent(new Event('change'));
        });

        tagItem.appendChild(checkbox);
        tagItem.appendChild(tagInfo);

        resultsContainer.appendChild(tagItem);
      }
    });
  }

  // Add search functionality
  searchInput.addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase();
    const filteredData = taggingData.data.filter((item) => item.value && (
      item.value.toLowerCase().includes(searchTerm)
        || item.key.toLowerCase().includes(searchTerm)
        || (item.comments && item.comments.toLowerCase().includes(searchTerm))
    ));
    renderTagList(filteredData);
  });

  // Create action buttons container
  const actionContainer = document.createElement('div');
  actionContainer.className = 'action-container';
  container.appendChild(actionContainer);

  selectAllBtn.addEventListener('click', () => {
    const visibleItems = taggingData.data.filter((item) => item.value);
    visibleItems.forEach((item) => selectedTags.add(item.key));
    renderTagList(taggingData.data.filter((item) => item.value));
    updateSendButton();
  });

  deselectAllBtn.addEventListener('click', () => {
    selectedTags.clear();
    renderTagList(taggingData.data.filter((item) => item.value));
    updateSendButton();
  });

  sendSelectedBtn.addEventListener('click', async () => {
    if (selectedTags.size === 0) return;

    try {
      // Send all selected tags
      const selectedTagsArray = Array.from(selectedTags);
      const tagsText = selectedTagsArray.join(', ');

      await actions.sendText(tagsText);
      await actions.closeLibrary();

      // eslint-disable-next-line no-console
      console.log('Selected tags sent to document:', selectedTagsArray);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error sending selected tags to document:', error);

      // Show error feedback
      const originalText = sendSelectedBtn.textContent;

      sendSelectedBtn.textContent = '✗ Error';
      sendSelectedBtn.className = 'btn btn-error';
      sendSelectedBtn.disabled = true;

      setTimeout(() => {
        sendSelectedBtn.textContent = originalText;
        sendSelectedBtn.className = 'btn btn-primary';
        sendSelectedBtn.disabled = false;
      }, 2000);
    }
  });

  actionContainer.appendChild(selectAllBtn);
  actionContainer.appendChild(deselectAllBtn);
  actionContainer.appendChild(sendSelectedBtn);

  // Initial render
  renderTagList(taggingData.data.filter((item) => item.value));
  updateSendButton();

  document.body.appendChild(container);
}

/**
 * Initializes the tags tool
 */
async function init() {
  try {
    const { context, token, actions } = await DA_SDK;

    // Fetch tagging data
    const taggingData = await fetchTaggingData(token, actions, context.org, context.repo);

    // Display tagging data
    displayTaggingData(taggingData, actions);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error initializing tags tool:', error);

    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = '❌ Error initializing tags tool';
    document.body.appendChild(errorDiv);
  }
}

init();
