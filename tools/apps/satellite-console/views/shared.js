export const $ = (sel) => document.querySelector(sel);

/* ------------------------------------------------------------------ */
/*  Tree                                                               */
/* ------------------------------------------------------------------ */

export function buildTreeStructure(files, basePath) {
  const tree = {};
  files.forEach((file) => {
    const parts = file.path.replace(basePath, '').split('/').filter(Boolean);
    let current = tree;
    parts.forEach((part, i) => {
      if (!current[part]) {
        current[part] = {
          isFile: i === parts.length - 1,
          children: {},
          path: `/${parts.slice(0, i + 1).join('/')}`,
        };
      }
      current = current[part].children;
    });
  });
  return tree;
}

function renderTreeNodes(tree) {
  return Object.entries(tree)
    .sort(([a, aNode], [b, bNode]) => {
      if (!aNode.isFile && bNode.isFile) return -1;
      if (aNode.isFile && !bNode.isFile) return 1;
      return a.localeCompare(b);
    })
    .map(([name, node]) => {
      if (node.isFile) {
        const icon = name.endsWith('.json')
          ? 'icons/Smock_FileData_18_N.svg'
          : 'icons/Smock_FileHTML_18_N.svg';
        return `<li class="sc-tree-item sc-tree-file" data-path="${node.path}">
          <img class="sc-tree-icon" src="${icon}" alt="">
          <span class="sc-tree-label">${name.replace(/\.(html|json)$/, '')}</span>
        </li>`;
      }
      const children = Object.keys(node.children).length
        ? `<ul class="sc-tree-children hidden">${renderTreeNodes(node.children)}</ul>`
        : '';
      return `<li class="sc-tree-item sc-tree-folder">
        <div class="sc-tree-folder-row" data-path="${node.path}">
          <span class="sc-tree-arrow">▶</span>
          <img class="sc-tree-icon" src="icons/Smock_Folder_18_N.svg" alt="">
          <span class="sc-tree-label">${name}</span>
        </div>
        ${children}
      </li>`;
    })
    .join('');
}

function highlightTreeItem(el) {
  document.querySelectorAll('.sc-tree-active').forEach((item) => item.classList.remove('sc-tree-active'));
  el.classList.add('sc-tree-active');
}

function bindTreeEvents(browseFn) {
  document.querySelectorAll('.sc-tree-folder-row').forEach((row) => {
    row.addEventListener('click', () => {
      const ch = row.nextElementSibling;
      if (ch) {
        ch.classList.toggle('hidden');
        const isOpen = !ch.classList.contains('hidden');
        row.querySelector('.sc-tree-arrow').textContent = isOpen ? '▼' : '▶';
        row.querySelector('.sc-tree-icon').src = isOpen
          ? 'icons/Smock_FolderOpen_18_N.svg'
          : 'icons/Smock_Folder_18_N.svg';
      }
      highlightTreeItem(row);
      browseFn(row.dataset.path);
    });
  });

  document.querySelectorAll('.sc-tree-file').forEach((file) => {
    file.addEventListener('click', () => {
      highlightTreeItem(file);
      browseFn(file.dataset.path, true);
    });
  });
}

export function renderTree(panel, treeData, treeLoading, msgs, browseFn) {
  if (!panel) return;

  if (treeLoading) {
    panel.innerHTML = `
      <div class="sc-tree-loading">
        <div class="sc-spinner"></div>
        <p>${msgs.loading}</p>
      </div>`;
    return;
  }

  if (!Object.keys(treeData).length) {
    panel.innerHTML = `<p class="sc-tree-empty">${msgs.empty}</p>`;
    return;
  }

  panel.innerHTML = `<ul class="sc-tree-root">${renderTreeNodes(treeData)}</ul>`;
  bindTreeEvents(browseFn);
}

/* ------------------------------------------------------------------ */
/*  Breadcrumb                                                         */
/* ------------------------------------------------------------------ */

export function renderBreadcrumb(area, currentPath, browseFn) {
  const parts = currentPath.split('/').filter(Boolean);
  const sep = '<span class="sc-bc-sep">/</span>';
  let crumbs = '<a href="#" class="sc-bc-link" data-path="/">root</a>';
  let accumulated = '';

  parts.forEach((p, i) => {
    accumulated += `/${p}`;
    crumbs += i === parts.length - 1
      ? `${sep}<span class="sc-bc-current">${p}</span>`
      : `${sep}<a href="#" class="sc-bc-link" data-path="${accumulated}">${p}</a>`;
  });

  area.innerHTML = `<nav class="sc-breadcrumb">${crumbs}</nav>`;
  area.querySelectorAll('.sc-bc-link').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      browseFn(link.dataset.path);
    });
  });
}

/* ------------------------------------------------------------------ */
/*  Log & Error                                                        */
/* ------------------------------------------------------------------ */

const LOG_ICONS = {
  success: '<img src="icons/CheckmarkSize100.svg" alt="success">',
  error: '<img src="icons/CrossSize100.svg" alt="error">',
  info: '<img src="icons/InfoSmall.svg" alt="info">',
  warn: '<img src="icons/AlertSmall.svg" alt="warning">',
};

export function renderLog(area, log, onClear) {
  if (!log.length) {
    area.innerHTML = '';
    return;
  }

  area.innerHTML = `
    <div class="sc-log">
      <div class="sc-log-header">
        <h3>Activity Log</h3>
        <sl-button class="sc-log-clear">Clear</sl-button>
      </div>
      <div class="sc-log-entries">
        ${log.slice().reverse().map((entry) => `
          <div class="sc-log-entry sc-log-${entry.type}">
            <span class="sc-log-icon">${LOG_ICONS[entry.type] || 'ℹ'}</span>
            <span class="sc-log-time">${entry.time}</span>
            <span>${entry.message}</span>
          </div>
        `).join('')}
      </div>
    </div>`;

  area.querySelector('.sc-log-clear')?.addEventListener('click', () => {
    onClear();
    area.innerHTML = '';
  });

  const entries = area.querySelector('.sc-log-entries');
  if (entries) entries.scrollTop = 0;
}

export function renderError(area, message) {
  area.innerHTML = `<div class="sc-error-banner">${message}</div>`;
}
