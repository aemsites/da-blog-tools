// eslint-disable-next-line import/no-unresolved
import { daFetch } from 'https://da.live/nx/utils/daFetch.js';
// eslint-disable-next-line import/no-unresolved
import { crawl } from 'https://da.live/nx/public/utils/tree.js';
import {
  $, buildTreeStructure, renderTree, renderBreadcrumb, renderLog, renderError,
} from './shared.js';

const DA_ORIGIN = 'https://admin.da.live';

const state = {
  org: '',
  site: '',
  source: { name: '', site: '' },
  currentPath: '/',
  pages: [],
  folders: [],
  localPages: new Set(),
  copyStatuses: {},
  filter: '',
  log: [],
  treeData: {},
  treeLoading: false,
};

/* ------------------------------------------------------------------ */
/*  API                                                                */
/* ------------------------------------------------------------------ */

async function listSourcePath(path) {
  const clean = path.replace(/\/+$/, '') || '/';
  const resp = await daFetch(`${DA_ORIGIN}/list/${state.org}/${state.source.site}${clean}`);
  if (!resp.ok) throw new Error(`Could not list source path ${clean}`);
  return resp.json();
}

async function checkLocalExistence(path) {
  try {
    const clean = path.replace(/\/+$/, '') || '/';
    const resp = await daFetch(`${DA_ORIGIN}/list/${state.org}/${state.site}${clean}`);
    if (!resp.ok) return new Set();
    const items = await resp.json();
    return new Set(items.filter((i) => i.ext === 'html').map((i) => i.name));
  } catch {
    return new Set();
  }
}

async function copyPage(pagePath) {
  const sourceResp = await daFetch(
    `${DA_ORIGIN}/source/${state.org}/${state.source.site}${pagePath}`,
  );
  if (!sourceResp.ok) throw new Error(`Failed to read source (${sourceResp.status})`);

  const html = rewriteLinks(await sourceResp.text());
  const blob = new Blob([html], { type: 'text/html' });
  const body = new FormData();
  body.append('data', blob, pagePath.split('/').pop());

  const putResp = await daFetch(
    `${DA_ORIGIN}/source/${state.org}/${state.site}${pagePath}`,
    { method: 'PUT', body },
  );
  return putResp.ok;
}

async function deleteLocalPage(pagePath) {
  const resp = await daFetch(
    `${DA_ORIGIN}/source/${state.org}/${state.site}${pagePath}`,
    { method: 'DELETE' },
  );
  return resp.ok;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function rewriteLinks(html) {
  const { site: src } = state.source;
  const dest = state.site;
  return html
    .replaceAll(`main--${src}--${state.org}.aem.page`, `main--${dest}--${state.org}.aem.page`)
    .replaceAll(`main--${src}--${state.org}.aem.live`, `main--${dest}--${state.org}.aem.live`)
    .replaceAll(`/${state.org}/${src}/`, `/${state.org}/${dest}/`);
}

function editUrl(pagePath) {
  return `https://da.live/edit#/${state.org}/${state.site}${pagePath.replace(/\.html$/, '')}`;
}

function getPagePath(pageName) {
  return `${state.currentPath.replace(/\/+$/, '')}/${pageName}`;
}

function refreshLog() {
  renderLog($('#log-area'), state.log, () => { state.log.length = 0; });
}

function addLog(message, type = 'info') {
  state.log.push({ message, type, time: new Date().toLocaleTimeString() });
  refreshLog();
}

/* ------------------------------------------------------------------ */
/*  Browse                                                             */
/* ------------------------------------------------------------------ */

async function browse(path, isSingleFile = false) {
  const dir = isSingleFile
    ? (path.substring(0, path.lastIndexOf('/')) || '/')
    : path;

  state.currentPath = dir;
  state.pages = [];
  state.folders = [];
  state.localPages = new Set();
  state.copyStatuses = {};
  state.filter = '';

  renderResults(true);

  try {
    if (isSingleFile) {
      state.pages = [{ name: path.substring(path.lastIndexOf('/') + 1), ext: 'html' }];
    } else {
      const items = await listSourcePath(dir);
      state.folders = items.filter((i) => i['content-type'] === 'application/folder');
      state.pages = items.filter((i) => i.ext === 'html');
    }

    state.localPages = await checkLocalExistence(dir);
    renderResults();
  } catch (err) {
    renderError($('#results-area'), err.message);
  }
}

/* ------------------------------------------------------------------ */
/*  Page Tree (crawls SOURCE site)                                     */
/* ------------------------------------------------------------------ */

async function loadTree() {
  state.treeLoading = true;
  refreshTree();

  try {
    const files = [];
    const basePath = `/${state.org}/${state.source.site}`;

    const { results } = crawl({
      path: `${basePath}/`,
      callback: (item) => {
        if (item.path.endsWith('.html') || item.path.endsWith('.json')) files.push(item);
      },
      concurrent: 50,
      throttle: 3,
    });

    await results;
    state.treeData = buildTreeStructure(files, basePath);
  } catch (err) {
    state.treeData = {};
    addLog(`Failed to load source tree: ${err.message}`, 'error');
  }

  state.treeLoading = false;
  refreshTree();
}

function refreshTree() {
  renderTree(
    $('#tree-panel'), state.treeData, state.treeLoading,
    { loading: 'Loading source tree…', empty: 'No pages found in source.' },
    browse,
  );
}

/* ------------------------------------------------------------------ */
/*  Copy & Delete                                                      */
/* ------------------------------------------------------------------ */

async function onCopy(pageName) {
  const pagePath = getPagePath(pageName);
  state.copyStatuses[pageName] = 'copying';
  renderResultsTable();

  try {
    addLog(`Copying ${pageName} from ${state.source.name}…`, 'info');
    const ok = await copyPage(pagePath);
    if (ok) {
      state.copyStatuses[pageName] = 'copied';
      state.localPages.add(pageName);
      addLog(`Copied ${pageName}`, 'success');
    } else {
      state.copyStatuses[pageName] = 'error';
      addLog(`Failed to copy ${pageName}`, 'error');
    }
  } catch (err) {
    state.copyStatuses[pageName] = 'error';
    addLog(`Error copying ${pageName}: ${err.message}`, 'error');
  }

  renderResultsTable();
}

async function onDelete(pageName) {
  const pagePath = getPagePath(pageName);
  // eslint-disable-next-line no-alert
  if (!window.confirm(`Remove ${pageName} from this site? The file will be deleted; a later rollout will not see a local copy at this path.`)) return;

  state.copyStatuses[pageName] = 'deleting';
  renderResultsTable();

  try {
    addLog(`Deleting ${pageName}…`, 'info');
    const ok = await deleteLocalPage(pagePath);
    if (ok) {
      delete state.copyStatuses[pageName];
      state.localPages.delete(pageName);
      addLog(`Deleted ${pageName}`, 'success');
    } else {
      state.copyStatuses[pageName] = 'error';
      addLog(`Failed to delete ${pageName}`, 'error');
    }
  } catch (err) {
    state.copyStatuses[pageName] = 'error';
    addLog(`Error deleting ${pageName}: ${err.message}`, 'error');
  }

  renderResultsTable();
}

/* ------------------------------------------------------------------ */
/*  Rendering                                                          */
/* ------------------------------------------------------------------ */

function render(container) {
  container.innerHTML = `
    <section class="sync-source-info">
      <h3>Source</h3>
      <div class="sync-source-detail">
        <span class="sync-chip">${state.source.name}</span>
        <span class="sync-source-path">${state.org}/${state.source.site}</span>
      </div>
    </section>

    <div class="sc-layout">
      <aside class="sc-tree-panel">
        <div class="sc-tree-header">
          <h3>Source Pages</h3>
        </div>
        <div class="sc-tree-body" id="tree-panel">
          <div class="sc-tree-loading">
            <div class="sc-spinner"></div>
            <p>Loading source tree…</p>
          </div>
        </div>
      </aside>

      <div class="sc-content">
        <div id="breadcrumb-area"></div>
        <div id="results-area">
          <div class="sc-empty">
            <div class="sc-empty-icon">📂</div>
            <h3>Select a folder or page</h3>
            <p>Browse the source tree to find pages to copy into your site.</p>
          </div>
        </div>
        <div id="log-area"></div>
      </div>
    </div>
  `;

  loadTree();
}

function renderResults(loading = false) {
  if (loading) {
    $('#results-area').innerHTML = `
      <div class="sc-results-card">
        <div class="sc-loading" style="min-height:200px">
          <div class="sc-spinner"></div>
          <p>Loading content…</p>
        </div>
      </div>`;
    return;
  }

  renderBreadcrumb($('#breadcrumb-area'), state.currentPath, browse);

  if (!state.pages.length && !state.folders.length) {
    $('#results-area').innerHTML = `
      <div class="sc-results-card">
        <div class="sc-empty">
          <div class="sc-empty-icon">📂</div>
          <h3>No content found</h3>
          <p>No pages found at <strong>${state.currentPath}</strong> in the source site.</p>
        </div>
      </div>`;
    return;
  }

  const foldersHtml = state.folders.length
    ? `<div class="sc-folders">
      ${state.folders.map((f) => {
    const p = `${state.currentPath.replace(/\/+$/, '')}/${f.name}`;
    return `<a href="#" class="sc-folder" data-path="${p}">
              <span class="sc-folder-icon">📁</span>${f.name}
            </a>`;
  }).join('')}
    </div>`
    : '';

  const filterHtml = state.pages.length
    ? `<div class="sc-filter-row">
        <sl-input id="filter-input" type="text"
               placeholder="Filter results by name…"></sl-input>
      </div>`
    : '';

  const resultsArea = $('#results-area');
  resultsArea.innerHTML = `
    ${foldersHtml}
    <div class="sc-results-card" id="results-card">
      <div class="sc-results-header">
        <h3>Pages in Source</h3>
        <span class="sc-results-count">${state.pages.length} page${state.pages.length !== 1 ? 's' : ''}</span>
      </div>
      ${filterHtml}
      <div class="sc-table-wrap" id="table-wrap"></div>
    </div>`;

  renderResultsTable();

  $('#filter-input')?.addEventListener('input', (e) => {
    state.filter = e.target.value.toLowerCase();
    renderResultsTable();
  });

  resultsArea.querySelectorAll('.sc-folder').forEach((f) => {
    f.addEventListener('click', (e) => {
      e.preventDefault();
      browse(f.dataset.path);
    });
  });
}

function renderResultsTable() {
  const wrap = $('#table-wrap');
  if (!wrap) return;

  const filtered = state.filter
    ? state.pages.filter((p) => p.name.toLowerCase().includes(state.filter))
    : state.pages;

  wrap.innerHTML = `
    <table class="sc-table">
      <thead>
        <tr>
          <th>Page</th>
          <th>Local Status</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        ${filtered.map((page) => renderRow(page)).join('')}
      </tbody>
    </table>`;

  if (!filtered.length) {
    wrap.innerHTML += '<div class="sc-empty" style="padding:24px"><p>No pages match the filter.</p></div>';
  }

  bindTableEvents();
}

function renderRow(page) {
  const pagePath = getPagePath(page.name);
  const existsLocally = state.localPages.has(page.name);
  const copyStatus = state.copyStatuses[page.name];

  let badge;
  let btnLabel;
  let btnDisabled = '';
  let editLink = '';

  if (copyStatus === 'copying') {
    badge = '<span class="sync-badge-status sync-badge-copying">Copying…</span>';
    btnLabel = 'Copying…';
    btnDisabled = 'disabled';
  } else if (copyStatus === 'deleting') {
    badge = '<span class="sync-badge-status sync-badge-copying">Deleting…</span>';
    btnLabel = 'Deleting…';
    btnDisabled = 'disabled';
  } else if (copyStatus === 'copied') {
    badge = '<span class="sync-badge-status sync-badge-copied">Copied</span>';
    btnLabel = 'Copied';
    btnDisabled = 'disabled';
    editLink = `<a href="${editUrl(pagePath)}" target="_blank" class="sync-edit-link">✎ Edit</a>`;
  } else if (copyStatus === 'error') {
    badge = '<span class="sync-badge-status sync-badge-error">Error</span>';
    btnLabel = 'Retry';
  } else if (existsLocally) {
    badge = '<span class="sync-badge-status sync-badge-exists">Exists locally</span>';
    btnLabel = 'Overwrite';
  } else {
    badge = '<span class="sync-badge-status sync-badge-missing">Not found</span>';
    btnLabel = 'Copy';
  }

  const showDelete = existsLocally && !['copying', 'deleting', 'copied'].includes(copyStatus || '');
  const actionsHtml = showDelete
    ? `<span class="sync-action-group">
        <sl-button class="sync-copy-btn" data-page="${page.name}" ${btnDisabled}>${btnLabel}</sl-button>
        <sl-button class="sync-delete-btn" variant="neutral" data-page="${page.name}" ${btnDisabled}>Delete</sl-button>
      </span>`
    : `<sl-button class="sync-copy-btn" data-page="${page.name}" ${btnDisabled}>${btnLabel}</sl-button>`;

  return `<tr data-page="${page.name}">
    <td>
      <span class="sc-page-name">${page.name.replace(/\.html$/, '')}</span>
      <span class="sc-page-path">${pagePath}</span>
    </td>
    <td>${badge}</td>
    <td>${actionsHtml}${editLink}</td>
  </tr>`;
}

/* ------------------------------------------------------------------ */
/*  Event Binding                                                      */
/* ------------------------------------------------------------------ */

function bindTableEvents() {
  document.querySelectorAll('.sync-copy-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.page) onCopy(btn.dataset.page);
    });
  });
  document.querySelectorAll('.sync-delete-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.page) onDelete(btn.dataset.page);
    });
  });
}

/* ------------------------------------------------------------------ */
/*  Init                                                               */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line import/prefer-default-export
export function initSatellite({
  org, site, config, container,
}) {
  state.org = org;
  state.site = site;
  state.source = config.source;
  render(container);
}
