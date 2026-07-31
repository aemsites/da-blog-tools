// eslint-disable-next-line import/no-unresolved
import { daFetch } from 'https://da.live/nx/utils/daFetch.js';
// eslint-disable-next-line import/no-unresolved
import { crawl } from 'https://da.live/nx/public/utils/tree.js';
import {
  $, buildTreeStructure, renderTree, renderBreadcrumb, renderLog, renderError,
} from './shared.js';

const DA_ORIGIN = 'https://admin.da.live';
const AEM_ORIGIN = 'https://admin.hlx.page';

const state = {
  org: '',
  site: '',
  sites: [],
  hiddenSites: new Set(),
  currentPath: '/',
  pages: [],
  folders: [],
  siteContent: {},
  actions: {},
  statuses: {},
  previewDone: false,
  isProcessing: false,
  filter: '',
  log: [],
  treeData: {},
  treeLoading: false,
};

function visibleSites() {
  return state.sites.filter((s) => !state.hiddenSites.has(s.site));
}

/* ------------------------------------------------------------------ */
/*  API                                                                */
/* ------------------------------------------------------------------ */

async function listPath(path) {
  const clean = path.replace(/\/+$/, '') || '/';
  const resp = await daFetch(`${DA_ORIGIN}/list/${state.org}/${state.site}${clean}`);
  if (!resp.ok) throw new Error(`Could not list ${clean}`);
  return resp.json();
}

async function listSitePath(targetSite, path) {
  try {
    const clean = path.replace(/\/+$/, '') || '/';
    const resp = await daFetch(`${DA_ORIGIN}/list/${state.org}/${targetSite}${clean}`);
    if (!resp.ok) return [];
    return resp.json();
  } catch {
    return [];
  }
}

async function aemAdminPost(action, targetSite, pagePath) {
  const aemPath = pagePath.replace(/\.html$/, '');
  const resp = await daFetch(
    `${AEM_ORIGIN}/${action}/${state.org}/${targetSite}/main${aemPath}`,
    { method: 'POST' },
  );
  return resp.ok;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function actionKey(pageName, targetSite) {
  return `${pageName}::${targetSite}`;
}

function getPagePath(pageName) {
  return `${state.currentPath.replace(/\/+$/, '')}/${pageName}`;
}

function previewUrl(targetSite, pagePath) {
  let aemPath = pagePath.replace(/\.html$/, '');
  if (/\/index$/i.test(aemPath)) {
    aemPath = aemPath.replace(/\/index$/i, '/') || '/';
  }
  return `https://main--${targetSite}--${state.org}.aem.page${aemPath}`;
}

function refreshLog() {
  renderLog($('#log-area'), state.log, () => { state.log.length = 0; });
}

function addLog(message, type = 'info') {
  state.log.push({ message, type, time: new Date().toLocaleTimeString() });
  refreshLog();
}

/* ------------------------------------------------------------------ */
/*  Browse & Check                                                     */
/* ------------------------------------------------------------------ */

async function browse(path, isSingleFile = false) {
  const dir = isSingleFile
    ? (path.substring(0, path.lastIndexOf('/')) || '/')
    : path;

  state.currentPath = dir;
  state.pages = [];
  state.folders = [];
  state.siteContent = {};
  state.actions = {};
  state.statuses = {};
  state.previewDone = false;
  state.filter = '';

  renderResults(true);

  try {
    if (isSingleFile) {
      state.pages = [{ name: path.substring(path.lastIndexOf('/') + 1), ext: 'html' }];
    } else {
      const items = await listPath(dir);
      state.folders = items.filter((i) => i['content-type'] === 'application/folder');
      state.pages = items.filter((i) => i.ext === 'html');
    }

    await checkSiteExistence(dir);

    state.pages.forEach((page) => {
      state.sites.forEach((s) => {
        const key = actionKey(page.name, s.site);
        state.actions[key] = 'skip';
        state.statuses[key] = state.siteContent[s.site]?.has(page.name) ? 'exists' : 'missing';
      });
    });

    renderResults();
  } catch (err) {
    renderError($('#results-area'), err.message);
  }
}

async function checkSiteExistence(path) {
  await Promise.all(state.sites.map(async (s) => {
    const items = await listSitePath(s.site, path);
    state.siteContent[s.site] = new Set(
      items.filter((i) => i.ext === 'html').map((i) => i.name),
    );
  }));
}

/* ------------------------------------------------------------------ */
/*  Page Tree                                                          */
/* ------------------------------------------------------------------ */

async function loadTree() {
  state.treeLoading = true;
  refreshTree();

  try {
    const files = [];
    const basePath = `/${state.org}/${state.site}`;

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
    addLog(`Failed to load page tree: ${err.message}`, 'error');
  }

  state.treeLoading = false;
  refreshTree();
}

function refreshTree() {
  renderTree(
    $('#tree-panel'), state.treeData, state.treeLoading,
    { loading: 'Loading page tree…', empty: 'No pages found.' },
    browse,
  );
}

/* ------------------------------------------------------------------ */
/*  Preview & Publish                                                  */
/* ------------------------------------------------------------------ */

async function runBatch(action) {
  const isPreview = action === 'preview';
  const source = isPreview ? state.actions : state.statuses;
  const keep = isPreview ? (v) => v !== 'skip' : (v) => v === 'previewed';
  const aemAction = isPreview ? 'preview' : 'live';
  const doneStatus = isPreview ? 'previewed' : 'published';
  const label = isPreview ? 'Preview' : 'Publish';

  const vis = new Set(visibleSites().map((s) => s.site));
  const tasks = [];
  Object.entries(source).forEach(([key, val]) => {
    if (!keep(val)) return;
    const [pageName, targetSite] = key.split('::');
    if (!vis.has(targetSite)) return;
    tasks.push({ pageName, targetSite, key });
  });
  if (!tasks.length) return;

  state.isProcessing = true;
  renderActionBar();
  renderProgress(0, tasks.length, `Starting ${label.toLowerCase()}…`);

  await tasks.reduce(async (prev, task, i) => {
    await prev;
    const pagePath = getPagePath(task.pageName);
    try {
      addLog(`${label}ing ${task.pageName} at ${task.targetSite}`, 'info');
      const ok = await aemAdminPost(aemAction, task.targetSite, pagePath);
      state.statuses[task.key] = ok ? doneStatus : 'error';
      addLog(
        ok
          ? `${label}ed ${task.pageName} at ${task.targetSite}`
          : `Failed to ${label.toLowerCase()} ${task.pageName} at ${task.targetSite}`,
        ok ? 'success' : 'error',
      );
    } catch (err) {
      addLog(`Error: ${err.message}`, 'error');
      state.statuses[task.key] = 'error';
    }
    renderProgress(i + 1, tasks.length, `${label}ing ${i + 1}/${tasks.length}`);
    renderResultsCells();
  }, Promise.resolve());

  state.isProcessing = false;
  if (isPreview) state.previewDone = true;
  renderProgress(tasks.length, tasks.length, `${label} complete`);
  renderActionBar();
}

/* ------------------------------------------------------------------ */
/*  Rendering                                                          */
/* ------------------------------------------------------------------ */

function render(container) {
  container.innerHTML = `
    <section class="sc-sites">
      <h3>Satellite Sites</h3>
      <div class="sc-site-chips" id="site-chips"></div>
    </section>

    <div class="sc-layout">
      <aside class="sc-tree-panel">
        <div class="sc-tree-header">
          <h3>Page Tree</h3>
        </div>
        <div class="sc-tree-body" id="tree-panel">
          <div class="sc-tree-loading">
            <div class="sc-spinner"></div>
            <p>Loading page tree…</p>
          </div>
        </div>
      </aside>

      <div class="sc-content">
        <div id="breadcrumb-area"></div>
        <div id="results-area">
          <div class="sc-empty">
            <div class="sc-empty-icon">📂</div>
            <h3>Select a folder</h3>
            <p>Choose a folder from the page tree to browse its content.</p>
          </div>
        </div>
        <div id="action-area"></div>
        <div id="progress-area"></div>
        <div id="log-area"></div>
      </div>
    </div>
  `;

  renderChips();
  loadTree();
}

function renderChips() {
  const area = $('#site-chips');
  area.innerHTML = state.sites.map((s) => {
    const hidden = state.hiddenSites.has(s.site);
    return `<span class="sc-chip${hidden ? ' sc-chip-hidden' : ''}" data-site="${s.site}">${s.name}</span>`;
  }).join('');

  area.querySelectorAll('.sc-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const { site } = chip.dataset;
      if (state.hiddenSites.has(site)) {
        state.hiddenSites.delete(site);
      } else {
        state.hiddenSites.add(site);
      }
      renderChips();
      if (state.pages.length) renderResults();
    });
  });
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
          <p>No pages found at <strong>${state.currentPath}</strong>. Try a different path.</p>
        </div>
      </div>`;
    $('#action-area').innerHTML = '';
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
        <h3>Pages</h3>
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

  renderActionBar();
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
          ${visibleSites().map((s) => {
    const actionable = state.pages.filter((p) => {
      const st = state.statuses[actionKey(p.name, s.site)];
      return !['previewed', 'published', 'error'].includes(st);
    });
    const allChecked = actionable.length > 0
      && actionable.every((p) => state.actions[actionKey(p.name, s.site)] === 'overwrite');
    return `<th>
            <label class="sc-bulk-check">
              <input type="checkbox" class="sc-bulk-checkbox" data-site="${s.site}" ${allChecked ? 'checked' : ''}>
              ${s.name}
            </label>
          </th>`;
  }).join('')}
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
  const cells = visibleSites().map((s) => {
    const key = actionKey(page.name, s.site);
    return renderSiteCell(key, state.statuses[key] || 'missing', state.actions[key] || 'skip', s.site, pagePath);
  });

  return `<tr data-page="${page.name}">
    <td>
      <span class="sc-page-name">${page.name.replace(/\.html$/, '')}</span>
      <span class="sc-page-path">${pagePath}</span>
    </td>
    ${cells.join('')}
  </tr>`;
}

function siteCellContent(key, status, currentAction, targetSite, pagePath) {
  const badgeMap = {
    exists: '<span class="sc-badge sc-badge-exists">Exists</span>',
    missing: '<span class="sc-badge sc-badge-missing">Not found</span>',
    previewed: '<span class="sc-badge sc-badge-previewed">Previewed</span>',
    published: '<span class="sc-badge sc-badge-published">Published</span>',
    error: '<span class="sc-badge sc-badge-error">Error</span>',
  };

  const isProcessed = ['previewed', 'published', 'error'].includes(status);
  const disabled = isProcessed || state.isProcessing ? 'disabled' : '';
  const checked = currentAction === 'overwrite' ? 'checked' : '';

  let previewLink = '';
  if (status === 'previewed' || status === 'published') {
    previewLink = `<a href="${previewUrl(targetSite, pagePath)}" target="_blank" class="sc-preview-link">↗ Preview</a>`;
  }

  return `<div class="sc-site-cell">
    <div class="sc-site-status">${badgeMap[status] || badgeMap.missing}</div>
    <input type="checkbox" class="sc-action-checkbox" data-key="${key}" ${checked} ${disabled}>
    ${previewLink}
  </div>`;
}

function renderSiteCell(key, status, currentAction, targetSite, pagePath) {
  return `<td data-key="${key}">${siteCellContent(key, status, currentAction, targetSite, pagePath)}</td>`;
}

function renderResultsCells() {
  document.querySelectorAll('.sc-action-checkbox').forEach((cb) => {
    const { key } = cb.dataset;
    const td = cb.closest('td');
    if (!td) return;

    const [pageName, targetSite] = key.split('::');
    td.innerHTML = siteCellContent(
      key, state.statuses[key], state.actions[key] || 'skip', targetSite, getPagePath(pageName),
    );
  });

  bindTableEvents();
}

function renderActionBar() {
  const area = $('#action-area');
  if (!state.pages.length) {
    area.innerHTML = '';
    return;
  }

  const vis = new Set(visibleSites().map((s) => s.site));
  const visibleKeys = Object.keys(state.actions).filter((k) => vis.has(k.split('::')[1]));
  const selected = visibleKeys.filter((k) => state.actions[k] === 'overwrite').length;
  const hasPreviewed = visibleKeys.some((k) => state.statuses[k] === 'previewed');

  area.innerHTML = `
    <div class="sc-action-bar">
      <div class="sc-action-buttons">
        <sl-button id="preview-btn"
                ${!selected || state.isProcessing ? 'disabled' : ''}>
          Preview Selected (${selected})
        </sl-button>
        <sl-button id="publish-btn"
                ${!hasPreviewed || state.isProcessing ? 'disabled' : ''}>
          Publish Previewed
        </sl-button>
      </div>
      <div class="sc-action-summary">
        <strong>${selected}</strong> included ·
        <strong>${state.pages.length * visibleSites().length - selected}</strong> skipped
      </div>
    </div>`;

  $('#preview-btn')?.addEventListener('click', () => runBatch('preview'));
  $('#publish-btn')?.addEventListener('click', () => runBatch('publish'));
}

function renderProgress(current, total, message) {
  const pct = total ? Math.round((current / total) * 100) : 0;
  $('#progress-area').innerHTML = `
    <div class="sc-progress">
      <div class="sc-progress-info">
        <span>${message}</span>
        <span>${pct}%</span>
      </div>
      <div class="sc-progress-bar">
        <div class="sc-progress-fill${current === total ? ' done' : ''}" style="width:${pct}%"></div>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ */
/*  Event Binding                                                      */
/* ------------------------------------------------------------------ */

function bindTableEvents() {
  document.querySelectorAll('.sc-action-checkbox').forEach((cb) => {
    cb.removeEventListener('change', onActionChange);
    cb.addEventListener('change', onActionChange);
  });

  document.querySelectorAll('.sc-bulk-checkbox').forEach((cb) => {
    cb.removeEventListener('change', onBulkAction);
    cb.addEventListener('change', onBulkAction);
  });
}

function onActionChange(e) {
  state.actions[e.target.dataset.key] = e.target.checked ? 'overwrite' : 'skip';
  renderActionBar();
}

function onBulkAction(e) {
  const { site } = e.target.dataset;
  const val = e.target.checked ? 'overwrite' : 'skip';

  state.pages.forEach((page) => {
    const key = actionKey(page.name, site);
    if (!['previewed', 'published', 'error'].includes(state.statuses[key])) {
      state.actions[key] = val;
    }
  });

  renderResultsTable();
  renderActionBar();
}

/* ------------------------------------------------------------------ */
/*  Init                                                               */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line import/prefer-default-export
export function initBase({
  org, site, config, container,
}) {
  state.org = org;
  state.site = site;
  state.sites = config.satellites;
  render(container);
}
