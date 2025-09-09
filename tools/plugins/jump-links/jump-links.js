/* eslint-disable import/no-unresolved */
import DA_SDK from 'https://da.live/nx/utils/sdk.js';

async function getCurrentPageUrl() {
  try {
    const { context } = await DA_SDK;
    return `https://main--${context.repo}--${context.org}.aem.page${context.path}`;
  } catch (error) {
    return window.location.href.split('#')[0];
  }
}

async function updatePreview() {
  const checkedBoxes = document.querySelectorAll('input[name="selected-headings"]:checked');
  const previewContainer = document.getElementById('links-preview');
  const createButton = document.getElementById('create-links');

  const selectedLinks = [];

  // Get selected headings with their custom titles
  checkedBoxes.forEach((checkbox) => {
    const index = checkbox.id.split('-')[1];
    const titleInput = document.getElementById(`title-${index}`);
    const headingId = checkbox.value;
    const linkTitle = titleInput ? titleInput.value.trim() : checkbox.dataset.headingText;

    if (linkTitle) {
      selectedLinks.push({
        id: headingId,
        title: linkTitle,
      });
    }
  });

  // Update preview
  if (selectedLinks.length === 0) {
    previewContainer.innerHTML = `
      <div class="empty-state">
        <p>Select headings to see preview</p>
      </div>
    `;
    createButton.disabled = true;
  } else {
    const baseUrl = await getCurrentPageUrl();

    const previewHtml = selectedLinks.map((link) => `<a href="${baseUrl}#${link.id}" class="preview-link-item" target="_blank" title="${link.title}">${link.title}</a>`).join('');

    previewContainer.innerHTML = previewHtml;
    createButton.disabled = false;
  }
}

async function scanPageHeadings() {
  const statusMessage = document.getElementById('status-message');
  const mainContent = document.getElementById('main-content');
  const headingsList = document.getElementById('headings-list');

  statusMessage.textContent = 'Scanning page for headings...';
  statusMessage.className = 'status-message loading';

  try {
    const { context } = await DA_SDK;
    const previewUrl = `https://main--${context.repo}--${context.org}.aem.page${context.path}`;

    const response = await fetch(previewUrl);
    if (!response.ok) {
      throw new Error('Could not fetch preview page');
    }

    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const headings = doc.querySelectorAll('h1, h2, h3, h4, h5, h6');

    if (headings.length === 0) {
      statusMessage.textContent = 'No headings with IDs found on the page.';
      statusMessage.className = 'status-message error';
      return;
    }

    headingsList.innerHTML = '';

    let validHeadingsCount = 0;

    headings.forEach((heading, index) => {
      const headingText = heading.textContent.trim();
      const headingLevel = heading.tagName.toLowerCase();
      const headingId = heading.id;

      if (headingText && headingId) {
        validHeadingsCount += 1;
        const optionContainer = document.createElement('div');
        optionContainer.className = 'heading-option';

        const checkboxRow = document.createElement('div');
        checkboxRow.className = 'heading-checkbox-row';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.name = 'selected-headings';
        checkbox.value = headingId;
        checkbox.id = `heading-${index}`;
        checkbox.dataset.headingText = headingText;

        const label = document.createElement('label');
        label.htmlFor = `heading-${index}`;
        label.textContent = `${headingLevel.toUpperCase()}: ${headingText} (#${headingId})`;

        const titleField = document.createElement('div');
        titleField.className = 'title-field';
        titleField.innerHTML = `
          <label for="title-${index}">Link title:</label>
          <input type="text" id="title-${index}" value="${headingText}" placeholder="Enter link title">
        `;

        checkboxRow.appendChild(checkbox);
        checkboxRow.appendChild(label);
        optionContainer.appendChild(checkboxRow);
        optionContainer.appendChild(titleField);
        headingsList.appendChild(optionContainer);

        checkbox.addEventListener('change', () => {
          if (checkbox.checked) {
            titleField.classList.add('visible');
          } else {
            titleField.classList.remove('visible');
          }
          updatePreview();
        });

        const titleInput = titleField.querySelector('input');
        titleInput.addEventListener('input', updatePreview);
      }
    });

    if (validHeadingsCount === 0) {
      statusMessage.textContent = 'No headings with IDs found on the page.';
      statusMessage.className = 'status-message error';
      return;
    }

    statusMessage.textContent = `Found ${validHeadingsCount} headings with IDs on the page.`;
    statusMessage.className = 'status-message success';
    mainContent.style.display = 'block';
  } catch (error) {
    statusMessage.textContent = 'Could not scan page. Please preview your page first, then try again.';
    statusMessage.className = 'status-message error';
  }
}

async function createJumpLinks() {
  const checkedBoxes = document.querySelectorAll('input[name="selected-headings"]:checked');
  const selectedLinks = [];

  checkedBoxes.forEach((checkbox) => {
    const index = checkbox.id.split('-')[1];
    const titleInput = document.getElementById(`title-${index}`);
    const headingId = checkbox.value;
    const linkTitle = titleInput ? titleInput.value.trim() : checkbox.dataset.headingText;

    if (linkTitle) {
      selectedLinks.push({
        id: headingId,
        title: linkTitle,
      });
    }
  });

  if (selectedLinks.length === 0) return;

  const baseUrl = await getCurrentPageUrl();
  const linksHtml = selectedLinks.map((link) => `<p><a href="${baseUrl}#${link.id}" title="${link.title}">${link.title}</a></p>`).join('');

  const { actions } = await DA_SDK;
  actions.sendHTML(linksHtml);
  actions.closeLibrary();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('scan-headings').addEventListener('click', scanPageHeadings);
  document.getElementById('create-links').addEventListener('click', createJumpLinks);
});
